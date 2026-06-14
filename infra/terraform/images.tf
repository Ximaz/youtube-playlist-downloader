# Talos image with the qemu-guest-agent extension so Proxmox sees each VM's IP (needed to drive the
# first config apply). The schematic ID is deterministic from its contents.
resource "talos_image_factory_schematic" "this" {
  schematic = yamlencode({
    customization = {
      systemExtensions = {
        officialExtensions = ["siderolabs/qemu-guest-agent"]
      }
    }
  })
}

# Resolve the matching ISO + installer download URLs for our Talos version + schematic.
data "talos_image_factory_urls" "this" {
  talos_version = var.talos_version
  schematic_id  = talos_image_factory_schematic.this.id
  platform      = "metal"
  architecture  = "amd64"
}

# Download the ISO to Proxmox over the API (no SSH needed).
resource "proxmox_download_file" "talos_iso" {
  content_type = "iso"
  datastore_id = var.iso_datastore
  node_name    = var.pve_node
  file_name    = "talos-${var.talos_version}-${substr(talos_image_factory_schematic.this.id, 0, 12)}-amd64.iso"
  url          = data.talos_image_factory_urls.this.urls.iso
  overwrite    = false
}
