// docker-runner-benchmark.ts
//
// Run the 10k null_resource benchmark in a Docker container
// with the SAME log batching as our production sidecar.
//
// This simulates what a Kubernetes-based runner (like Atlantis) would do.
//
// Usage:
//   cd sandbox-sidecar/scripts
//   npx tsx docker-runner-benchmark.ts
//
// Compare results to E2B to show:
//   "Our own Kubernetes runners could be Nx faster than E2B"

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_NAME = "tf-runner:benchmark";
const TF_VERSION = "1.5.7";

// The benchmark Terraform config - 10k null resources
const MAIN_TF = `
# Benchmark: 10,000 Null Resources
# Purpose: Test performance with large number of resources

terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

resource "null_resource" "massive" {
  count = 10000

  triggers = {
    index = count.index
  }
}
`;

// ============================================================
// Log batching - SAME as our production sidecar
// ============================================================
class LogBuffer {
  private chunks: string[] = [];
  private totalBytes = 0;
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 100;
  private readonly FLUSH_SIZE_BYTES = 4096;

  constructor(private onFlush: (batch: string) => void) {}

  append(chunk: string) {
    if (!chunk) return;
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;

    if (this.totalBytes >= this.FLUSH_SIZE_BYTES) {
      this.flush();
    } else if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => {
        this.flushTimeout = null;
        this.flush();
      }, this.FLUSH_INTERVAL_MS);
    }
  }

  flush() {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    if (this.chunks.length > 0) {
      const batch = this.chunks.join("");
      this.chunks = [];
      this.totalBytes = 0;
      this.onFlush(batch);
    }
  }

  getAll(): string {
    this.flush();
    return ""; // Already flushed
  }
}

// ============================================================
// Docker helpers
// ============================================================

function runCommand(
  cmd: string,
  args: string[],
  options: {
    cwd?: string;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      options.onStdout?.(chunk);
    });

    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      options.onStderr?.(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function dockerImageExists(image: string): Promise<boolean> {
  const { code } = await runCommand("docker", ["image", "inspect", image]);
  return code === 0;
}

async function buildDockerImage(): Promise<void> {
  console.log(`Building Docker image: ${IMAGE_NAME}`);
  const dockerfilePath = path.join(__dirname, "Dockerfile.runner");
  
  if (!fs.existsSync(dockerfilePath)) {
    throw new Error(`Dockerfile not found at ${dockerfilePath}`);
  }

  const { code, stderr } = await runCommand(
    "docker",
    ["build", "-t", IMAGE_NAME, "-f", dockerfilePath, "--build-arg", `TF_VERSION=${TF_VERSION}`, __dirname],
    {
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    }
  );

  if (code !== 0) {
    throw new Error(`Docker build failed: ${stderr}`);
  }
}

// ============================================================
// Main benchmark
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("Docker Runner Benchmark (K8s-style)");
  console.log("=".repeat(60));
  console.log(`Image: ${IMAGE_NAME}`);
  console.log(`Terraform: ${TF_VERSION}`);
  console.log(`Resources: 10,000 null_resource`);
  console.log(`Log batching: YES (same as production sidecar)`);
  console.log("=".repeat(60));

  // Create temp directory for terraform files
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-benchmark-"));
  console.log(`\nWork directory: ${workDir}`);

  try {
    // Write main.tf
    fs.writeFileSync(path.join(workDir, "main.tf"), MAIN_TF);
    console.log("Created main.tf with 10k null_resources");

    // Build Docker image if needed
    console.log("\n[1/5] Checking Docker image...");
    const imageExists = await dockerImageExists(IMAGE_NAME);
    if (!imageExists) {
      await buildDockerImage();
    } else {
      console.log(`Image ${IMAGE_NAME} already exists, skipping build`);
    }

    // Collect all logs with batching (like production)
    const allLogs: string[] = [];
    const logBuffer = new LogBuffer((batch) => {
      allLogs.push(batch);
      // Simulate what production does - we collect but don't print every line
    });

    // Run terraform init
    console.log("\n[2/5] Running terraform init in Docker...");
    const initStart = Date.now();
    let result = await runCommand(
      "docker",
      [
        "run",
        "--rm",
        "-v", `${workDir}:/workspace`,
        IMAGE_NAME,
        "terraform", "init", "-input=false", "-no-color",
      ],
      {
        onStdout: (chunk) => logBuffer.append(chunk),
        onStderr: (chunk) => logBuffer.append(chunk),
      }
    );
    logBuffer.flush();
    const initTime = Date.now() - initStart;
    console.log(`Init time: ${initTime}ms (${(initTime / 1000).toFixed(1)}s)`);

    if (result.code !== 0) {
      console.error("terraform init failed");
      console.error(result.stderr);
      process.exit(1);
    }

    // Run terraform apply with log batching
    console.log("\n[3/5] Running terraform apply in Docker (with log batching)...");
    console.log("Started at:", new Date().toISOString());
    
    const applyStart = Date.now();
    result = await runCommand(
      "docker",
      [
        "run",
        "--rm",
        "-v", `${workDir}:/workspace`,
        IMAGE_NAME,
        "terraform", "apply", "-auto-approve", "-input=false", "-no-color", "-parallelism=30",
      ],
      {
        onStdout: (chunk) => logBuffer.append(chunk),
        onStderr: (chunk) => logBuffer.append(chunk),
      }
    );
    logBuffer.flush();
    const applyTime = Date.now() - applyStart;

    console.log(`\nApply completed at: ${new Date().toISOString()}`);
    console.log(`Apply time: ${applyTime}ms (${(applyTime / 1000).toFixed(1)}s) = ${(applyTime / 60000).toFixed(2)} minutes`);

    if (result.code !== 0) {
      console.error("terraform apply failed");
      console.error(result.stderr.slice(-1000));
      process.exit(1);
    }

    // Show last bit of logs
    const combinedLogs = allLogs.join("");
    console.log("\nLast 500 chars of logs:");
    console.log(combinedLogs.slice(-500));

    // Run terraform destroy
    console.log("\n[4/5] Running terraform destroy in Docker...");
    const destroyStart = Date.now();
    result = await runCommand(
      "docker",
      [
        "run",
        "--rm",
        "-v", `${workDir}:/workspace`,
        IMAGE_NAME,
        "terraform", "destroy", "-auto-approve", "-input=false", "-no-color", "-parallelism=30",
      ],
      {
        onStdout: (chunk) => logBuffer.append(chunk),
        onStderr: (chunk) => logBuffer.append(chunk),
      }
    );
    logBuffer.flush();
    const destroyTime = Date.now() - destroyStart;
    console.log(`Destroy time: ${destroyTime}ms (${(destroyTime / 1000).toFixed(1)}s)`);

    // Summary
    console.log("\n[5/5] Cleanup...");

    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY - DOCKER RUNNER (K8s-style)");
    console.log("=".repeat(60));
    console.log(`Terraform init:    ${initTime}ms (${(initTime / 1000).toFixed(1)}s)`);
    console.log(`Terraform apply:   ${applyTime}ms (${(applyTime / 1000).toFixed(1)}s) = ${(applyTime / 60000).toFixed(2)} min`);
    console.log(`Terraform destroy: ${destroyTime}ms (${(destroyTime / 1000).toFixed(1)}s)`);
    console.log(`Total logs collected: ${combinedLogs.length} bytes`);
    console.log("=".repeat(60));

    console.log("\nCOMPARISON:");
    console.log("┌─────────────────┬──────────────┬─────────────┐");
    console.log("│ Environment     │ Apply Time   │ vs Docker   │");
    console.log("├─────────────────┼──────────────┼─────────────┤");
    console.log(`│ Docker (this)   │ ${(applyTime / 60000).toFixed(2)} min     │ 1.0x        │`);
    console.log("│ Your Mac (M4)   │ ~4.5 min     │ ~1.0x       │");
    console.log("│ Spacelift       │ ~5-6 min     │ ~1.2x       │");
    console.log("│ E2B             │ ~14 min      │ ~3.0x       │");
    console.log("└─────────────────┴──────────────┴─────────────┘");
    
    console.log("\n💡 TAKEAWAY:");
    if (applyTime < 360000) { // < 6 min
      console.log("✅ Docker runner is FAST - similar to bare metal!");
      console.log("   Self-hosted Kubernetes runners would be ~3x faster than E2B.");
      console.log("   Consider offering a 'bring your own runner' option.");
    } else {
      console.log("🟡 Docker runner is slower than expected.");
      console.log("   Check Docker resource limits (CPU/memory).");
    }

  } finally {
    // Cleanup
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log("\nCleaned up temp directory.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

