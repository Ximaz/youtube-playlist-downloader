# Apply each node's config to its maintenance (DHCP) address; the config then moves the node to its
# static IP. Re-runs target the static IP (the agent reports it once configured), so this is stable.
resource "talos_machine_configuration_apply" "node" {
  for_each = local.nodes

  client_configuration        = talos_machine_secrets.this.client_configuration
  machine_configuration_input = data.talos_machine_configuration.node[each.key].machine_configuration
  node                        = local.node_maintenance_ip[each.key]
  endpoint                    = local.node_maintenance_ip[each.key]
}

# Bootstrap etcd on the first control-plane (exactly once, after its config is applied).
resource "talos_machine_bootstrap" "this" {
  depends_on = [talos_machine_configuration_apply.node]

  node                 = var.control_plane_ips[0]
  endpoint             = var.control_plane_ips[0]
  client_configuration = talos_machine_secrets.this.client_configuration
}

# talosconfig (mTLS client config) pointing at the control-plane endpoints.
data "talos_client_configuration" "this" {
  cluster_name         = var.cluster_name
  client_configuration = talos_machine_secrets.this.client_configuration
  endpoints            = var.control_plane_ips
  nodes                = concat(var.control_plane_ips, var.worker_ips)
}

# Retrieve the kubeconfig once etcd is bootstrapped.
resource "talos_cluster_kubeconfig" "this" {
  depends_on = [talos_machine_bootstrap.this]

  node                 = var.control_plane_ips[0]
  endpoint             = var.cluster_vip
  client_configuration = talos_machine_secrets.this.client_configuration
}

# Write both credentials to infra/ (gitignored, 0600).
resource "local_file" "talosconfig" {
  content         = data.talos_client_configuration.this.talos_config
  filename        = "${path.module}/../talosconfig"
  file_permission = "0600"
}

resource "local_file" "kubeconfig" {
  content         = talos_cluster_kubeconfig.this.kubeconfig_raw
  filename        = "${path.module}/../kubeconfig"
  file_permission = "0600"
}
