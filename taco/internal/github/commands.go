package github

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/diggerhq/digger/opentaco/internal/domain"
	"github.com/diggerhq/digger/opentaco/internal/sandbox"
	"github.com/diggerhq/digger/opentaco/internal/storage"
	"github.com/google/uuid"
)

// CommandExecutor executes terraform commands via the sandbox
type CommandExecutor struct {
	client   *Client
	sandbox  sandbox.Sandbox
	unitRepo domain.UnitRepository
	store    storage.UnitStore
}

// OrgID used for GitHub benchmark operations
const benchmarkOrgID = "github-benchmark"

// ExecuteRequest contains everything needed to execute a command
type ExecuteRequest struct {
	Command   Command
	Owner     string
	Repo      string
	PRNumber  int
	Branch    string
	CommitSHA string
}

// NewCommandExecutor creates a new command executor
func NewCommandExecutor(
	client *Client,
	sandbox sandbox.Sandbox,
	unitRepo domain.UnitRepository,
	store storage.UnitStore,
) *CommandExecutor {
	return &CommandExecutor{
		client:   client,
		sandbox:  sandbox,
		unitRepo: unitRepo,
		store:    store,
	}
}

// Execute runs the terraform command and returns the result
func (e *CommandExecutor) Execute(ctx context.Context, req *ExecuteRequest) *CommandResult {
	result := &CommandResult{
		Command: req.Command,
		Success: false,
	}

	totalStart := time.Now()

	logger := slog.Default().With(
		slog.String("action", req.Command.Action),
		slog.String("repo", fmt.Sprintf("%s/%s", req.Owner, req.Repo)),
		slog.Int("pr", req.PRNumber),
	)

	// 1. Download repository
	logger.Info("Downloading repository")
	cloneStart := time.Now()
	archive, err := e.client.DownloadAndRepackage(ctx, req.Owner, req.Repo, req.CommitSHA)
	if err != nil {
		result.Error = fmt.Sprintf("Failed to download repository: %v", err)
		logger.Error("Download failed", slog.String("error", err.Error()))
		result.Timing.Total = time.Since(totalStart)
		return result
	}
	result.Timing.Clone = time.Since(cloneStart)
	logger.Info("Repository downloaded", slog.Duration("duration", result.Timing.Clone))

	// 2. Generate unit ID for state storage
	// Format: github/{owner}/{repo}/pr-{number}
	unitID := fmt.Sprintf("github/%s/%s/pr-%d", req.Owner, req.Repo, req.PRNumber)

	// 3. Load existing state if any
	var state []byte
	logger.Info("Looking for existing state", slog.String("unit_id", unitID))
	if meta, err := e.unitRepo.Get(ctx, unitID); err == nil && meta != nil {
		logger.Info("Unit found, downloading state...")
		if stateData, err := e.store.Download(ctx, unitID); err == nil {
			state = stateData
			logger.Info("Loaded existing state", slog.Int("size", len(state)))
		} else {
			logger.Warn("Failed to download state", slog.String("error", err.Error()))
		}
	} else {
		logger.Info("No existing unit/state found", slog.String("error", fmt.Sprintf("%v", err)))
	}

	// 4. Get terraform version from options or use default
	tfVersion := req.Command.Options["version"]
	if tfVersion == "" {
		tfVersion = os.Getenv("OPENTACO_DEFAULT_TF_VERSION")
		if tfVersion == "" {
			tfVersion = "1.5.7" // Default version
		}
	}

	// 5. Get engine (terraform or tofu)
	engine := req.Command.Options["engine"]
	if engine == "" {
		engine = os.Getenv("OPENTACO_DEFAULT_ENGINE")
		if engine == "" {
			engine = "terraform"
		}
	}

	// 6. Get working directory if specified (empty means root of repo)
	workingDir := req.Command.Options["dir"]
	// Don't default to "." - the sandbox handles empty string as the root workspace

	// 7. Generate run ID
	runID := uuid.New().String()

	// Create sandbox request metadata
	metadata := map[string]string{
		"github_owner":   req.Owner,
		"github_repo":    req.Repo,
		"github_pr":      fmt.Sprintf("%d", req.PRNumber),
		"github_branch":  req.Branch,
		"github_sha":     req.CommitSHA,
		"command_action": req.Command.Action,
		"benchmark":      "true", // Flag for benchmark mode
	}

	// Pass AWS credentials to sandbox if configured
	// Note: Only passed in metadata, never logged for security
	if awsKey := os.Getenv("AWS_ACCESS_KEY_ID"); awsKey != "" {
		metadata["AWS_ACCESS_KEY_ID"] = awsKey
		metadata["AWS_SECRET_ACCESS_KEY"] = os.Getenv("AWS_SECRET_ACCESS_KEY")
		metadata["AWS_REGION"] = os.Getenv("AWS_REGION")
		if metadata["AWS_REGION"] == "" {
			metadata["AWS_REGION"] = os.Getenv("AWS_DEFAULT_REGION")
		}
		if metadata["AWS_REGION"] == "" {
			metadata["AWS_REGION"] = "us-east-1"
		}
		// Log that credentials are configured (not the values)
		logger.Info("AWS credentials configured for sandbox",
			slog.String("region", metadata["AWS_REGION"]),
			slog.Int("key_length", len(awsKey)))
	} else {
		logger.Warn("AWS_ACCESS_KEY_ID not set - AWS resources will fail")
	}

	// 8. Execute based on action
	switch req.Command.Action {
	case "plan":
		result = e.executePlan(ctx, logger, req, runID, unitID, archive, state, tfVersion, engine, workingDir, metadata, totalStart)
	case "apply":
		result = e.executeApply(ctx, logger, req, runID, unitID, archive, state, tfVersion, engine, workingDir, metadata, totalStart, false)
	case "destroy":
		result = e.executeApply(ctx, logger, req, runID, unitID, archive, state, tfVersion, engine, workingDir, metadata, totalStart, true)
	case "benchmark":
		result = e.executeBenchmark(ctx, logger, req, runID, unitID, archive, tfVersion, engine, workingDir, metadata, totalStart)
	default:
		result.Error = fmt.Sprintf("Unknown action: %s", req.Command.Action)
	}

	result.Timing.Clone = time.Since(cloneStart) - result.Timing.Init - result.Timing.Execute
	if result.Timing.Clone < 0 {
		result.Timing.Clone = 0
	}

	return result
}

func (e *CommandExecutor) executePlan(
	ctx context.Context,
	logger *slog.Logger,
	req *ExecuteRequest,
	runID, unitID string,
	archive, state []byte,
	tfVersion, engine, workingDir string,
	metadata map[string]string,
	totalStart time.Time,
) *CommandResult {
	result := &CommandResult{
		Command: req.Command,
		Success: false,
	}

	if e.sandbox == nil {
		result.Error = "Sandbox provider not configured"
		result.Timing.Total = time.Since(totalStart)
		return result
	}

	// Generate a config version ID for the sandbox
	configVersionID := fmt.Sprintf("cv-%s", uuid.New().String()[:8])
	
	planReq := &sandbox.PlanRequest{
		RunID:                  runID,
		PlanID:                 uuid.New().String(),
		OrgID:                  "github-benchmark",
		UnitID:                 unitID,
		ConfigurationVersionID: configVersionID,
		TerraformVersion:       tfVersion,
		Engine:                 engine,
		WorkingDirectory:       workingDir,
		ConfigArchive:          archive,
		State:                  state,
		Metadata:               metadata,
	}

	logger.Info("Executing plan in sandbox",
		slog.String("run_id", runID),
		slog.String("engine", engine),
		slog.String("version", tfVersion))

	executeStart := time.Now()
	planResult, err := e.sandbox.ExecutePlan(ctx, planReq)
	result.Timing.Execute = time.Since(executeStart)

	if err != nil {
		result.Error = fmt.Sprintf("Plan execution failed: %v", err)
		result.Timing.Total = time.Since(totalStart)
		logger.Error("Plan failed", slog.String("error", err.Error()))
		return result
	}

	result.Success = true
	result.Output = planResult.Logs
	result.Summary = formatPlanSummary(planResult)

	// Parse init time from logs if available
	result.Timing.Init = parseInitTime(planResult.Logs)
	// Adjust execute time to be plan-only (subtract init)
	if result.Timing.Init > 0 && result.Timing.Execute > result.Timing.Init {
		result.Timing.Execute = result.Timing.Execute - result.Timing.Init
	}

	result.Timing.Total = time.Since(totalStart)

	logger.Info("Plan completed",
		slog.Bool("has_changes", planResult.HasChanges),
		slog.Int("additions", planResult.ResourceAdditions),
		slog.Int("changes", planResult.ResourceChanges),
		slog.Int("destructions", planResult.ResourceDestructions),
		slog.Duration("total", result.Timing.Total))

	return result
}

func (e *CommandExecutor) executeApply(
	ctx context.Context,
	logger *slog.Logger,
	req *ExecuteRequest,
	runID, unitID string,
	archive, state []byte,
	tfVersion, engine, workingDir string,
	metadata map[string]string,
	totalStart time.Time,
	isDestroy bool,
) *CommandResult {
	result := &CommandResult{
		Command: req.Command,
		Success: false,
	}

	if e.sandbox == nil {
		result.Error = "Sandbox provider not configured"
		result.Timing.Total = time.Since(totalStart)
		return result
	}

	// Generate a config version ID for the sandbox
	configVersionID := fmt.Sprintf("cv-%s", uuid.New().String()[:8])
	
	applyReq := &sandbox.ApplyRequest{
		RunID:                  runID,
		PlanID:                 uuid.New().String(),
		OrgID:                  "github-benchmark",
		UnitID:                 unitID,
		ConfigurationVersionID: configVersionID,
		IsDestroy:              isDestroy,
		TerraformVersion:       tfVersion,
		Engine:                 engine,
		WorkingDirectory:       workingDir,
		ConfigArchive:          archive,
		State:                  state,
		Metadata:               metadata,
	}

	action := "apply"
	if isDestroy {
		action = "destroy"
	}

	logger.Info(fmt.Sprintf("Executing %s in sandbox", action),
		slog.String("run_id", runID),
		slog.String("engine", engine),
		slog.String("version", tfVersion),
		slog.Bool("is_destroy", isDestroy))

	executeStart := time.Now()
	applyResult, err := e.sandbox.ExecuteApply(ctx, applyReq)
	result.Timing.Execute = time.Since(executeStart)

	if err != nil {
		result.Error = fmt.Sprintf("%s execution failed: %v", strings.Title(action), err)
		result.Timing.Total = time.Since(totalStart)
		logger.Error(fmt.Sprintf("%s failed", action), slog.String("error", err.Error()))
		return result
	}

	// Save the new state
	logger.Info("Apply result received",
		slog.Int("state_size", len(applyResult.State)),
		slog.Int("logs_size", len(applyResult.Logs)),
		slog.Bool("is_destroy", isDestroy))

	if len(applyResult.State) > 0 && !isDestroy {
		if err := e.saveState(ctx, unitID, applyResult.State); err != nil {
			logger.Warn("Failed to save state", slog.String("error", err.Error()))
		} else {
			logger.Info("State saved successfully",
				slog.String("unit_id", unitID),
				slog.Int("size", len(applyResult.State)))
		}
	} else if !isDestroy {
		logger.Warn("No state returned from apply - state will not persist!")
	}

	// For destroy, clean up the state
	if isDestroy {
		if err := e.cleanupState(ctx, unitID); err != nil {
			logger.Warn("Failed to cleanup state", slog.String("error", err.Error()))
		} else {
			logger.Info("State cleaned up after destroy")
		}
	}

	result.Success = true
	result.Output = applyResult.Logs
	result.Summary = formatApplySummary(applyResult.Logs, isDestroy)

	// Parse init time from logs if available
	result.Timing.Init = parseInitTime(applyResult.Logs)
	// Adjust execute time
	if result.Timing.Init > 0 && result.Timing.Execute > result.Timing.Init {
		result.Timing.Execute = result.Timing.Execute - result.Timing.Init
	}

	result.Timing.Total = time.Since(totalStart)

	logger.Info(fmt.Sprintf("%s completed", action),
		slog.Duration("total", result.Timing.Total))

	return result
}

// executeBenchmark runs apply followed by destroy in a single flow
// This keeps state in the sandbox and ensures resources are cleaned up
func (e *CommandExecutor) executeBenchmark(
	ctx context.Context,
	logger *slog.Logger,
	req *ExecuteRequest,
	runID, unitID string,
	archive []byte,
	tfVersion, engine, workingDir string,
	metadata map[string]string,
	totalStart time.Time,
) *CommandResult {
	result := &CommandResult{
		Command: req.Command,
		Success: false,
	}

	if e.sandbox == nil {
		result.Error = "Sandbox provider not configured"
		result.Timing.Total = time.Since(totalStart)
		return result
	}

	// Generate a config version ID for the sandbox
	configVersionID := fmt.Sprintf("cv-%s", uuid.New().String()[:8])

	logger.Info("Starting benchmark: apply + destroy cycle",
		slog.String("run_id", runID),
		slog.String("engine", engine),
		slog.String("version", tfVersion))

	var allLogs strings.Builder

	// Phase 1: Apply
	applyStart := time.Now()
	applyReq := &sandbox.ApplyRequest{
		RunID:                  runID,
		PlanID:                 uuid.New().String(),
		OrgID:                  "github-benchmark",
		UnitID:                 unitID,
		ConfigurationVersionID: configVersionID,
		IsDestroy:              false,
		TerraformVersion:       tfVersion,
		Engine:                 engine,
		WorkingDirectory:       workingDir,
		ConfigArchive:          archive,
		State:                  nil, // Fresh apply
		Metadata:               metadata,
	}

	applyResult, err := e.sandbox.ExecuteApply(ctx, applyReq)
	result.Timing.Apply = time.Since(applyStart)

	if err != nil {
		result.Error = fmt.Sprintf("Apply phase failed: %v", err)
		result.Timing.Total = time.Since(totalStart)
		logger.Error("Benchmark apply failed", slog.String("error", err.Error()))
		return result
	}

	allLogs.WriteString("=== APPLY PHASE ===\n")
	allLogs.WriteString(applyResult.Logs)
	allLogs.WriteString("\n\n")

	logger.Info("Benchmark apply completed",
		slog.Duration("duration", result.Timing.Apply),
		slog.Int("state_size", len(applyResult.State)))

	// Phase 2: Destroy (using state from apply)
	destroyStart := time.Now()
	destroyReq := &sandbox.ApplyRequest{
		RunID:                  runID + "-destroy",
		PlanID:                 uuid.New().String(),
		OrgID:                  "github-benchmark",
		UnitID:                 unitID,
		ConfigurationVersionID: configVersionID,
		IsDestroy:              true,
		TerraformVersion:       tfVersion,
		Engine:                 engine,
		WorkingDirectory:       workingDir,
		ConfigArchive:          archive,
		State:                  applyResult.State, // Use state from apply
		Metadata:               metadata,
	}

	destroyResult, err := e.sandbox.ExecuteApply(ctx, destroyReq)
	result.Timing.Destroy = time.Since(destroyStart)

	if err != nil {
		result.Error = fmt.Sprintf("Destroy phase failed (resources may be orphaned!): %v", err)
		result.Timing.Total = time.Since(totalStart)
		logger.Error("Benchmark destroy failed", slog.String("error", err.Error()))
		return result
	}

	allLogs.WriteString("=== DESTROY PHASE ===\n")
	allLogs.WriteString(destroyResult.Logs)

	logger.Info("Benchmark destroy completed",
		slog.Duration("duration", result.Timing.Destroy))

	// Success!
	result.Success = true
	result.Output = allLogs.String()
	result.Summary = fmt.Sprintf("Apply: %.2fs | Destroy: %.2fs | Total: %.2fs",
		result.Timing.Apply.Seconds(),
		result.Timing.Destroy.Seconds(),
		time.Since(totalStart).Seconds())

	result.Timing.Total = time.Since(totalStart)

	logger.Info("Benchmark completed successfully",
		slog.Duration("apply", result.Timing.Apply),
		slog.Duration("destroy", result.Timing.Destroy),
		slog.Duration("total", result.Timing.Total))

	return result
}

func (e *CommandExecutor) saveState(ctx context.Context, unitID string, state []byte) error {
	// Check if unit exists, create if not
	if _, err := e.unitRepo.Get(ctx, unitID); err != nil {
		// Create the unit with the benchmark org ID
		_, err = e.unitRepo.Create(ctx, benchmarkOrgID, unitID)
		if err != nil {
			return fmt.Errorf("failed to create unit: %w", err)
		}
	}

	// Save state (empty lock ID since we're not holding a lock)
	if err := e.store.Upload(ctx, unitID, state, ""); err != nil {
		return fmt.Errorf("failed to save state: %w", err)
	}

	return nil
}

func (e *CommandExecutor) cleanupState(ctx context.Context, unitID string) error {
	// Delete the unit and state
	if err := e.unitRepo.Delete(ctx, unitID); err != nil {
		return fmt.Errorf("failed to delete unit: %w", err)
	}
	return nil
}

// formatPlanSummary creates a summary from plan results
func formatPlanSummary(result *sandbox.PlanResult) string {
	if !result.HasChanges {
		return "No changes. Infrastructure is up-to-date."
	}
	return fmt.Sprintf("%d to add, %d to change, %d to destroy",
		result.ResourceAdditions,
		result.ResourceChanges,
		result.ResourceDestructions)
}

// formatApplySummary creates a summary from apply output
func formatApplySummary(logs string, isDestroy bool) string {
	// Try to extract the summary line from terraform output
	// Example: "Apply complete! Resources: 10 added, 0 changed, 0 destroyed."
	// Example: "Destroy complete! Resources: 10 destroyed."

	lines := strings.Split(logs, "\n")
	for _, line := range lines {
		if strings.Contains(line, "Apply complete!") || strings.Contains(line, "Destroy complete!") {
			return strings.TrimSpace(line)
		}
	}

	if isDestroy {
		return "Destroy completed"
	}
	return "Apply completed"
}

// parseInitTime attempts to extract init duration from terraform logs
func parseInitTime(logs string) time.Duration {
	// Look for patterns like "Initializing..." to "Terraform has been successfully initialized!"
	// This is approximate since terraform doesn't output exact timing

	// Try to find "initialized" marker and estimate based on log positions
	// For now, return 0 and let the caller use the full execute time
	// In a more sophisticated implementation, we could:
	// 1. Have the sandbox report separate init/execute times
	// 2. Parse timestamps from logs if available

	// Check for common patterns that indicate init completed
	if strings.Contains(logs, "Terraform has been successfully initialized") ||
		strings.Contains(logs, "OpenTofu has been successfully initialized") {
		// Estimate ~3 seconds for init (typical)
		// This is a placeholder - real timing should come from sandbox
		return 0
	}

	return 0
}

// extractResourceCounts extracts add/change/destroy counts from terraform output
func extractResourceCounts(logs string) (add, change, destroy int) {
	// Pattern: "Plan: X to add, Y to change, Z to destroy"
	// Pattern: "Apply complete! Resources: X added, Y changed, Z destroyed"

	patterns := []struct {
		regex  *regexp.Regexp
		addIdx int
		chgIdx int
		desIdx int
	}{
		{
			regexp.MustCompile(`Plan: (\d+) to add, (\d+) to change, (\d+) to destroy`),
			1, 2, 3,
		},
		{
			regexp.MustCompile(`Resources: (\d+) added, (\d+) changed, (\d+) destroyed`),
			1, 2, 3,
		},
	}

	for _, p := range patterns {
		matches := p.regex.FindStringSubmatch(logs)
		if len(matches) >= 4 {
			fmt.Sscanf(matches[p.addIdx], "%d", &add)
			fmt.Sscanf(matches[p.chgIdx], "%d", &change)
			fmt.Sscanf(matches[p.desIdx], "%d", &destroy)
			return
		}
	}

	return 0, 0, 0
}

