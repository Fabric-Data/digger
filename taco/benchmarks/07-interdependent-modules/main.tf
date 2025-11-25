# Benchmark: Child Modules with Interdependencies
# Purpose: Test module dependency resolution and execution ordering

terraform {
  cloud {
    hostname = "otaco.app"
    organization = "org_01K8RTMAHF3QTTX62SSE0757AM"    
    workspaces {
      name = "benchmark-07-interdependent-modules"
    }
  }
}

# Layer 1: Base modules (no dependencies)
module "base" {
  count = 5

  source = "./modules/base-module"

  instance_name = "base-${count.index}"
}

# Layer 2: Intermediate modules (depend on base modules)
module "intermediate" {
  count = 10

  source = "./modules/intermediate-module"

  instance_name  = "intermediate-${count.index}"
  base_module_id = module.base[count.index % 5].output_id
}

# Layer 3: Advanced modules (depend on intermediate modules)
module "advanced" {
  count = 20

  source = "./modules/advanced-module"

  instance_name          = "advanced-${count.index}"
  intermediate_module_id = module.intermediate[count.index % 10].output_id
}

# Cross-dependencies: some advanced modules also reference base modules
module "cross_dependent" {
  count = 10

  source = "./modules/cross-dependent-module"

  instance_name          = "cross-${count.index}"
  base_output            = module.base[count.index % 5].output_id
  intermediate_output    = module.intermediate[count.index % 10].output_id
  advanced_output        = module.advanced[count.index % 20].output_id
}

output "all_outputs" {
  description = "Outputs from all module layers"
  value = {
    base           = module.base[*].output_id
    intermediate   = module.intermediate[*].output_id
    advanced       = module.advanced[*].output_id
    cross_dependent = module.cross_dependent[*].output_id
  }
}
