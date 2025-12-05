// test-docker-runner.ts
//
// Test the Docker runner locally with a simple 10-null benchmark.
// This simulates what would happen when the sidecar runs with SANDBOX_RUNNER=docker
//
// Usage:
//   cd sandbox-sidecar
//   npx tsx scripts/test-docker-runner.ts

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { DockerSandboxRunner } from "../src/runners/dockerRunner.js";
import { SandboxRunRecord } from "../src/jobs/jobTypes.js";

// Simple benchmark: 100 null resources (quick test)
const MAIN_TF = `
terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

resource "null_resource" "test" {
  count = 100

  triggers = {
    index = count.index
  }
}

output "resource_count" {
  value = length(null_resource.test)
}
`;

async function createConfigArchive(): Promise<string> {
  // Create temp dir with terraform files
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-test-"));
  fs.writeFileSync(path.join(tempDir, "main.tf"), MAIN_TF);

  // Create tar.gz archive
  const archivePath = path.join(tempDir, "bundle.tar.gz");
  execSync(`tar -czf bundle.tar.gz main.tf`, { cwd: tempDir });

  // Read and base64 encode
  const archiveBuffer = fs.readFileSync(archivePath);
  const base64 = archiveBuffer.toString("base64");

  // Cleanup temp dir
  fs.rmSync(tempDir, { recursive: true, force: true });

  return base64;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Docker Runner Test");
  console.log("=".repeat(60));
  console.log("Resources: 100 null_resource (quick test)");
  console.log("Operations: plan, then apply");
  console.log("=".repeat(60));

  // Create the Docker runner
  const runner = new DockerSandboxRunner({
    terraformVersion: "1.5.7",
  });

  console.log(`\nRunner: ${runner.name}`);

  // Create config archive
  console.log("\n[1/4] Creating config archive...");
  const configArchive = await createConfigArchive();
  console.log(`Archive size: ${configArchive.length} bytes (base64)`);

  // Create a mock job for PLAN
  const planJob: SandboxRunRecord = {
    id: "test-plan-001",
    status: "pending",
    logs: "",
    payload: {
      operation: "plan",
      runId: "test-run-001",
      orgId: "test-org",
      unitId: "test-unit",
      configurationVersionId: "cv-001",
      isDestroy: false,
      terraformVersion: "1.5.7",
      engine: "terraform",
      configArchive,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Run PLAN
  console.log("\n[2/4] Running terraform plan via Docker runner...");
  const planStart = Date.now();
  
  let logOutput = "";
  const planResult = await runner.run(planJob, (chunk) => {
    logOutput += chunk;
    // Don't print every chunk, just collect
  });
  
  const planTime = Date.now() - planStart;
  console.log(`Plan time: ${planTime}ms (${(planTime / 1000).toFixed(1)}s)`);
  console.log(`Plan has changes: ${planResult.result?.hasChanges}`);
  console.log(`Resources to add: ${planResult.result?.resourceAdditions}`);
  console.log(`Log output size: ${planResult.logs.length} bytes`);

  // Create a mock job for APPLY
  const applyJob: SandboxRunRecord = {
    id: "test-apply-001",
    status: "pending",
    logs: "",
    payload: {
      operation: "apply",
      runId: "test-run-001",
      orgId: "test-org",
      unitId: "test-unit",
      configurationVersionId: "cv-001",
      isDestroy: false,
      terraformVersion: "1.5.7",
      engine: "terraform",
      configArchive,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Run APPLY
  console.log("\n[3/4] Running terraform apply via Docker runner...");
  const applyStart = Date.now();
  
  logOutput = "";
  const applyResult = await runner.run(applyJob, (chunk) => {
    logOutput += chunk;
  });
  
  const applyTime = Date.now() - applyStart;
  console.log(`Apply time: ${applyTime}ms (${(applyTime / 1000).toFixed(1)}s)`);
  console.log(`State size: ${applyResult.result?.state?.length || 0} bytes (base64)`);
  console.log(`Log output size: ${applyResult.logs.length} bytes`);

  // Show last bit of logs
  console.log("\n[4/4] Last 300 chars of apply logs:");
  console.log(applyResult.logs.slice(-300));

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Plan time:  ${planTime}ms (${(planTime / 1000).toFixed(1)}s)`);
  console.log(`Apply time: ${applyTime}ms (${(applyTime / 1000).toFixed(1)}s)`);
  console.log(`Total:      ${planTime + applyTime}ms (${((planTime + applyTime) / 1000).toFixed(1)}s)`);
  console.log("=".repeat(60));

  console.log("\n✅ Docker runner test completed successfully!");
  console.log("\nTo use in production, set:");
  console.log("  SANDBOX_RUNNER=docker");
  console.log("  DOCKER_TERRAFORM_VERSION=1.5.7  # optional, defaults to 1.5.7");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

