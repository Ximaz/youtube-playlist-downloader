# YPD infrastructure — architecture

How YPD is deployed to Kubernetes. This is the design reference; [`../README.md`](../README.md) is the
operator runbook and [`docs/decisions/README.md`](../../docs/decisions/README.md) (ADR-0019) records the
load-bearing decisions. The code keeps only terse, point-of-use comments — the "why" lives here.

> **Stack:** Talos Linux (Terraform) → Cilium → Helmfile + Taskfile → one Helm chart → SOPS+age
> secrets. The same chart targets a managed cloud (OVH) by flipping values — no image change.

---

## 1. Topology & networking

A 4-node cluster on a single Proxmox host (`goliath`), `192.168.0.0/24`:

| Role | Node | IP | Notes |
|---|---|---|---|
| control-plane | `ypd-cp-01` | `.210` | etcd + API server |
| worker (stateful) | `ypd-w-01` | `.211` | carries the data disk; labelled `ypd.io/data=true` |
| worker | `ypd-w-02` | `.212` | |
| worker | `ypd-w-03` | `.213` | |
| **API VIP** | — | `.201` | Talos floating VIP (HA-ready) |
| **Ingress LB** | — | `.202` | Cilium LB-IPAM, L2-announced |

`.201` and `.202` are **virtual IPs, not machines**. The Kubernetes API is reached through the Talos
VIP `.201`; all ingress traffic enters through `.202`.

**Cilium does everything network.** Talos ships no CNI and disables kube-proxy, so Cilium provides the
CNI, the **kube-proxy replacement** (it dials the API at the VIP `.201`), and the **bare-metal
LoadBalancer**: a single-IP pool (`.202/32`) hands its address to the ingress controller Service, and
an **L2 announcement policy** ARPs that IP from one node on `ens18` — no MetalLB. One node answers ARP
for `.202` at a time; Cilium's eBPF datapath forwards the TCP traffic to the ingress pods.

> **Testing the VIP:** use `curl`/HTTP, not `ping`/`traceroute`. The L2-announced VIP forwards TCP but
> does not answer ICMP/UDP probes, so `ping .202` and `traceroute` to it fail even when HTTP works.

The browser talks **only** to the frontend (the Nuxt BFF) on its vhost; `/api` and `/socket.io` are
proxied internally by Nitro. The Ingress therefore declares exactly one host and routes only to the
frontend Service — requests to the bare IP or a different host hit ingress-nginx's default-backend 404.

---

## 2. Storage & persistence

The stateful worker (`ypd-w-01`) has a second disk provisioned as a **Talos user volume** mounted at
`/var/mnt/data` (`terraform/machine-config.tf`). Unlike the EPHEMERAL partition, a user volume on a
dedicated disk **survives reboots and OS upgrades**.

`local-path-provisioner` (vendored from the official Rancher manifest, pinned) is the default
StorageClass. Its `nodePathMap` routes **every** PV to `/var/mnt/data`, and `volumeBindingMode:
WaitForFirstConsumer` binds the PV on the node where the consuming pod schedules. The in-cluster
StatefulSets carry `nodeSelector: ypd.io/data=true`, so their PVs always land on the data node —
**pinning by node label, not name**, so it survives a hostname change.

Today the data deps are single-replica StatefulSets on node-local disk: **persistence without HA**.
Cross-node replicated storage (Longhorn) is the documented HA upgrade.

---

## 3. Bootstrap add-ons

Installed by `bootstrap/helmfile.yaml.gotmpl` (`task cluster:addons`), pinned in `versions.env`:

- **Cilium** — declared here so it reconciles from one source of truth (a `helmfile diff` on it is a
  no-op apart from the Hubble self-signed certs Helm regenerates each render).
- **cert-manager** — issues TLS. The domain is **not publicly owned** (faked by local DNS), so there is
  no ACME/Let's Encrypt. Instead a self-signed root mints a long-lived **local CA** (`ypd-ca`), and the
  Ingress requests certs from the `ypd-ca` ClusterIssuer. Trust `ypd-ca-tls`'s `ca.crt` on a device to
  drop the browser warning. Swapping to a real ACME issuer on an owned domain is values-only.
- **ingress-nginx** — the single `type=LoadBalancer` Service (Cilium pins it to `.202`). Configured for
  WebSocket upgrades and long read/send timeouts (3600s) for live progress + archive streaming.
- **KEDA** — event-driven autoscaler for the worker tier (see §5).
- **local-path-provisioner** — see §2.
- **kube-prometheus-stack** + **blackbox-exporter** (namespace `monitoring`) — Prometheus, Grafana,
  node-exporter, kube-state-metrics, and HTTP-route probing. The whole observability story is §9.

---

## 4. The application chart (`helm/ypd/`)

One chart, per-component template folders. `values.yaml` is the cloud-agnostic default;
`values-proxmox.yaml` / `values-ovh.yaml` are thin overlays.

### Components

| Component | Image | Port | Notes |
|---|---|---|---|
| backend-api | `ypd-backend` | 3000 | REST + WS gateway + enqueue; owns migrations |
| backend-worker | `ypd-worker` | 3000 | BullMQ download/convert pools; KEDA-scaled; no Service |
| frontend | `ypd-frontend` | 8080 | Nuxt SPA + BFF (the only ingress target) |
| provider-ytdl | `ypd-provider-ytdl` | 5000 | yt-dlp |
| provider-youtubejs | `ypd-provider-youtubejs` | 5001 | youtubei.js |
| provider-pot | `brainicism/bgutil-…` (upstream) | 4416 | PO-token sidecar (optional) |

Stateful deps (rendered only when `inCluster`): **Valkey** (cache + queue), **Postgres** (sessions +
OAuth), **SeaweedFS** (S3). Plus a migrate Job, a prune CronJob, ConfigMaps, the dev-only Secret, the
KEDA ScaledObject, CPU HPAs, PDBs, the Ingress, NetworkPolicies (gated off), and ServiceAccounts.

### Probes

`/health` is **liveness** — dependency-free, always 200, so a dependency outage never crash-loops a
pod. `/ready` is **readiness** — it checks every downstream (the API also does a Postgres `SELECT 1`;
the worker has no DB). The frontend uses the dependency-free `/healthz`. Readiness gates traffic and
rollout; liveness only restarts a wedged process.

### securityContext

UIDs are pinned to each image's real runtime user (discovered, not guessed): backend/worker `1000`,
frontend `1001`, provider-ytdl `10001`, provider-youtubejs `100`. Valkey (`999`) and SeaweedFS (`1000`)
override the image entrypoint so they get a pinned non-root UID + `fsGroup` owning the PVC. Postgres
keeps its stock entrypoint (runs as root, `chown`s, drops to `postgres` via gosu) with `PGDATA` in a
subdirectory to satisfy its `0700` permission check. All app containers drop `ALL` capabilities, set
`seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, and run with a read-only root
filesystem where the workload allows it (an `emptyDir` `/tmp` covers the rest). The namespace enforces
**baseline** PodSecurity (warn/audit `restricted`).

### Stateful pluggability

| Dep | `inCluster: true` | `inCluster: false` (managed) |
|---|---|---|
| Valkey | StatefulSet, verbatim ADR-0011 ACL, PVC | managed Redis/Valkey |
| Postgres | StatefulSet, PVC | managed Postgres |
| S3 | SeaweedFS StatefulSet, PVC | real S3 / OVH Object Storage |

Switching is **values-only, never code**. The credentialed connection strings
(`CACHE_URL`/`DATABASE_URL`/`S3_*`) always come from the Secret; for the managed path the chart simply
doesn't render the StatefulSets and the Secret points at the managed endpoints. `values-ovh.yaml`
renders the same app with **zero** StatefulSets.

### Migrations & GC

Migrations run in **one** place — a Job, never a serving pod (`MIGRATE_ON_START=false`). It is a
**post-install/post-upgrade hook**, not pre-install, because the in-cluster Postgres StatefulSet is
part of the same release and doesn't exist at pre-install. With `helm --wait`, the hook fires only
after the release's resources (Postgres included) are Ready; a Postgres-wait initContainer is the
belt-and-suspenders. The S3 bucket auto-creates on first boot. Anonymous-session GC runs as a daily
CronJob (`node dist/main.prune.js`).

### Config rollouts

App Deployments carry a `checksum/config` annotation hashing their ConfigMap, so a config change (e.g.
enabling `google.enabled` adds `GOOGLE_REDIRECT_URI`) rolls the consumers — the restart also re-reads
the referenced Secret. A **secret-only** rotation (no ConfigMap change) needs a manual
`kubectl rollout restart`.

---

## 5. Autoscaling

The worker scales on **real queue backlog** via KEDA's `metrics-api` scaler (no Prometheus): it polls
the API's `GET /scaling/backlog` → `{download,convert,total}` and targets `total`, so replicas ≈
`ceil(total / DOWNLOAD_CONCURRENCY)` between `min`/`max`. KEDA owns the worker's HPA — the chart must
not also template one.

> The ScaledObject URL must be the **FQDN** (`<api>.<ns>.svc.cluster.local`) — KEDA runs in its own
> namespace and can't resolve the short Service name.

The stateless tiers (frontend, backend-api, both providers) use stock CPU HPAs (`minReplicas: 2`).
Providers carry pod anti-affinity (spread across nodes → distinct egress IPs, so YouTube per-IP
throttling on one node doesn't degrade the fleet — ADR-0017). PDBs: `minAvailable: 1` for the
stateless tiers, `maxUnavailable: 1` for the worker.

---

## 6. Secrets — vault-free, open-source-safe

Mirrors ADR-0008's stance: encrypt the substrate, don't add a key-management surface. Two layers:

1. **At rest** — Talos LUKS2 encrypts etcd's partitions, so a Secret is ciphertext on disk.
2. **Provisioning** — real credentials live only in `secrets/secrets.sops.yaml` (age-encrypted, only
   `stringData` encrypted). `task deploy` applies them out-of-band (`sops -d | kubectl apply`); the
   **chart references Secrets by name (`existingSecret`) and never templates a credential value**, so
   `helm get manifest`/git never expose one. The repo ships only `.sops.yaml` (config) +
   `secrets.example.yaml` (template); the real encrypted file is gitignored for open-source hygiene.

**Blast radius:** per-image Secret split — the worker Secret omits `DATABASE_URL` + `GOOGLE_*`.
Frontend and providers mount no Secret. Every workload has a dedicated ServiceAccount with
`automountServiceAccountToken: false` and **no Role grants Secret read** to a pod (secrets arrive via
`envFrom` at admission). `GET /scaling/backlog` stays unauthenticated (it leaks 3 integers, is
ClusterIP-internal) — fenced by a NetworkPolicy rather than a token Secret that would re-introduce a
key surface.

> **Cross-equality invariant (unenforced by code — the top footgun):** the in-cluster dep credentials
> (`VALKEY_PASSWORD`, `POSTGRES_*`, `AWS_*`) MUST equal the credentials embedded in
> `CACHE_URL`/`DATABASE_URL`/`S3_*`. Get it wrong and `/ready` fails silently.
> `secrets.example.yaml` documents the matching; a future Taskfile `validate` should assert it.

### Google OAuth

The backend is a pure token API; the Nuxt BFF owns the browser OAuth dance and the callback lands on
the **frontend** at `/api/auth/google/callback`, which calls the backend's `/auth/google/exchange`. To
enable: register that redirect URI in the Google console, add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
to `ypd-backend-secrets`, set `google.enabled=true` (derives `GOOGLE_REDIRECT_URI` from `ingress.host`),
redeploy. Anonymous downloads work without it.

---

## 7. Toolchain

`terraform`, `talosctl`, `kubectl`, `helmfile`, `sops`, `age`, `kubeconform`, `go-task`, and **Helm 3**.

> **Helm 3, not Helm 4.** Helm 4's reworked plugin format + `--wait` hang helmfile on the webhook
> charts (cert-manager/ingress-nginx) and break the `helm secrets` subcommand. The toolchain pins Helm
> 3 at `~/.local/bin/helm3` with an isolated plugin dir; `task deploy` decrypts with `sops` directly
> (no helm-secrets plugin needed).

---

## 8. Gotchas (baked into the IaC — keep, or they bite on rebuild)

- **Talos ↔ Kubernetes version coupling** — the talos provider defaults `kubernetes_version` to its
  newest, which can be too new for the pinned Talos. Pin it explicitly (`variables.tf`); bump both
  together via `versions.env`.
- **HostnameConfig collision** — Talos 1.12 emits a `HostnameConfig{auto: stable}` document; also
  setting `machine.network.hostname` is rejected. We set static IP/VIP but not the hostname → nodes get
  auto-stable names (`talos-xxx`). Pretty `ypd-*` names are deferred (renaming live nodes evicts pods).
- **Maintenance-IP boot race** — at create, `ipv4_addresses` can momentarily show only loopback; a
  re-`apply` picks up the DHCP lease. Keep the static IPs outside the DHCP pool.
- **tfstate is sensitive** — Talos machine secrets live in `terraform.tfstate` (gitignored). Move to an
  encrypted remote backend before sharing or going HA.
- **DNS for the fake domain** — only the local resolver (Pi-hole/dnsmasq) knows `*.pragmacode.fr`; if a
  client also queries a router/public resolver it will `NXDOMAIN` the name and race the local answer.
  Make the local resolver the **only** DNS server (via DHCP).

---

## 9. Observability & monitoring

`task cluster:addons` installs **kube-prometheus-stack** (Prometheus Operator + Prometheus + Grafana +
node-exporter + kube-state-metrics) and **blackbox-exporter** in the `monitoring` namespace; the app
chart ships the glue that wires YPD in (gated on `monitoring.enabled`, on in `values-proxmox`).

**What it shows.** Grafana at **`https://grafana.pragmacode.fr`** (its own cert from `ypd-ca` — trust
the same CA as the app). Bundled cluster/node/pod dashboards cover **CPU/memory/disk/network**; four
chart-shipped YPD dashboards cover the app — **Overview** (backlog, fleet, readiness, golden signals),
**Queue & Workers** (queue depth by state, backlog, utilization, capacity), **Providers & Storage**
(provider latency/throughput/fallbacks, contract violations, S3 op latency), and **Health & Readiness**
(the per-dependency readiness matrix, blackbox route up/down + status, pod readiness + restarts).

**Dashboards as code (grafonnet).** The YPD dashboards are authored in **Jsonnet with the community
grafonnet library** under `infra/grafana/` (`lib/ypd.libsonnet` holds shared panel/query helpers;
`dashboards/*.jsonnet` is one file per dashboard). `task grafana:build` compiles them to
`infra/helm/ypd/dashboards/*.json` (committed), and the chart bundles **every** `dashboards/*.json` as
its own `grafana_dashboard`-labelled ConfigMap via `.Files.Glob` — so adding a dashboard is "add a
`.jsonnet` + rebuild", no template change. grafonnet is pinned by `infra/grafana/jsonnetfile.lock.json`
(SHA-summed); `vendor/` is restored by `jb install` (run automatically by `grafana:build`) and not
committed.

**Scraping.** The app exposes `/metrics` on backend-api (:3000), the worker (:3000), and both providers
(:5000/:5001) — the frontend has none. The chart adds **ServiceMonitors** (backend-api + the two
providers) and a **PodMonitor** for the worker (it has no Service, and per-pod scraping matches the
per-instance worker capacity gauges). The operator selects monitors/probes across all namespaces
(`*SelectorNilUsesHelmValues: false`), so no `release` label is needed.

**Health routes → metrics.** `/health`,`/ready`,`/healthz` return JSON, not metrics, so two **Probe**
CRs point blackbox at them (`probe_success` / `probe_http_status_code`); only HTTP 200 counts as up, so
a degraded `/ready` (503) flips the panel. The worker `/ready` is **not** blackbox-probed (no Service)
— it is covered better by the per-pod `ypd_readiness_check` gauge.

**Per-dependency readiness gauge.** Each `/ready` handler publishes `ypd_readiness_check{component,
check}` (1/0) via `MetricsService.setReadiness` (backend-core), so Grafana pinpoints exactly which
dependency (db/valkey/s3/provider:*) is down on which pod — beyond the binary pod readiness from
kube-state-metrics. The kubelet hits `/ready` every 10s, refreshing it for free.

**NetworkPolicy.** With `networkPolicy.enabled`, each component opens its scrape port to the
`monitoring` namespace **only** — backend-api :3000, the worker :3000 (a new ingress rule; its policy
was egress-only), the providers :5000/:5001, and the frontend :8080 (for `/healthz`). node-exporter,
kubelet, and cAdvisor are node-local and exempt.

**Footprint & retention.** Prometheus is pinned to the data node (`ypd.io/data=true`) on a 10Gi
local-path PVC, **7d retention capped at 8GB** so it can't fill `/var/mnt/data` next to the app's
stateful PVCs; Grafana gets a 2Gi PVC there too. Alertmanager is **off** (no alerting yet). The Talos
control-plane ServiceMonitors (etcd/scheduler/controller-manager/kube-proxy) are disabled to avoid
permanently-down targets — Cilium replaces kube-proxy.

**Grafana auth (vault-free).** The admin login is a SOPS+age secret (`secrets/monitoring.sops.yaml`,
gitignored; template `monitoring.example.yaml`) applied to the `monitoring` namespace by
`task cluster:addons` **before** the stack syncs; Grafana reads it via `grafana.admin.existingSecret`.

> **Helm-3 hang avoidance.** kube-prometheus-stack installs the operator's admission webhook + CRDs.
> Under `helmDefaults wait:true` that hangs like cert-manager/ingress-nginx did, so the release sets
> `wait:false`, **disables the admission webhook** (and its certgen jobs), and gates readiness with a
> `kubectl rollout status deploy/kube-prometheus-stack-operator` postsync hook. That also guarantees
> the ServiceMonitor/PodMonitor/Probe CRDs exist before `task deploy` ships the app's monitors — so
> **addons must run before deploy** (the runbook already orders them that way).
