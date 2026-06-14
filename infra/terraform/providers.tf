# The Proxmox endpoint + API token are read from the environment so no secret lands in a file:
#   export PROXMOX_VE_ENDPOINT="https://goliath.local:8006/"
#   export PROXMOX_VE_API_TOKEN="terraform@pve!provider=xxxxxxxx-...-xxxxxxxx"
# `insecure = true` accepts the self-signed PVE cert on a LAN.
provider "proxmox" {
  insecure = var.proxmox_insecure

  # SSH is only used by the provider for operations the API can't do (snippet/file/disk-import).
  # The Talos ISO-boot flow does not need them, but we configure SSH so it's available if a future
  # op requires it. Uses your loaded ssh-agent key; `username` is a sudoer on the PVE host.
  # NOTE: if an SSH op is ever triggered, that user needs passwordless sudo for pvesm/qm/tee.
  ssh {
    agent    = true
    username = var.proxmox_ssh_username
  }
}

provider "talos" {}
