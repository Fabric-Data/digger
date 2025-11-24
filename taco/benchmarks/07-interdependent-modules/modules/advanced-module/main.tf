variable "instance_name" {
  description = "Name for this module instance"
  type        = string
}

variable "intermediate_module_id" {
  description = "ID from the intermediate module this depends on"
  type        = string
}

resource "null_resource" "advanced" {
  count = 2

  triggers = {
    instance             = var.instance_name
    index                = count.index
    intermediate_dependency = var.intermediate_module_id
  }
}

output "output_id" {
  description = "Aggregate ID from advanced resources"
  value       = join("-", null_resource.advanced[*].id)
}
