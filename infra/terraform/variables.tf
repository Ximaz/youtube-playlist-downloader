# ---------------------------------------------------------------------------- Proxmox
variable "proxmox_insecure" {
  description = "Accept the self-signed Proxmox API certificate (true on a LAN)."
  type        = bool
  default     = true
}

variable "proxmox_ssh_username" {
  description = "SSH user on the PVE host (sudoer) for the provider's file/disk operations."
  type        = string
  default     = "malo"
}

variable "pve_node" {
  description = "Proxmox node name that hosts the VMs."
  type        = string
  default     = "goliath"
}

variable "vm_datastore" {
  description = "Datastore for VM system disks (must allow 'images')."
  type        = string
  default     = "local"
}

variable "iso_datastore" {
  description = "Datastore for the downloaded Talos ISO (must allow 'iso')."
  type        = string
  default     = "storage"
}

variable "data_datastore" {
  description = "Datastore for the persistent StatefulSet data disk (must allow 'images')."
  type        = string
  default     = "local"
}

# ---------------------------------------------------------------------------- Network
variable "network_bridge" {
  description = "Proxmox bridge the VMs attach to."
  type        = string
  default     = "vmbr0"
}

variable "subnet_prefix" {
  description = "CIDR prefix length of the node subnet (e.g. 24 for 192.168.0.0/24)."
  type        = number
  default     = 24
}

variable "gateway" {
  description = "Default gateway for the nodes."
  type        = string
  default     = "192.168.0.254"
}

variable "dns_servers" {
  description = "DNS resolvers for the nodes."
  type        = list(string)
  default     = ["192.168.0.254"]
}

# ---------------------------------------------------------------------------- Cluster
variable "cluster_name" {
  description = "Talos/Kubernetes cluster name."
  type        = string
  default     = "ypd"
}

variable "cluster_vip" {
  description = "Floating VIP for the Kubernetes API server (HA-ready; works with one control-plane)."
  type        = string
  default     = "192.168.0.201"
}

variable "loadbalancer_pool" {
  description = "IP range Cilium LB-IPAM hands to Service type=LoadBalancer (ingress). Used by the bootstrap step, surfaced here for the plan."
  type        = string
  default     = "192.168.0.202/32"
}

# ---------------------------------------------------------------------------- Topology
variable "control_plane_ips" {
  description = "Static IPs for the control-plane nodes (length = control-plane count; use 3 for HA)."
  type        = list(string)
  default     = ["192.168.0.210"]
}

variable "worker_ips" {
  description = "Static IPs for the worker nodes."
  type        = list(string)
  default     = ["192.168.0.211", "192.168.0.212", "192.168.0.213"]
}

# ---------------------------------------------------------------------------- Sizing
variable "cp_cores" {
  type    = number
  default = 4
}
variable "cp_memory" {
  description = "Control-plane RAM in MiB."
  type        = number
  default     = 8192
}
variable "worker_cores" {
  type    = number
  default = 8
}
variable "worker_memory" {
  description = "Worker RAM in MiB."
  type        = number
  default     = 16384
}
variable "system_disk_size" {
  description = "Per-node system disk size in GiB."
  type        = number
  default     = 20
}
variable "data_disk_size" {
  description = "Persistent data disk (on the first worker) in GiB — survives reboots/upgrades."
  type        = number
  default     = 40
}
variable "vmid_base" {
  description = "Base Proxmox VMID; control-planes get base+i, workers base+10+i."
  type        = number
  default     = 9000
}

# ---------------------------------------------------------------------------- Talos
variable "talos_version" {
  description = "Talos Linux version (image factory + machine secrets)."
  type        = string
  default     = "v1.12.7"
}

variable "kubernetes_version" {
  description = "Kubernetes version. Must be within Talos `talos_version`'s supported range (the provider's default can be too new). Talos 1.12.7 supports up to 1.35."
  type        = string
  default     = "1.34.1"
}

variable "disk_encryption_enabled" {
  description = "Enable Talos LUKS2 encryption of STATE+EPHEMERAL (etcd-at-rest = ADR-0008's LUKS)."
  type        = bool
  default     = true
}
