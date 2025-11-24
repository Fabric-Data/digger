variable "instance_name" {
  description = "Name for this module instance"
  type        = string
}

resource "null_resource" "base" {
  count = 5

  triggers = {
    instance = var.instance_name
    index    = count.index
  }
}

output "output_id" {
  description = "Aggregate ID from base resources"
  value       = join("-", null_resource.base[*].id)
}
