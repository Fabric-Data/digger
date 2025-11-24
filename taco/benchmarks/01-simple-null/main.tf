# Benchmark: Simple Null Resource
# Purpose: Baseline test for minimal Terraform execution overhead

terraform {
  cloud {
    hostname = "otaco.app"
    organization = "org_01K8RTMAHF3QTTX62SSE0757AM"    
    workspaces {
      name = "028448c3-cefd-42c2-872c-f8ce055b5554"
    }
  }
}

resource "null_resource" "simple" {
  triggers = {
    timestamp = timestamp()
  }
}
