// docker-runner-modules-benchmark.ts
//
// Run a module-based benchmark (50 modules x 10 resources = 500 resources)
// Times PLAN and APPLY separately.
//
// Usage:
//   cd sandbox-sidecar/scripts
//   npx tsx docker-runner-modules-benchmark.ts

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_NAME = "tf-runner:benchmark";
const TF_VERSION = "1.5.7";

// Main terraform config - calls 50 child modules
const MAIN_TF = `
# Benchmark: Root Module with Many Child Modules
# Purpose: Test module loading and initialization performance
# Total resources: 50 modules x 10 resources = 500 resources

terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

# Call the child module 50 times
module "child" {
  count         = 50
  source        = "./modules/simple-module"
  instance_name = "child-\${count.index}"
  resource_count = 10
}

output "module_outputs" {
  description = "Outputs from all child modules"
  value = {
    for idx, mod in module.child : idx => mod.resource_ids
  }
}
`;

// Child module that creates multiple resources
const MODULE_MAIN_TF = `
# Simple child module
# Creates 'resource_count' null resources

variable "instance_name" {
  type        = string
  description = "Name for this instance"
}

variable "resource_count" {
  type        = number
  description = "Number of resources to create"
  default     = 10
}

resource "null_resource" "items" {
  count = var.resource_count

  triggers = {
    name  = var.instance_name
    index = count.index
  }
}

resource "random_id" "suffix" {
  count       = var.resource_count
  byte_length = 4
}

output "resource_ids" {
  description = "IDs of created resources"
  value       = null_resource.items[*].id
}

output "random_ids" {
  description = "Random IDs"
  value       = random_id.suffix[*].hex
}
`;

// Log buffer (same as production)
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
}

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

async function main() {
  console.log("=".repeat(60));
  console.log("Docker Runner - MODULES Benchmark");
  console.log("=".repeat(60));
  console.log(`Image: ${IMAGE_NAME}`);
  console.log(`Terraform: ${TF_VERSION}`);
  console.log(`Structure: 50 modules x 10 resources = 500 total resources`);
  console.log(`Tests: PLAN and APPLY timed separately`);
  console.log("=".repeat(60));

  // Create temp directory
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-modules-bench-"));
  console.log(`\nWork directory: ${workDir}`);

  try {
    // Create directory structure
    const modulesDir = path.join(workDir, "modules", "simple-module");
    fs.mkdirSync(modulesDir, { recursive: true });

    // Write main.tf
    fs.writeFileSync(path.join(workDir, "main.tf"), MAIN_TF);
    console.log("Created main.tf (50 module calls)");

    // Write module
    fs.writeFileSync(path.join(modulesDir, "main.tf"), MODULE_MAIN_TF);
    console.log("Created modules/simple-module/main.tf");

    // Check/build Docker image
    console.log("\n[1/6] Checking Docker image...");
    const imageExists = await dockerImageExists(IMAGE_NAME);
    if (!imageExists) {
      await buildDockerImage();
    } else {
      console.log(`Image ${IMAGE_NAME} already exists`);
    }

    const allLogs: string[] = [];
    const logBuffer = new LogBuffer((batch) => allLogs.push(batch));

    // INIT
    console.log("\n[2/6] Running terraform init...");
    const initStart = Date.now();
    let result = await runCommand(
      "docker",
      [
        "run", "--rm",
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
      console.error("terraform init failed:", result.stderr);
      process.exit(1);
    }

    // PLAN (timed separately)
    console.log("\n[3/6] Running terraform plan...");
    console.log("Started at:", new Date().toISOString());
    const planStart = Date.now();
    result = await runCommand(
      "docker",
      [
        "run", "--rm",
        "-v", `${workDir}:/workspace`,
        IMAGE_NAME,
        "terraform", "plan", "-input=false", "-no-color", "-out=tfplan",
      ],
      {
        onStdout: (chunk) => logBuffer.append(chunk),
        onStderr: (chunk) => logBuffer.append(chunk),
      }
    );
    logBuffer.flush();
    const planTime = Date.now() - planStart;
    console.log(`Plan time: ${planTime}ms (${(planTime / 1000).toFixed(1)}s)`);

    if (result.code !== 0) {
      console.error("terraform plan failed:", result.stderr.slice(-500));
      process.exit(1);
    }

    // APPLY (timed separately)
    console.log("\n[4/6] Running terraform apply...");
    console.log("Started at:", new Date().toISOString());
    const applyStart = Date.now();
    result = await runCommand(
      "docker",
      [
        "run", "--rm",
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
    console.log(`Apply time: ${applyTime}ms (${(applyTime / 1000).toFixed(1)}s)`);

    if (result.code !== 0) {
      console.error("terraform apply failed:", result.stderr.slice(-500));
      process.exit(1);
    }

    // DESTROY
    console.log("\n[5/6] Running terraform destroy...");
    const destroyStart = Date.now();
    result = await runCommand(
      "docker",
      [
        "run", "--rm",
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
    console.log("\n[6/6] Results");
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY - MODULES BENCHMARK (Docker)");
    console.log("=".repeat(60));
    console.log(`Resources: 50 modules × 20 resources each = 1000 total`);
    console.log("-".repeat(60));
    console.log(`Terraform init:    ${initTime}ms (${(initTime / 1000).toFixed(1)}s)`);
    console.log(`Terraform plan:    ${planTime}ms (${(planTime / 1000).toFixed(1)}s)`);
    console.log(`Terraform apply:   ${applyTime}ms (${(applyTime / 1000).toFixed(1)}s)`);
    console.log(`Terraform destroy: ${destroyTime}ms (${(destroyTime / 1000).toFixed(1)}s)`);
    console.log("-".repeat(60));
    console.log(`Plan + Apply:      ${planTime + applyTime}ms (${((planTime + applyTime) / 1000).toFixed(1)}s)`);
    console.log("=".repeat(60));

    console.log("\n📊 Use these numbers to compare against E2B:");
    console.log("   Run the same benchmark in E2B and compare plan/apply times.");
    console.log("   If Docker is 2-3x faster, K8s runners are the better choice.");

  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log("\nCleaned up temp directory.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

