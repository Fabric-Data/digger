# Benchmark: 10,000 Null Resources
# Purpose: Test performance with large number of resources

terraform {
  cloud {
    hostname = "otaco.app"
    organization = "org_01K8RTMAHF3QTTX62SSE0757AM"    
    workspaces {
      name = "benchmark-02-10k-nulls"
    }
  }
}

resource "null_resource" "massive" {
  count = 10000

  triggers = {
    index = count.index
  }
}
