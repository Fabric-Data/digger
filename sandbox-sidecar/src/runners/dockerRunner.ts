import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SandboxRunner, RunnerOutput } from "./types.js";
import { SandboxRunRecord, SandboxRunResult } from "../jobs/jobTypes.js";
import { logger } from "../logger.js";

export interface DockerRunnerOptions {
  image?: string; // Docker image with Terraform installed
  terraformVersion?: string; // Default TF version if not specified in job
}

/**
 * Docker-based runner that executes Terraform commands in a local Docker container.
 * This is much faster than E2B (~3x) and can be used for local testing or K8s deployments.
 */
export class DockerSandboxRunner implements SandboxRunner {
  readonly name = "docker";

  constructor(private readonly options: DockerRunnerOptions = {}) {}

  async run(job: SandboxRunRecord, appendLog?: (chunk: string) => void): Promise<RunnerOutput> {
    if (job.payload.operation === "plan") {
      return this.runPlan(job, appendLog);
    }
    return this.runApply(job, appendLog);
  }

  private getImage(requestedVersion?: string): string {
    if (this.options.image) {
      return this.options.image;
    }
    const version = requestedVersion || this.options.terraformVersion || "1.5.7";
    return `hashicorp/terraform:${version}`;
  }

  private async runPlan(job: SandboxRunRecord, appendLog?: (chunk: string) => void): Promise<RunnerOutput> {
    const workDir = await this.setupWorkspace(job);
    const image = this.getImage(job.payload.terraformVersion);
    
    logger.info({ workDir, image, operation: "plan" }, "Starting Docker plan");

    try {
      const logs: string[] = [];
      const streamLog = (chunk: string) => {
        if (!chunk) return;
        logs.push(chunk);
        appendLog?.(chunk);
      };

      // Run terraform init
      await this.runDockerCommand(
        image,
        workDir,
        ["init", "-input=false", "-no-color"],
        job.payload.metadata,
        streamLog,
      );

      // Run terraform plan
      const planArgs = ["plan", "-input=false", "-no-color", "-out=tfplan.binary", "-parallelism=30"];
      if (job.payload.isDestroy) {
        planArgs.splice(1, 0, "-destroy");
      }
      await this.runDockerCommand(image, workDir, planArgs, job.payload.metadata, streamLog);

      // Get plan JSON
      const showResult = await this.runDockerCommand(
        image,
        workDir,
        ["show", "-json", "tfplan.binary"],
        job.payload.metadata,
      );

      const planJSON = showResult.stdout;
      const summary = this.summarizePlan(planJSON);
      const result: SandboxRunResult = {
        hasChanges: summary.hasChanges,
        resourceAdditions: summary.additions,
        resourceChanges: summary.changes,
        resourceDestructions: summary.destroys,
        planJSON: Buffer.from(planJSON, "utf8").toString("base64"),
      };

      return { logs: logs.join(""), result };
    } finally {
      await this.cleanup(workDir);
    }
  }

  private async runApply(job: SandboxRunRecord, appendLog?: (chunk: string) => void): Promise<RunnerOutput> {
    const startTime = Date.now();
    const workDir = await this.setupWorkspace(job);
    const image = this.getImage(job.payload.terraformVersion);

    logger.info({ 
      workDir, 
      image, 
      operation: "apply",
      isDestroy: job.payload.isDestroy,
    }, "Starting Docker apply");

    try {
      const logs: string[] = [];
      const streamLog = (chunk: string) => {
        if (!chunk) return;
        logs.push(chunk);
        appendLog?.(chunk);
      };

      // Run terraform init
      logger.info({ elapsed: Date.now() - startTime }, "Starting terraform init");
      await this.runDockerCommand(
        image,
        workDir,
        ["init", "-input=false", "-no-color"],
        job.payload.metadata,
        streamLog,
      );
      logger.info({ elapsed: Date.now() - startTime }, "Terraform init completed");

      // Run terraform apply/destroy
      const applyCommand = job.payload.isDestroy ? "destroy" : "apply";
      logger.info({ command: applyCommand, elapsed: Date.now() - startTime }, "Starting terraform apply/destroy");
      
      await this.runDockerCommand(
        image,
        workDir,
        [applyCommand, "-auto-approve", "-input=false", "-no-color", "-parallelism=30"],
        job.payload.metadata,
        streamLog,
      );
      logger.info({ command: applyCommand, elapsed: Date.now() - startTime }, "Terraform apply/destroy completed");

      // Read state file
      let stateBase64 = "";
      const execDir = job.payload.workingDirectory
        ? path.join(workDir, job.payload.workingDirectory)
        : workDir;
      const statePath = path.join(execDir, "terraform.tfstate");

      if (fs.existsSync(statePath)) {
        const stateContent = fs.readFileSync(statePath, "utf-8");
        stateBase64 = Buffer.from(stateContent, "utf8").toString("base64");
        logger.info({ stateSize: stateContent.length }, "Captured terraform.tfstate");
      }

      const result: SandboxRunResult = {
        state: stateBase64,
      };

      logger.info({ elapsed: Date.now() - startTime }, "Apply operation completed");
      return { logs: logs.join(""), result };
    } finally {
      await this.cleanup(workDir);
    }
  }

  private async setupWorkspace(job: SandboxRunRecord): Promise<string> {
    // Create temp directory
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-docker-"));
    
    // Write the config archive
    const archivePath = path.join(workDir, "bundle.tar.gz");
    const archiveBuffer = Buffer.from(job.payload.configArchive, "base64");
    fs.writeFileSync(archivePath, archiveBuffer);

    // Extract the archive
    await this.runLocalCommand("tar", ["-xzf", "bundle.tar.gz"], workDir);

    // Determine exec directory
    const execDir = job.payload.workingDirectory
      ? path.join(workDir, job.payload.workingDirectory)
      : workDir;

    // Write state file if provided
    if (job.payload.state) {
      const statePath = path.join(execDir, "terraform.tfstate");
      const stateBuffer = Buffer.from(job.payload.state, "base64");
      fs.writeFileSync(statePath, stateBuffer);
      logger.info({ stateSize: stateBuffer.length, statePath }, "Wrote state file");
    }

    return workDir;
  }

  private async cleanup(workDir: string): Promise<void> {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, workDir }, "Failed to cleanup work directory");
    }
  }

  private buildEnvArgs(metadata?: Record<string, string>): string[] {
    const envArgs: string[] = [
      "-e", "TF_IN_AUTOMATION=1",
    ];

    // Add AWS credentials if provided
    if (metadata?.AWS_ACCESS_KEY_ID) {
      envArgs.push("-e", `AWS_ACCESS_KEY_ID=${metadata.AWS_ACCESS_KEY_ID}`);
      envArgs.push("-e", `AWS_SECRET_ACCESS_KEY=${metadata.AWS_SECRET_ACCESS_KEY || ""}`);
      envArgs.push("-e", `AWS_REGION=${metadata.AWS_REGION || "us-east-1"}`);
      envArgs.push("-e", `AWS_DEFAULT_REGION=${metadata.AWS_REGION || "us-east-1"}`);
    }

    return envArgs;
  }

  private async runDockerCommand(
    image: string,
    workDir: string,
    args: string[],
    metadata?: Record<string, string>,
    onOutput?: (chunk: string) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    const execDir = workDir; // Mount the work dir as /workspace
    const envArgs = this.buildEnvArgs(metadata);

    const dockerArgs = [
      "run",
      "--rm",
      "-v", `${execDir}:/workspace`,
      "-w", "/workspace",
      ...envArgs,
      image,
      ...args,
    ];

    logger.info({ cmd: `docker ${dockerArgs.join(" ").slice(0, 100)}...` }, "Running Docker command");

    return new Promise((resolve, reject) => {
      const child = spawn("docker", dockerArgs);

      let stdout = "";
      let stderr = "";

      // Batch log output (same as production E2B runner)
      let pendingChunks: string[] = [];
      let flushTimeout: NodeJS.Timeout | null = null;
      const FLUSH_INTERVAL_MS = 100;
      const FLUSH_SIZE_BYTES = 4096;

      const flushPending = () => {
        if (pendingChunks.length === 0) return;
        const batch = pendingChunks.join("");
        pendingChunks = [];
        onOutput?.(batch);
      };

      const bufferChunk = (chunk: string) => {
        pendingChunks.push(chunk);
        const totalSize = pendingChunks.reduce((sum, c) => sum + c.length, 0);
        
        if (totalSize >= FLUSH_SIZE_BYTES) {
          if (flushTimeout) {
            clearTimeout(flushTimeout);
            flushTimeout = null;
          }
          flushPending();
        } else if (!flushTimeout) {
          flushTimeout = setTimeout(() => {
            flushTimeout = null;
            flushPending();
          }, FLUSH_INTERVAL_MS);
        }
      };

      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        bufferChunk(chunk);
      });

      child.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        bufferChunk(chunk);
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (flushTimeout) {
          clearTimeout(flushTimeout);
        }
        flushPending();

        if (code !== 0) {
          reject(new Error(`terraform ${args[0]} exited with code ${code}\n${stderr}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  private async runLocalCommand(cmd: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`${cmd} exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });
  }

  private summarizePlan(planJSON: string) {
    try {
      const parsed = JSON.parse(planJSON);
      const changes = parsed?.resource_changes ?? [];
      let additions = 0;
      let updates = 0;
      let destroys = 0;

      for (const change of changes) {
        const actions: string[] = change?.change?.actions ?? [];
        if (actions.includes("create")) additions += 1;
        if (actions.includes("update")) updates += 1;
        if (actions.includes("delete") || actions.includes("destroy")) destroys += 1;
        if (actions.includes("replace")) {
          additions += 1;
          destroys += 1;
        }
      }

      return {
        hasChanges: additions + updates + destroys > 0,
        additions,
        changes: updates,
        destroys,
      };
    } catch (error) {
      logger.warn({ error }, "Failed to parse terraform plan JSON");
      return { hasChanges: false, additions: 0, changes: 0, destroys: 0 };
    }
  }
}

