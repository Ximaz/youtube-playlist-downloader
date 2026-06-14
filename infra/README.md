# YPD infrastructure

Talos Linux Kubernetes on Proxmox, provisioned by Terraform; Cilium for networking/LB; Helmfile +
Taskfile for the add-ons and app; SOPS+age for secrets. Cloud-agnostic — the same chart targets OVH
managed services later via values.

> **Design reference:** [`docs/architecture.md`](docs/architecture.md). **Decisions:** ADR-0019 in
> [`../docs/decisions/README.md`](../docs/decisions/README.md). This file is the operator runbook.

> Status: **cluster + add-ons + storage are live.** The app Helm chart deploys with `task deploy`.

## Topology (Proxmox `goliath`, 192.168.0.0/24)

| Role | VM | IP | vCPU | RAM | Disk |
|---|---|---|---|---|---|
| control-plane `ypd-cp-01` | ✅ | `.210` | 4 | 8 GiB | 20 GiB |
| worker `ypd-w-01` (stateful, pinned `ypd.io/data`) | ✅ | `.211` | 8 | 16 GiB | 20 GiB + 40 GiB data |
| worker `ypd-w-02` | ✅ | `.212` | 8 | 16 GiB | 20 GiB |
| worker `ypd-w-03` | ✅ | `.213` | 8 | 16 GiB | 20 GiB |
| **K8s API VIP** (floating, not a VM) | — | `.201` | — | — | — |
| **Cilium ingress LB** (not a VM) | — | `.202` | — | — | — |

`.201`/`.202` are virtual IPs (Talos VIP / Cilium LB-IPAM), not machines. Flip `control_plane_ips` to
3 IPs for API HA. All tunables live in `terraform/terraform.tfvars`.

## Tooling prerequisites

`terraform`, `talosctl`, `kubectl`, `helmfile`, `sops`, `age`, `kubeconform`, `go-task`, plus:

> **Helm 3 at `~/.local/bin/helm3`.** Helm 4's reworked plugin format + `--wait` hang helmfile and
> the webhook charts (cert-manager/ingress-nginx), and break the `helm secrets` subcommand. Everything
> here drives **Helm 3** with an isolated plugin dir (`~/.config/helm3-plugins`). Install:
> ```sh
> curl -fsSL https://get.helm.sh/helm-v3.17.3-darwin-arm64.tar.gz | tar -xz -C /tmp
> mv /tmp/darwin-arm64/helm ~/.local/bin/helm3 && chmod +x ~/.local/bin/helm3
> ```
> (helm-diff/helm-secrets are NOT required — `task deploy` decrypts with `sops` directly.)

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

## 1. Deploy the cluster
```sh
export PROXMOX_VE_ENDPOINT="https://goliath.local:8006/"   # non-secret
# Put the API token in infra/.proxmox.env (gitignored): PROXMOX_VE_API_TOKEN="terraform@pve!provider=…"
cd infra && set -a && source .proxmox.env && set +a
cp terraform/terraform.tfvars.example terraform/terraform.tfvars   # adjust if needed
task infra:plan && task infra:up        # VMs → Talos config → etcd bootstrap → writes kubeconfig/talosconfig
export KUBECONFIG="$PWD/kubeconfig"
```
Terraform writes `infra/kubeconfig` + `infra/talosconfig` (gitignored, 0600 — mTLS creds). The stateful
worker's 2nd disk is provisioned as a Talos user volume at `/var/mnt/data` and the node is labelled
`ypd.io/data=true` (see `terraform/machine-config.tf`).

## 2. Add-ons (Cilium reconcile + cert-manager + ingress-nginx + KEDA + local-path)
```sh
task cluster:addons        # helmfile sync (Helm 3) + the local-path provisioner
```
Verify: `kubectl get svc -n ingress-nginx` shows `.202`; `kubectl get clusterissuer` shows `ypd-ca`
Ready; `kubectl get sc` shows `local-path` (default).

## 3. Secrets (SOPS + age, vault-free)
```sh
age-keygen -o ~/.config/sops/age/keys.txt          # one-time; the PUBLIC key goes in secrets/.sops.yaml
cp secrets/secrets.example.yaml secrets/secrets.yaml
$EDITOR secrets/secrets.yaml                        # fill real creds (mind the cross-equality notes)
sops -e secrets/secrets.yaml > secrets/secrets.sops.yaml && rm secrets/secrets.yaml
```
Only `stringData` is encrypted; the encrypted `secrets.sops.yaml` is safe to commit. The plaintext
`secrets/secrets.yaml` is gitignored. The age PRIVATE key never leaves the operator.

## 4. Deploy the app
```sh
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
task deploy        # creates ns ypd (baseline PSS), `sops -d | kubectl apply` the Secrets, helm3 upgrade
```
The chart references the Secrets by name (`existingSecret`) — credentials never pass through Helm.
Flip any dep to a managed service later with `-f helm/ypd/values-ovh.yaml` (no image change).

## Notes
- **Data persistence:** the 40 GiB disk on `ypd-w-01` is a durable Talos user volume (`/var/mnt/data`);
  Postgres/Valkey/SeaweedFS PVCs (local-path, pinned via `ypd.io/data`) bind to it and **survive
  reboots/upgrades** — single replica, no cross-node replication yet (Longhorn is the later HA upgrade).
- **etcd at rest:** Talos LUKS2 encrypts STATE+EPHEMERAL (`disk_encryption_enabled`).
- **DNS (local testing):** `pragmacode.fr` is **not owned** — it's faked by dnsmasq. Point the host at
  the ingress LB: `address=/ypd.pragmacode.fr/192.168.0.202` (or `/etc/hosts` per device).
- **TLS:** no public domain ⇒ no ACME. cert-manager issues from a **self-signed local CA** (`ypd-ca`).
  Trust `ypd-ca-tls`'s `ca.crt` on test devices to drop the browser warning. Google OAuth still works
  on the fake domain + self-signed cert (Google doesn't verify redirect-URI ownership).
