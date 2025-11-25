# Benchmark: Root Module with Many Child Modules
# Purpose: Test module loading and initialization performance

terraform {
  cloud {
    hostname = "otaco.app"
    organization = "org_01K8RTMAHF3QTTX62SSE0757AM"    
    workspaces {
      name = "benchmark-06-many-child-modules"
    }
  }
}

# Call the child module 50 times
module "child" {
  count = 50

  source = "./modules/simple-module"

  instance_name = "child-${count.index}"
  resource_count = 10
}

output "module_outputs" {
  description = "Outputs from all child modules"
  value = {
    for idx, mod in module.child : idx => mod.resource_ids
  }
}
