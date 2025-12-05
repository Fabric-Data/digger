// k8s-runner-benchmark.ts
//
// Run the 10k null_resource benchmark as a Kubernetes Job.
// This tests real network latency to your cluster.
//
// Prerequisites:
//   1. kubectl configured to access your cluster
//   2. Run: kubectl apply -f k8s-setup.yaml
//
// Usage:
//   cd sandbox-sidecar/scripts
//   npx tsx k8s-runner-benchmark.ts

import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NAMESPACE = "otaco-runners";
const TF_VERSION = "1.5.7";
const JOB_NAME_PREFIX = "otaco-benchmark";

// 10k null resources benchmark
const MAIN_TF = `
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

function kubectl(args: string[], options: { input?: string } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("kubectl", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    if (options.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    }

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function checkPrerequisites(): Promise<boolean> {
  // Check kubectl access
  const { code, stderr } = await kubectl(["get", "namespace", NAMESPACE]);
  if (code !== 0) {
    console.error(`❌ Namespace '${NAMESPACE}' not found.`);
    console.error("Run: kubectl apply -f k8s-setup.yaml");
    console.error(stderr);
    return false;
  }
  console.log(`✅ Namespace '${NAMESPACE}' exists`);
  return true;
}

async function createConfigMap(name: string, mainTf: string): Promise<void> {
  // Delete if exists
  await kubectl(["delete", "configmap", name, "-n", NAMESPACE, "--ignore-not-found"]);
  
  // Create ConfigMap with the Terraform config
  const configMapYaml = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}
  namespace: ${NAMESPACE}
data:
  main.tf: |
${mainTf.split('\n').map(line => '    ' + line).join('\n')}
`;
  
  const { code, stderr } = await kubectl(["apply", "-f", "-"], { input: configMapYaml });
  if (code !== 0) {
    throw new Error(`Failed to create ConfigMap: ${stderr}`);
  }
}

async function waitForJobCompletion(jobName: string, timeoutMs: number = 3600000): Promise<"complete" | "failed"> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds

  while (Date.now() - startTime < timeoutMs) {
    // Get job status
    const { stdout, code } = await kubectl([
      "get", "job", jobName, "-n", NAMESPACE,
      "-o", "jsonpath={.status.succeeded},{.status.failed},{.status.active}"
    ]);

    if (code !== 0) {
      console.log("  Job not found yet, waiting...");
      await new Promise(r => setTimeout(r, pollInterval));
      continue;
    }

    const [succeeded, failed, active] = stdout.split(",");
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    if (succeeded === "1") {
      console.log(`  ✅ Job completed successfully (${elapsed}s)`);
      return "complete";
    }

    if (failed === "1") {
      console.log(`  ❌ Job failed (${elapsed}s)`);
      return "failed";
    }

    // Still running - show progress
    if (active === "1") {
      // Try to get pod phase for more detail
      const { stdout: podPhase } = await kubectl([
        "get", "pods", "-n", NAMESPACE, "-l", `job-name=${jobName}`,
        "-o", "jsonpath={.items[0].status.phase}"
      ]);
      console.log(`  ⏳ Running... phase=${podPhase || "unknown"} elapsed=${elapsed}s`);
    } else {
      // Check if pod is pending due to resources
      const { stdout: podInfo } = await kubectl([
        "get", "pods", "-n", NAMESPACE, "-l", `job-name=${jobName}`,
        "-o", "jsonpath={.items[0].status.phase},{.items[0].status.conditions[?(@.type=='PodScheduled')].reason}"
      ]);
      const [phase, reason] = (podInfo || ",").split(",");
      if (reason === "Unschedulable") {
        console.log(`  ⏳ Pending... UNSCHEDULABLE - cluster doesn't have 8 CPU available! elapsed=${elapsed}s`);
      } else {
        console.log(`  ⏳ Pending... phase=${phase || "unknown"} reason=${reason || "starting"} elapsed=${elapsed}s`);
      }
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new Error(`Job timed out after ${timeoutMs}ms`);
}

async function runJob(jobName: string, configMapName: string, command: string): Promise<{ duration: number; logs: string }> {
  // Delete old job if exists
  await kubectl(["delete", "job", jobName, "-n", NAMESPACE, "--ignore-not-found"]);

  const jobYaml = `
apiVersion: batch/v1
kind: Job
metadata:
  name: ${jobName}
  namespace: ${NAMESPACE}
spec:
  ttlSecondsAfterFinished: 300
  backoffLimit: 0
  activeDeadlineSeconds: 3600
  template:
    spec:
      restartPolicy: Never
      serviceAccountName: otaco-runner
      # Use dedicated runner nodes only
      nodeSelector:
        dedicated: otaco-runner
      tolerations:
        - key: "dedicated"
          operator: "Equal"
          value: "otaco-runner"
          effect: "NoSchedule"
      containers:
        - name: terraform
          image: hashicorp/terraform:${TF_VERSION}
          command: ["sh", "-c"]
          args:
            - |
              set -e
              cd /workspace
              cp /config/main.tf .
              echo "=== Starting Terraform ==="
              terraform init -input=false -no-color
              echo "=== Init Complete ==="
              ${command}
              echo "=== Command Complete ==="
          env:
            - name: TF_IN_AUTOMATION
              value: "1"
          resources:
            requests:
              cpu: "4"
              memory: "4Gi"
            limits:
              cpu: "4"
              memory: "4Gi"
          volumeMounts:
            - name: config
              mountPath: /config
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: config
          configMap:
            name: ${configMapName}
        - name: workspace
          emptyDir: {}
`;

  const startTime = Date.now();
  
  // Create job
  console.log(`Creating job ${jobName}...`);
  const { code: createCode, stderr: createErr } = await kubectl(["apply", "-f", "-"], { input: jobYaml });
  if (createCode !== 0) {
    throw new Error(`Failed to create job: ${createErr}`);
  }

  // Wait for job to complete with polling (shows progress)
  console.log("Waiting for job to complete...");
  const status = await waitForJobCompletion(jobName);

  const duration = Date.now() - startTime;

  // Get logs
  const { stdout: logs } = await kubectl(["logs", `job/${jobName}`, "-n", NAMESPACE]);

  if (status === "failed") {
    console.error("Job failed. Logs:");
    console.error(logs);
    throw new Error("Job failed");
  }

  return { duration, logs };
}

async function main() {
  console.log("=".repeat(60));
  console.log("Kubernetes Runner Benchmark");
  console.log("=".repeat(60));
  console.log(`Namespace: ${NAMESPACE}`);
  console.log(`Terraform: ${TF_VERSION}`);
  console.log(`Resources: 10,000 null_resource`);
  console.log(`Tests: PLAN and APPLY with real network latency`);
  console.log("=".repeat(60));

  // Check prerequisites
  console.log("\n[1/5] Checking prerequisites...");
  if (!await checkPrerequisites()) {
    process.exit(1);
  }

  // Create ConfigMap with Terraform config
  const configMapName = `tf-config-${Date.now()}`;
  console.log(`\n[2/5] Creating ConfigMap ${configMapName}...`);
  await createConfigMap(configMapName, MAIN_TF);
  console.log("ConfigMap created");

  try {
    // Run PLAN job
    console.log("\n[3/5] Running Terraform PLAN...");
    const planJobName = `${JOB_NAME_PREFIX}-plan-${Date.now()}`;
    const planResult = await runJob(
      planJobName,
      configMapName,
      "terraform plan -input=false -no-color -out=tfplan -parallelism=30"
    );
    console.log(`Plan completed in ${planResult.duration}ms (${(planResult.duration/1000).toFixed(1)}s)`);

    // Run APPLY job  
    console.log("\n[4/5] Running Terraform APPLY...");
    const applyJobName = `${JOB_NAME_PREFIX}-apply-${Date.now()}`;
    const applyResult = await runJob(
      applyJobName,
      configMapName,
      "terraform apply -auto-approve -input=false -no-color -parallelism=30"
    );
    console.log(`Apply completed in ${applyResult.duration}ms (${(applyResult.duration/1000).toFixed(1)}s)`);

    // Show logs
    console.log("\n[5/5] Results");
    console.log("\nLast 500 chars of apply logs:");
    console.log(applyResult.logs.slice(-500));

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY - KUBERNETES RUNNER (with network latency)");
    console.log("=".repeat(60));
    console.log(`Plan time:  ${planResult.duration}ms (${(planResult.duration/1000).toFixed(1)}s) = ${(planResult.duration/60000).toFixed(2)} min`);
    console.log(`Apply time: ${applyResult.duration}ms (${(applyResult.duration/1000).toFixed(1)}s) = ${(applyResult.duration/60000).toFixed(2)} min`);
    console.log(`Total:      ${planResult.duration + applyResult.duration}ms = ${((planResult.duration + applyResult.duration)/60000).toFixed(2)} min`);
    console.log("=".repeat(60));

    console.log("\nCOMPARISON:");
    console.log("┌─────────────────────┬──────────────┬─────────────┐");
    console.log("│ Environment         │ Apply Time   │ vs K8s      │");
    console.log("├─────────────────────┼──────────────┼─────────────┤");
    console.log(`│ K8s (this)          │ ${(applyResult.duration/60000).toFixed(2)} min     │ 1.0x        │`);
    console.log("│ Docker (local)      │ ~4-5 min     │ ~1.0x       │");
    console.log("│ E2B                 │ ~14 min      │ ~3.0x       │");
    console.log("└─────────────────────┴──────────────┴─────────────┘");

    console.log("\n💡 This includes real network latency to your cluster!");

  } finally {
    // Cleanup ConfigMap
    console.log("\nCleaning up...");
    await kubectl(["delete", "configmap", configMapName, "-n", NAMESPACE, "--ignore-not-found"]);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
