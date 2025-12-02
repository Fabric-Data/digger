package github

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/labstack/echo/v4"
)

// WebhookHandler handles GitHub webhook events
type WebhookHandler struct {
	client   *Client
	executor *CommandExecutor
	secret   string
}

// NewWebhookHandler creates a new webhook handler
// Note: The webhook secret is required at registration time (see RegisterGitHubWebhook)
func NewWebhookHandler(client *Client, executor *CommandExecutor) *WebhookHandler {
	return &WebhookHandler{
		client:   client,
		executor: executor,
		secret:   os.Getenv("OPENTACO_GITHUB_WEBHOOK_SECRET"),
	}
}

// HandleWebhook is the main webhook endpoint handler
func (h *WebhookHandler) HandleWebhook(c echo.Context) error {
	// Read the body
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		slog.Error("Failed to read webhook body", slog.String("error", err.Error()))
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "failed to read body"})
	}

	// Validate webhook signature (required - enforced at registration)
	signature := c.Request().Header.Get("X-Hub-Signature-256")
	if !h.validateSignature(body, signature) {
		slog.Warn("Invalid webhook signature received")
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid signature"})
	}

	// Get event type
	eventType := c.Request().Header.Get("X-GitHub-Event")
	deliveryID := c.Request().Header.Get("X-GitHub-Delivery")

	slog.Info("Received GitHub webhook",
		slog.String("event", eventType),
		slog.String("delivery_id", deliveryID))

	switch eventType {
	case "issue_comment":
		return h.handleIssueComment(c, body)
	case "pull_request":
		// Optional: auto-plan on PR open
		return h.handlePullRequest(c, body)
	case "ping":
		return c.JSON(http.StatusOK, map[string]string{"message": "pong"})
	default:
		slog.Debug("Ignoring unhandled event type", slog.String("event", eventType))
		return c.JSON(http.StatusOK, map[string]string{"message": "event ignored"})
	}
}

// handleIssueComment processes issue/PR comment events
func (h *WebhookHandler) handleIssueComment(c echo.Context, body []byte) error {
	ctx := c.Request().Context()

	var event IssueCommentEvent
	if err := json.Unmarshal(body, &event); err != nil {
		slog.Error("Failed to parse issue comment event", slog.String("error", err.Error()))
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "failed to parse event"})
	}

	// Only process new comments
	if event.Action != "created" {
		return c.JSON(http.StatusOK, map[string]string{"message": "ignoring non-created action"})
	}

	// Only process comments on PRs (issues with pull_request field)
	if event.Issue.PullRequest == nil {
		return c.JSON(http.StatusOK, map[string]string{"message": "ignoring non-PR comment"})
	}

	// Ignore bot comments to prevent loops
	if event.Sender.Type == "Bot" {
		return c.JSON(http.StatusOK, map[string]string{"message": "ignoring bot comment"})
	}

	// Parse command from comment
	cmd := ParseCommand(event.Comment.Body)
	if cmd == nil {
		return c.JSON(http.StatusOK, map[string]string{"message": "no command found"})
	}

	slog.Info("Processing command",
		slog.String("action", cmd.Action),
		slog.String("repo", event.Repo.FullName),
		slog.Int("pr", event.Issue.Number),
		slog.String("user", event.Sender.Login))

	// Parse owner/repo
	parts := strings.Split(event.Repo.FullName, "/")
	if len(parts) != 2 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid repo name"})
	}
	owner, repo := parts[0], parts[1]

	// Get PR details to find the branch
	pr, err := h.client.GetPullRequest(ctx, owner, repo, event.Issue.Number)
	if err != nil {
		slog.Error("Failed to get PR details", slog.String("error", err.Error()))
		// Post error comment
		h.client.PostComment(ctx, owner, repo, event.Issue.Number,
			fmt.Sprintf("❌ **OpenTaco Error**\n\nFailed to get PR details: %s", err.Error()))
		return c.JSON(http.StatusOK, map[string]string{"message": "failed to get PR"})
	}

	// Post acknowledgment comment
	ackMsg := fmt.Sprintf("🚀 **OpenTaco** starting `%s`...\n\n_Downloading repository and preparing sandbox..._", cmd.Action)
	h.client.PostComment(ctx, owner, repo, event.Issue.Number, ackMsg)

	// Execute command asynchronously with background context
	// (the HTTP request context is canceled after response is sent)
	go func() {
		// Use background context since HTTP request will complete before execution finishes
		bgCtx := context.Background()
		
		result := h.executor.Execute(bgCtx, &ExecuteRequest{
			Command:   *cmd,
			Owner:     owner,
			Repo:      repo,
			PRNumber:  event.Issue.Number,
			Branch:    pr.Head.Ref,
			CommitSHA: pr.Head.SHA,
		})

		// Post result comment
		resultComment := FormatResult(result)
		if err := h.client.PostComment(bgCtx, owner, repo, event.Issue.Number, resultComment); err != nil {
			slog.Error("Failed to post result comment", slog.String("error", err.Error()))
		}
	}()

	return c.JSON(http.StatusOK, map[string]string{"message": "command accepted"})
}

// handlePullRequest processes PR events (optional auto-plan)
func (h *WebhookHandler) handlePullRequest(c echo.Context, body []byte) error {
	var event PullRequestEvent
	if err := json.Unmarshal(body, &event); err != nil {
		slog.Error("Failed to parse PR event", slog.String("error", err.Error()))
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "failed to parse event"})
	}

	// Only process opened/synchronize if auto-plan is enabled
	autoPlan := os.Getenv("OPENTACO_GITHUB_AUTO_PLAN") == "true"
	if !autoPlan {
		return c.JSON(http.StatusOK, map[string]string{"message": "auto-plan disabled"})
	}

	if event.Action != "opened" && event.Action != "synchronize" {
		return c.JSON(http.StatusOK, map[string]string{"message": "ignoring action"})
	}

	// TODO: Implement auto-plan on PR open/sync
	slog.Info("Would auto-plan for PR",
		slog.String("repo", event.Repo.FullName),
		slog.Int("pr", event.Number),
		slog.String("action", event.Action))

	return c.JSON(http.StatusOK, map[string]string{"message": "auto-plan not yet implemented"})
}

// validateSignature validates the webhook signature
func (h *WebhookHandler) validateSignature(body []byte, signature string) bool {
	if !strings.HasPrefix(signature, "sha256=") {
		return false
	}

	expected := signature[7:] // Remove "sha256=" prefix

	mac := hmac.New(sha256.New, []byte(h.secret))
	mac.Write(body)
	computed := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(expected), []byte(computed))
}

// ParseCommand parses an /opentaco command from comment text
func ParseCommand(text string) *Command {
	lines := strings.Split(text, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Check for /opentaco command
		if !strings.HasPrefix(line, "/opentaco ") && line != "/opentaco" {
			continue
		}

		// Parse the command
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		action := strings.ToLower(parts[1])

		// Validate action
		switch action {
		case "plan", "apply", "destroy":
			cmd := &Command{
				Action:  action,
				Options: make(map[string]string),
				Raw:     line,
			}

			// Parse additional options
			for i := 2; i < len(parts); i++ {
				opt := parts[i]
				if strings.HasPrefix(opt, "--") {
					// Handle --key=value or --flag
					opt = strings.TrimPrefix(opt, "--")
					if idx := strings.Index(opt, "="); idx > 0 {
						cmd.Options[opt[:idx]] = opt[idx+1:]
					} else {
						cmd.Options[opt] = "true"
					}
				}
			}

			return cmd
		default:
			// Unknown action, skip
			continue
		}
	}

	return nil
}

// FormatResult formats a command result as a markdown comment
func FormatResult(result *CommandResult) string {
	var sb strings.Builder

	// Header based on action
	switch result.Command.Action {
	case "plan":
		if result.Success {
			sb.WriteString("## ✅ OpenTaco Plan\n\n")
		} else {
			sb.WriteString("## ❌ OpenTaco Plan Failed\n\n")
		}
	case "apply":
		if result.Success {
			sb.WriteString("## ✅ OpenTaco Apply\n\n")
		} else {
			sb.WriteString("## ❌ OpenTaco Apply Failed\n\n")
		}
	case "destroy":
		if result.Success {
			sb.WriteString("## ✅ OpenTaco Destroy\n\n")
		} else {
			sb.WriteString("## ❌ OpenTaco Destroy Failed\n\n")
		}
	}

	// Timing breakdown
	sb.WriteString(fmt.Sprintf("**Total Duration:** %.2fs\n\n", result.Timing.Total.Seconds()))
	sb.WriteString("| Phase | Duration |\n")
	sb.WriteString("|-------|----------|\n")
	if result.Timing.Clone > 0 {
		sb.WriteString(fmt.Sprintf("| Clone | %.2fs |\n", result.Timing.Clone.Seconds()))
	}
	sb.WriteString(fmt.Sprintf("| Init | %.2fs |\n", result.Timing.Init.Seconds()))

	switch result.Command.Action {
	case "plan":
		sb.WriteString(fmt.Sprintf("| Plan | %.2fs |\n", result.Timing.Execute.Seconds()))
	case "apply":
		sb.WriteString(fmt.Sprintf("| Apply | %.2fs |\n", result.Timing.Execute.Seconds()))
	case "destroy":
		sb.WriteString(fmt.Sprintf("| Destroy | %.2fs |\n", result.Timing.Execute.Seconds()))
	}

	sb.WriteString("\n")

	// Summary
	if result.Summary != "" {
		sb.WriteString(fmt.Sprintf("**Summary:** %s\n\n", result.Summary))
	}

	// Error message if failed
	if !result.Success && result.Error != "" {
		sb.WriteString(fmt.Sprintf("**Error:** %s\n\n", result.Error))
	}

	// Full output in collapsible section
	if result.Output != "" {
		sb.WriteString("<details>\n<summary>Full Output</summary>\n\n```\n")
		// Truncate if too long
		output := result.Output
		if len(output) > 50000 {
			output = output[:50000] + "\n... (truncated)"
		}
		sb.WriteString(output)
		sb.WriteString("\n```\n</details>\n")
	}

	return sb.String()
}

