# Cluster-wide secrets (CA + keys). Treated as sensitive in state — keep the backend secure.
resource "talos_machine_secrets" "this" {
  talos_version = var.talos_version
}

locals {
  # First VirtIO SCSI disk Talos installs onto.
  install_disk = "/dev/sda"

  # Applied to every node: install target + image (so the qemu-guest-agent extension persists after
  # install), DNS, CNI=none + kube-proxy disabled (Cilium provides both), and optional LUKS2 disk
  # encryption of STATE+EPHEMERAL → etcd-at-rest (ADR-0008's LUKS, defense-in-depth with K8s secret
  # encryption added later).
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

  # Applied ONLY to the stateful worker (data == true). Two extra config documents:
  #  1. machine.nodeLabels — so the chart's local-path provisioner + StatefulSets pin here by LABEL
  #     (robust against the random auto-stable hostname).
  #  2. UserVolumeConfig — provision + mount the second virtio disk (sdb, the only non-system disk)
  #     as a Talos user volume at /var/mnt/data. Talos creates the partition + xfs and mounts it; the
  #     volume survives reboots and OS upgrades (unlike EPHEMERAL on a reset). minSize floor only →
  #     the partition grows to fill the disk. Added as a SEPARATE document (kind != Config) so the
  #     configpatcher appends it rather than merging into v1alpha1.Config.
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

# Per-node machine config: common patch + hostname + static IP (+ the API VIP on control-planes).
# Interface is matched by driver (virtio_net) rather than a guessed name like eth0/ens18.
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
      # NOTE: hostname is intentionally NOT set under machine.network — Talos 1.12 emits a separate
      # `HostnameConfig` document (auto: stable), and setting it in both places is rejected
      # ("static hostname is already set in v1alpha1 config"). Per-node static IP + the control-plane
      # VIP go here; the interface is matched by driver (the NIC is ens18 on Proxmox).
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
    # The stateful worker also gets the data-disk user volume + the ypd.io/data label.
    each.value.data ? local.data_node_patches : [],
  )
}
