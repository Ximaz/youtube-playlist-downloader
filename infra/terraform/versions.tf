terraform {
  required_version = ">= 1.5.0"

  required_providers {
    # Proxmox VE — VMs + Talos ISO download via the PVE API.
    proxmox = {
      source  = "bpg/proxmox"
      version = ">= 0.69.0"
    }
    # Talos — schematic, machine config, apply, bootstrap, kubeconfig.
    talos = {
      source  = "siderolabs/talos"
      version = ">= 0.7.0"
    }
    # Writes kubeconfig/talosconfig to disk (gitignored).
    local = {
      source  = "hashicorp/local"
      version = ">= 2.4.0"
    }
  }
}
