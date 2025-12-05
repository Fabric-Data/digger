// debug-terraform-e2b.ts
//
// Run a 10k-null Terraform apply inside an E2B sandbox with
// *no* stdout/stderr callbacks, just final output.
//
// Usage:
//   cd sandbox-sidecar
//   npx tsx scripts/debug-terraform-e2b.ts
//
// This isolates whether the slowness is:
//   A) E2B's virtualization/environment
//   B) Our sidecar's SDK callback overhead
//   C) Our log handling code

import "dotenv/config";
import { Sandbox } from "@e2b/code-interpreter";

// Use our pre-built template with terraform + providers cached
const TEMPLATE_ID = "terraform-1-5-7--tpl-0-2-2";
const WORK_DIR = "/home/user/benchmark";

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

async function main() {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    console.error("E2B_API_KEY environment variable is required");
    console.error("Set it in .env or export E2B_API_KEY=...");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("E2B Terraform Performance Debug Script");
  console.log("=".repeat(60));
  console.log(`Template: ${TEMPLATE_ID}`);
  console.log(`Resources: 10,000 null_resource`);
  console.log("=".repeat(60));

  console.log("\n[1/6] Creating E2B sandbox...");
  const startCreate = Date.now();
  
  const sandbox = await Sandbox.create(TEMPLATE_ID, {
    apiKey,
    timeoutMs: 30 * 60 * 1000, // 30 minutes
  });
  
  const createTime = Date.now() - startCreate;
  console.log(`Sandbox created: ${sandbox.sandboxId}`);
  console.log(`Creation time: ${createTime}ms`);

  try {
    // 2) Create the benchmark directory and write main.tf
    console.log("\n[2/6] Creating benchmark terraform config...");
    await sandbox.commands.run(`mkdir -p ${WORK_DIR}`);
    await sandbox.files.write(`${WORK_DIR}/main.tf`, MAIN_TF);
    
    let result = await sandbox.commands.run(`cat ${WORK_DIR}/main.tf`);
    console.log("Created main.tf:");
    console.log(result.stdout);

    // 3) Run terraform init
    console.log("\n[3/6] Running terraform init...");
    const startInit = Date.now();
    result = await sandbox.commands.run(
      `cd ${WORK_DIR} && terraform init -input=false -no-color -plugin-dir=/usr/share/terraform/providers`,
      { timeoutMs: 300000 }
    );
    const initTime = Date.now() - startInit;
    console.log(`Init time: ${initTime}ms`);
    console.log(result.stdout.slice(-500));
    if (result.exitCode !== 0) {
      console.error("terraform init failed:", result.stderr);
      return;
    }

    // 4) TIME TEST: Run apply WITHOUT streaming callbacks
    console.log("\n[4/6] Running terraform apply (NO streaming callbacks)...");
    console.log("This will take a while. No output until complete.");
    console.log("Started at:", new Date().toISOString());
    
    const startApply = Date.now();
    result = await sandbox.commands.run(
      `cd ${WORK_DIR} && terraform apply -auto-approve -input=false -no-color -parallelism=30`,
      { 
        timeoutMs: 60 * 60 * 1000, // 1 hour
        // NO onStdout/onStderr callbacks!
      }
    );
    const applyTime = Date.now() - startApply;
    
    console.log(`\nApply completed at: ${new Date().toISOString()}`);
    console.log(`Apply time: ${applyTime}ms (${(applyTime/1000).toFixed(1)}s) = ${(applyTime/60000).toFixed(2)} minutes`);
    console.log(`\nLast 500 chars of output:`);
    console.log(result.stdout.slice(-500));
    
    if (result.exitCode !== 0) {
      console.error("terraform apply failed:", result.stderr);
      return;
    }

    // 5) Destroy and re-apply with output redirected to file
    console.log("\n[5/6] Destroying resources for second test...");
    const startDestroy = Date.now();
    await sandbox.commands.run(
      `cd ${WORK_DIR} && terraform destroy -auto-approve -input=false -no-color -parallelism=30 > /tmp/destroy.log 2>&1`,
      { timeoutMs: 60 * 60 * 1000 }
    );
    const destroyTime = Date.now() - startDestroy;
    console.log(`Destroy time: ${destroyTime}ms (${(destroyTime/1000).toFixed(1)}s)`);
    
    // 6) Apply with file redirect - completely bypasses SDK stdout handling
    console.log("\n[6/6] Running apply with output redirected to file...");
    console.log("(This tests if SDK stdout collection has overhead)");
    const startApplyFile = Date.now();
    result = await sandbox.commands.run(
      `cd ${WORK_DIR} && terraform apply -auto-approve -input=false -no-color -parallelism=30 > /tmp/apply.log 2>&1; echo "EXIT_CODE=$?"`,
      { timeoutMs: 60 * 60 * 1000 }
    );
    const applyFileTime = Date.now() - startApplyFile;
    
    console.log(`Apply (file redirect) time: ${applyFileTime}ms (${(applyFileTime/1000).toFixed(1)}s) = ${(applyFileTime/60000).toFixed(2)} minutes`);
    
    // Read last part of log
    result = await sandbox.commands.run(`tail -10 /tmp/apply.log`);
    console.log("Last 10 lines of apply.log:");
    console.log(result.stdout);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Sandbox creation:      ${createTime}ms (${(createTime/1000).toFixed(1)}s)`);
    console.log(`Terraform init:        ${initTime}ms (${(initTime/1000).toFixed(1)}s)`);
    console.log(`Apply (SDK collects):  ${applyTime}ms (${(applyTime/1000).toFixed(1)}s) = ${(applyTime/60000).toFixed(2)} min`);
    console.log(`Apply (file redirect): ${applyFileTime}ms (${(applyFileTime/1000).toFixed(1)}s) = ${(applyFileTime/60000).toFixed(2)} min`);
    console.log(`Destroy:               ${destroyTime}ms (${(destroyTime/1000).toFixed(1)}s)`);
    console.log("=".repeat(60));
    
    console.log("\nDIAGNOSIS:");
    if (applyTime > 600000) { // > 10 minutes
      console.log("❌ Apply took > 10 minutes.");
      console.log("   The E2B environment itself is slow.");
      console.log("   This is NOT a sidecar code issue - it's E2B's VM performance.");
      console.log("   Options:");
      console.log("   - Contact E2B about VM performance");
      console.log("   - Try a different sandbox provider");
      console.log("   - Accept this as the baseline for E2B");
    } else if (applyTime > 300000) { // > 5 minutes
      console.log("⚠️  Apply took 5-10 minutes.");
      console.log("   This is similar to Spacelift's performance.");
      console.log("   E2B is comparable but not faster.");
    } else if (applyTime > 60000) { // > 1 minute
      console.log("🟡 Apply took 1-5 minutes.");
      console.log("   E2B is reasonably fast.");
      console.log("   Our sidecar overhead might be adding to this.");
    } else {
      console.log("✅ Apply took < 1 minute!");
      console.log("   E2B is fast - any slowness is in our sidecar code.");
    }
    
    const sdkOverhead = applyTime - applyFileTime;
    if (Math.abs(sdkOverhead) > 10000) { // > 10 second difference
      console.log(`\n📊 SDK stdout collection overhead: ${(sdkOverhead/1000).toFixed(1)}s`);
    }

  } finally {
    console.log("\nKilling sandbox...");
    await sandbox.kill();
    console.log("Done.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

