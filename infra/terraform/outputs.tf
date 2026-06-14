output "kubeconfig_path" {
  description = "Path to the generated kubeconfig (use with kubectl/helm)."
  value       = local_file.kubeconfig.filename
}

output "talosconfig_path" {
  description = "Path to the generated talosconfig (use with talosctl)."
  value       = local_file.talosconfig.filename
}

output "cluster_endpoint" {
  description = "Kubernetes API endpoint (control-plane VIP)."
  value       = local.cluster_endpoint
}

output "control_plane_ips" {
  value = var.control_plane_ips
}

output "worker_ips" {
  value = var.worker_ips
}

output "loadbalancer_pool" {
  description = "IP range Cilium hands to the ingress Service (bootstrap step consumes this)."
  value       = var.loadbalancer_pool
}

output "kubeconfig_raw" {
  description = "Raw kubeconfig contents."
  value       = talos_cluster_kubeconfig.this.kubeconfig_raw
  sensitive   = true
}
