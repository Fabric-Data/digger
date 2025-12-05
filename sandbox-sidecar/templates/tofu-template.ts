// templates/tofu-template.ts
import { Template } from "e2b";

// Common providers to pre-cache in templates for faster init
// These are the most commonly used providers across Terraform/OpenTofu projects
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

export function tofuTemplate(version: string) {
  return Template()
    .fromUbuntuImage("22.04")
    .setUser("root")
    .runCmd("apt-get update && apt-get install -y wget unzip ca-certificates")
    .runCmd(`
      set -e
      cd /tmp
      echo "Installing OpenTofu ${version}..."
      # OpenTofu releases use a zip file, not tar.gz
      wget -O tofu.zip https://github.com/opentofu/opentofu/releases/download/v${version}/tofu_${version}_linux_amd64.zip
      unzip tofu.zip
      chmod +x tofu
      mv tofu /usr/local/bin/tofu
      rm tofu.zip
      # Verify installation
      /usr/local/bin/tofu version
    `)
    // Pre-extract common providers during template build for instant init at runtime
    // Using tofu init downloads and extracts providers, then we move them to a shared location
    .runCmd(`
      set -e
      echo "Pre-extracting OpenTofu providers..."
      mkdir -p /usr/share/terraform/providers
      cd /tmp
      cat > providers.tf << 'TFEOF'
${CACHED_PROVIDERS}
TFEOF
      # Initialize to download and extract providers
      tofu init -input=false
      # Move extracted providers to shared location (already in correct layout for -plugin-dir)
      mv .terraform/providers/* /usr/share/terraform/providers/
      rm -rf /tmp/providers.tf /tmp/.terraform /tmp/.terraform.lock.hcl
      echo "Provider extraction complete. Pre-extracted providers:"
      find /usr/share/terraform/providers -type f -name "terraform-provider-*" | head -20
    `)
    .setUser("user");
}
