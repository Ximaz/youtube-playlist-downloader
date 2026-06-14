locals {
  # One map of every node (control-plane + worker) keyed by hostname.
  control_planes = {
    for i, ip in var.control_plane_ips :
    "${var.cluster_name}-cp-${format("%02d", i + 1)}" => {
      type   = "controlplane"
      ip     = ip
      cores  = var.cp_cores
      memory = var.cp_memory
      vmid   = var.vmid_base + i
      data   = false
    }
  }

  workers = {
    for i, ip in var.worker_ips :
    "${var.cluster_name}-w-${format("%02d", i + 1)}" => {
      type   = "worker"
      ip     = ip
      cores  = var.worker_cores
      memory = var.worker_memory
      vmid   = var.vmid_base + 10 + i
      data   = i == 0 # the first worker carries the persistent data disk; stateful pods pin here
    }
  }

  nodes = merge(local.control_planes, local.workers)

  cluster_endpoint = "https://${var.cluster_vip}:6443"

  # The maintenance-mode IP each VM gets from DHCP (reported by the qemu-guest-agent). The first
  # config apply targets this; the config then pins the node to its static IP. Requires DHCP on the
  # bridge and the static IPs (.210-.213) to be OUTSIDE the DHCP pool.
  node_maintenance_ip = {
    for k, vm in proxmox_virtual_environment_vm.node :
    k => try(
      [for ip in flatten(vm.ipv4_addresses) : ip if ip != "127.0.0.1" && !startswith(ip, "169.254.")][0],
      null,
    )
  }
}
