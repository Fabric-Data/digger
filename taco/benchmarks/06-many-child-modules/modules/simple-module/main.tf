variable "instance_name" {
  description = "Name for this module instance"
  type        = string
}

variable "resource_count" {
  description = "Number of resources to create in this module"
  type        = number
  default     = 10
}

resource "null_resource" "module_resource" {
  count = var.resource_count

  triggers = {
    instance = var.instance_name
    index    = count.index
  }
}

output "resource_ids" {
  description = "IDs of all resources in this module"
  value       = null_resource.module_resource[*].id
}
