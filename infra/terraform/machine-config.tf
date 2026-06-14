# Cluster-wide secrets (CA + keys). Sensitive in state — keep the backend secure.
resource "talos_machine_secrets" "this" {
  talos_version = var.talos_version
}

locals {
  # First VirtIO SCSI disk Talos installs onto.
  install_disk = "/dev/sda"

  # Applied to every node: install target + image (persists the qemu-guest-agent extension), DNS,
  # CNI=none + kube-proxy disabled (Cilium provides both), optional LUKS2 of STATE+EPHEMERAL.
  common_patch = yamlencode({
    machine = merge(
      {
        install = {
          disk  = local.install_disk
          image = data.talos_image_factory_urls.this.urls.installer
        }
        network = {
          nameservers = var.dns_servers
        }
      },
      var.disk_encryption_enabled ? {
        systemDiskEncryption = {
          state     = { provider = "luks2", keys = [{ nodeID = {}, slot = 0 }] }
          ephemeral = { provider = "luks2", keys = [{ nodeID = {}, slot = 0 }] }
        }
      } : {},
    )
    cluster = {
      network = { cni = { name = "none" } } # Cilium installed after bootstrap
      proxy   = { disabled = true }         # Cilium kube-proxy replacement
    }
  })

  # Applied ONLY to the stateful worker (data == true): a nodeLabel so the chart pins here by LABEL,
  # and a UserVolumeConfig mounting the second virtio disk at /var/mnt/data (survives reboots/upgrades).
  # Separate document (kind != Config) so configpatcher appends rather than merges. See infra/docs/architecture.md.
  data_node_patches = [
    yamlencode({
      machine = {
        nodeLabels = {
          "ypd.io/data" = "true"
        }
      }
    }),
    yamlencode({
      apiVersion = "v1alpha1"
      kind       = "UserVolumeConfig"
      name       = "data"
      provisioning = {
        diskSelector = {
          match = "disk.transport == 'virtio' && !system_disk"
        }
        minSize = "10GiB"
      }
      filesystem = {
        type = "xfs"
      }
    }),
  ]
}

# Per-node machine config: common patch + hostname + static IP (+ API VIP on control-planes).
data "talos_machine_configuration" "node" {
  for_each = local.nodes

  cluster_name       = var.cluster_name
  cluster_endpoint   = local.cluster_endpoint
  machine_type       = each.value.type
  machine_secrets    = talos_machine_secrets.this.machine_secrets
  talos_version      = var.talos_version
  kubernetes_version = var.kubernetes_version != "" ? var.kubernetes_version : null

  config_patches = concat(
    [
      local.common_patch,
      # NOTE: hostname is intentionally NOT set here — Talos 1.12 emits a separate HostnameConfig
      # (auto: stable), and setting it in both places is rejected. Interface matched by driver (virtio_net).
      yamlencode({
        machine = {
          network = {
            interfaces = [
              merge(
                {
                  deviceSelector = { driver = "virtio_net" }
                  addresses      = ["${each.value.ip}/${var.subnet_prefix}"]
                  routes         = [{ network = "0.0.0.0/0", gateway = var.gateway }]
                },
                each.value.type == "controlplane" ? { vip = { ip = var.cluster_vip } } : {},
              )
            ]
          }
        }
      }),
    ],
    # Stateful worker also gets the data-disk user volume + the ypd.io/data label.
    each.value.data ? local.data_node_patches : [],
  )
}
