#!/bin/bash
#
# debug-terraform-local.sh
#
# Run the same 10k null_resource benchmark locally to establish a baseline.
# Compare this time against E2B to see the overhead.
#
# Usage:
#   cd sandbox-sidecar/scripts
#   chmod +x debug-terraform-local.sh
#   ./debug-terraform-local.sh
#

set -e

WORK_DIR="/tmp/terraform-benchmark-$$"
echo "============================================================"
echo "Local Terraform Performance Benchmark"
echo "============================================================"
echo "Work directory: $WORK_DIR"
echo "Terraform version: $(terraform version -json | jq -r '.terraform_version' 2>/dev/null || terraform version | head -1)"
echo "============================================================"

# Create work directory
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Create the benchmark terraform config
cat > main.tf << 'EOF'
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
EOF

echo ""
echo "[1/4] Created main.tf with 10,000 null_resources"
cat main.tf
echo ""

# Init
echo "[2/4] Running terraform init..."
INIT_START=$(date +%s%3N)
terraform init -input=false -no-color > /dev/null 2>&1
INIT_END=$(date +%s%3N)
INIT_TIME=$((INIT_END - INIT_START))
echo "Init time: ${INIT_TIME}ms"

# Apply
echo ""
echo "[3/4] Running terraform apply -parallelism=30..."
echo "Started at: $(date)"
APPLY_START=$(date +%s%3N)
terraform apply -auto-approve -input=false -no-color -parallelism=30 > /tmp/apply-local.log 2>&1
APPLY_END=$(date +%s%3N)
APPLY_TIME=$((APPLY_END - APPLY_START))
echo "Completed at: $(date)"
echo ""
echo "Last 10 lines of output:"
tail -10 /tmp/apply-local.log
echo ""

# Destroy
echo "[4/4] Running terraform destroy..."
DESTROY_START=$(date +%s%3N)
terraform destroy -auto-approve -input=false -no-color -parallelism=30 > /dev/null 2>&1
DESTROY_END=$(date +%s%3N)
DESTROY_TIME=$((DESTROY_END - DESTROY_START))

# Cleanup
cd /
rm -rf "$WORK_DIR"

# Summary
echo ""
echo "============================================================"
echo "SUMMARY - LOCAL MACHINE BASELINE"
echo "============================================================"
echo "Terraform init:  ${INIT_TIME}ms ($((INIT_TIME / 1000))s)"
echo "Terraform apply: ${APPLY_TIME}ms ($((APPLY_TIME / 1000))s) = $(echo "scale=2; $APPLY_TIME / 60000" | bc) minutes"
echo "Terraform destroy: ${DESTROY_TIME}ms ($((DESTROY_TIME / 1000))s)"
echo "============================================================"
echo ""
echo "Compare this to E2B results to see the overhead."
echo ""

if [ $APPLY_TIME -lt 60000 ]; then
  echo "✅ Local apply took < 1 minute - this is the target for E2B"
elif [ $APPLY_TIME -lt 120000 ]; then
  echo "🟡 Local apply took 1-2 minutes"
else
  echo "⚠️  Local apply took > 2 minutes - your machine might be slow too"
fi

