# YPD infrastructure

Talos Linux Kubernetes on Proxmox, provisioned by Terraform; Cilium for networking/LB; Helmfile +
Taskfile for the app and add-ons; SOPS for secrets. Cloud-agnostic — the same chart targets OVH
managed services later via values. See `../plan.md` for the full design.

> Status: **cluster Terraform is done + validated.** Add-ons (Cilium/cert-manager/ingress/KEDA) and
> the app Helm chart are the next steps.

## Topology (Proxmox `goliath`, 192.168.0.0/24)

| Role | VM | IP | vCPU | RAM | Disk |
|---|---|---|---|---|---|
| control-plane `ypd-cp-01` | ✅ | `.210` | 4 | 8 GiB | 20 GiB |
| worker `ypd-w-01` (stateful, pinned) | ✅ | `.211` | 8 | 16 GiB | 20 GiB + 40 GiB data |
| worker `ypd-w-02` | ✅ | `.212` | 8 | 16 GiB | 20 GiB |
| worker `ypd-w-03` | ✅ | `.213` | 8 | 16 GiB | 20 GiB |
| **K8s API VIP** (floating, not a VM) | — | `.201` | — | — | — |
| **Cilium ingress LB** (not a VM) | — | `.202` | — | — | — |

`.201`/`.202` are virtual IPs (Talos VIP / Cilium LB-IPAM), not machines. Flip `control_plane_ips` to
3 IPs for API HA. All tunables live in `terraform/terraform.tfvars`.

## Prerequisites on Proxmox (one-time)
1. **PVE ≥ 8 / 9** (goliath is 9.2.3). Storage: `local` allows VM images, `storage` allows the ISO.
2. **Terraform user + token** (run as root on the PVE host):
   ```sh
   pveum user add terraform@pve
   pveum role add Terraform -privs "<see plan.md / bpg docs>"
   pveum aclmod / -user terraform@pve -role Terraform
   pveum user token add terraform@pve provider --privsep=0     # prints the secret ONCE
   ```
3. **DHCP must be available on `vmbr0`** for Talos maintenance mode, and the static IPs `.210–.213`
   (+ `.201`, `.202`) must be **outside the router's DHCP pool** so they don't collide.

## Deploy the cluster
```sh
# secrets stay in the environment — never in a file or in git
export PROXMOX_VE_ENDPOINT="https://goliath.local:8006/"
export PROXMOX_VE_API_TOKEN="terraform@pve!provider=xxxxxxxx-...-xxxxxxxx"
ssh-add ~/.ssh/id_ed25519                 # ssh-agent auth (only used if the provider needs SSH)

cd infra
cp terraform/terraform.tfvars.example terraform/terraform.tfvars   # adjust if needed
task infra:plan      # review
task infra:up        # creates VMs, applies Talos config, bootstraps etcd
export KUBECONFIG="$PWD/kubeconfig"        # written by Terraform
kubectl get nodes -o wide                  # Ready once Cilium is installed (next step)
```
Terraform writes `infra/kubeconfig` and `infra/talosconfig` (both gitignored, 0600 — they're mTLS
credentials).

## Notes
- **Data persistence:** the 40 GiB disk on `ypd-w-01` is a durable Proxmox volume; Postgres/Valkey/
  SeaweedFS PVCs bind to it and **survive reboots/upgrades** (single replica, no cross-node
  replication yet — Longhorn is the later HA upgrade).
- **etcd at rest:** Talos LUKS2 encrypts the STATE+EPHEMERAL partitions (`disk_encryption_enabled`).
- **DNS (local testing):** point a private hostname at the ingress LB, e.g. dnsmasq/AdGuard on the Pi
  with `address=/ypd.pragmacode.fr/192.168.0.202` (avoid `.local`/`.com`). `/etc/hosts` works per-device
  to start.
- **TLS + Google OAuth:** you own `pragmacode.fr`, so cert-manager can mint a **real Let's Encrypt cert
  via DNS-01** even though the A record is a private IP — and Google sign-in works (as you've already
  verified). Tell me where `pragmacode.fr`'s DNS is hosted to wire the issuer; until then it's self-signed.
