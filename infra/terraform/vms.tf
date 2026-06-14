# One VM per node. Talos needs UEFI (ovmf) + q35 + host CPU + VirtIO; boots the ISO, installs to
# scsi0. See infra/docs/architecture.md.
resource "proxmox_virtual_environment_vm" "node" {
  for_each = local.nodes

  name      = each.key
  node_name = var.pve_node
  vm_id     = each.value.vmid
  tags      = sort(["talos", var.cluster_name, each.value.type])

  bios    = "ovmf"
  machine = "q35"

  cpu {
    cores = each.value.cores
    type  = "host"
  }

  memory {
    dedicated = each.value.memory
  }

  agent {
    enabled = true
  }

  operating_system {
    type = "l26"
  }

  efi_disk {
    datastore_id = var.vm_datastore
    type         = "4m"
  }

  # System disk — Talos installs here (qcow2 = thin-provisioned).
  disk {
    datastore_id = var.vm_datastore
    interface    = "scsi0"
    size         = var.system_disk_size
    file_format  = "qcow2"
  }

  # Persistent data disk on the stateful worker only — survives reboots/upgrades.
  dynamic "disk" {
    for_each = each.value.data ? [1] : []
    content {
      datastore_id = var.data_datastore
      interface    = "scsi1"
      size         = var.data_disk_size
      file_format  = "qcow2"
    }
  }

  cdrom {
    file_id = proxmox_download_file.talos_iso.id
  }

  network_device {
    bridge = var.network_bridge
    model  = "virtio"
  }

  # Disk first; empty disk falls through to the ISO (maintenance mode); installed disk is bootable.
  boot_order = ["scsi0", "ide3"]

  started = true

  lifecycle {
    # Guest agent updates these post-boot; don't churn the VM on IP changes.
    ignore_changes = [started]
  }
}
