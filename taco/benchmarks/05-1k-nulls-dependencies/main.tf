# Benchmark: 1,000 Null Resources with Dependencies
# Purpose: Test dependency graph resolution and parallel execution limits

terraform {
  cloud {
    hostname = "otaco.app"
    organization = "org_01K8RTMAHF3QTTX62SSE0757AM"    
    workspaces {
      name = "028448c3-cefd-42c2-872c-f8ce055b5554"
    }
  }
}

# Base resource
resource "null_resource" "base" {
  triggers = {
    timestamp = timestamp()
  }
}

# Create 1000 resources, each depending on the previous one (chain)
resource "null_resource" "chain" {
  count = 1000

  triggers = {
    index    = count.index
    previous = count.index == 0 ? null_resource.base.id : null_resource.chain[count.index - 1].id
  }

  depends_on = count.index == 0 ? [null_resource.base] : [null_resource.chain[count.index - 1]]
}

# Additional layer: create resources that depend on every 10th chain resource
resource "null_resource" "dependent_layer" {
  count = 100

  triggers = {
    index     = count.index
    reference = null_resource.chain[count.index * 10].id
  }

  depends_on = [null_resource.chain]
}

# Final aggregator depending on all dependent_layer resources
resource "null_resource" "aggregator" {
  triggers = {
    all_dependencies = join(",", null_resource.dependent_layer[*].id)
  }

  depends_on = [null_resource.dependent_layer]
}
