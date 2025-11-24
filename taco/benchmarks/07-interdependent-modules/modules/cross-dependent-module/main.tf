variable "instance_name" {
  description = "Name for this module instance"
  type        = string
}

variable "base_output" {
  description = "Output from base module"
  type        = string
}

variable "intermediate_output" {
  description = "Output from intermediate module"
  type        = string
}

variable "advanced_output" {
  description = "Output from advanced module"
  type        = string
}

resource "null_resource" "cross_dependent" {
  triggers = {
    instance     = var.instance_name
    base_ref     = var.base_output
    inter_ref    = var.intermediate_output
    advanced_ref = var.advanced_output
  }
}

output "output_id" {
  description = "ID from cross-dependent resource"
  value       = null_resource.cross_dependent.id
}
