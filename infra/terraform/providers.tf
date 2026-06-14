# Proxmox provider. Endpoint + API token come from the environment (PROXMOX_VE_ENDPOINT, PROXMOX_VE_API_TOKEN) so no secret lands in a file. See infra/docs/architecture.md.
provider "proxmox" {
  insecure = var.proxmox_insecure

  # SSH only for ops the API can't do (snippet/file/disk-import); the ISO-boot flow doesn't need it.
  # NOTE: if an SSH op is triggered, this user needs passwordless sudo for pvesm/qm/tee.
  ssh {
    agent    = true
    username = var.proxmox_ssh_username
  }
}

provider "talos" {}
