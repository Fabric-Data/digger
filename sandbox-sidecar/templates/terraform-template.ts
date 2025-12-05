// templates/terraform-template.ts
import { Template } from "e2b";

// Common providers to pre-cache in templates for faster init
// These are the most commonly used providers across Terraform projects
const CACHED_PROVIDERS = `
terraform {
  required_providers {
    aws        = { source = "hashicorp/aws",        version = "~> 5.0" }
    google     = { source = "hashicorp/google",     version = "~> 5.0" }
    azurerm    = { source = "hashicorp/azurerm",    version = "~> 3.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.0" }
    helm       = { source = "hashicorp/helm",       version = "~> 2.0" }
    random     = { source = "hashicorp/random",     version = "~> 3.0" }
    null       = { source = "hashicorp/null",       version = "~> 3.0" }
    local      = { source = "hashicorp/local",      version = "~> 2.0" }
    tls        = { source = "hashicorp/tls",        version = "~> 4.0" }
    time       = { source = "hashicorp/time",       version = "~> 0.9" }
  }
}
`;

export function terraformTemplate(version: string) {
  // version like "1.5.7"
  return Template()
    .fromUbuntuImage("22.04")

    // root for system-level install
    .setUser("root")
    .runCmd("apt-get update && apt-get install -y wget unzip ca-certificates")
    .runCmd(`
      set -e
      cd /tmp
      echo "Installing Terraform ${version}..."
      wget -O terraform.zip https://releases.hashicorp.com/terraform/${version}/terraform_${version}_linux_amd64.zip
      unzip terraform.zip
      mv terraform /usr/local/bin/terraform
      chmod +x /usr/local/bin/terraform
      rm terraform.zip
    `)
    // Pre-extract common providers during template build for instant init at runtime
    // Using terraform init downloads and extracts providers, then we move them to a shared location
    .runCmd(`
      set -e
      echo "Pre-extracting Terraform providers..."
      mkdir -p /usr/share/terraform/providers
      cd /tmp
      cat > providers.tf << 'TFEOF'
${CACHED_PROVIDERS}
TFEOF
      # Initialize to download and extract providers
      terraform init -input=false
      # Move extracted providers to shared location (already in correct layout for -plugin-dir)
      mv .terraform/providers/* /usr/share/terraform/providers/
      rm -rf /tmp/providers.tf /tmp/.terraform /tmp/.terraform.lock.hcl
      echo "Provider extraction complete. Pre-extracted providers:"
      find /usr/share/terraform/providers -type f -name "terraform-provider-*" | head -20
    `)

    // back to normal user for sandbox runtime
    .setUser("user");
}
