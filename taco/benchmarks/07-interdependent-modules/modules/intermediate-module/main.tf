variable "instance_name" {
  description = "Name for this module instance"
  type        = string
}

variable "base_module_id" {
  description = "ID from the base module this depends on"
  type        = string
}

resource "null_resource" "intermediate" {
  count = 3

  triggers = {
    instance      = var.instance_name
    index         = count.index
    base_dependency = var.base_module_id
  }
}

output "output_id" {
  description = "Aggregate ID from intermediate resources"
  value       = join("-", null_resource.intermediate[*].id)
}
