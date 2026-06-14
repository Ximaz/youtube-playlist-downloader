# YPD — Kubernetes on Talos (Proxmox): SHIPPED ✅ + follow-ups

> **The full stack is LIVE and verified end-to-end**, including **Google OAuth** and **public DNS**. A
> 4-node Talos/Kubernetes cluster on Proxmox `goliath` runs YPD: browser → `https://ypd.pragmacode.fr`
> → ingress (TLS) → Nuxt BFF → NestJS backend → providers + in-cluster Valkey/Postgres/SeaweedFS, worker
> autoscaled by KEDA, secrets via SOPS+age (no vault), persistence on a Talos user volume.
>
> Design reference: [`infra/docs/architecture.md`](infra/docs/architecture.md). Decisions: ADR-0019 in
> [`docs/decisions/README.md`](docs/decisions/README.md). Runbook: [`infra/README.md`](infra/README.md).

---

## ✅ DONE & VERIFIED

**Cluster substrate (Terraform):** 4 nodes (1 CP `.210` + 3 workers `.211–.213`), API VIP `.201`,
Cilium LB `.202`. K8s 1.34.1 / Talos 1.12.7, etcd LUKS2-at-rest. The stateful worker's 2nd disk is a
Talos **UserVolume at `/var/mnt/data`** + node label `ypd.io/data=true` (`terraform/machine-config.tf`).

**Add-ons (`bootstrap/`, Helm 3 + helmfile):** Cilium (reconciled) + **cert-manager** (self-signed
`ypd-ca` ClusterIssuer) + **ingress-nginx** (LoadBalancer on `.202`, WS + 3600s timeouts) + **KEDA** +
**local-path-provisioner** (vendored, pinned `v0.0.30`, every PV → `/var/mnt/data`, default SC).

**App (`helm/ypd/`, one chart):** backend-api, backend-worker, frontend, 2 providers, provider-pot,
in-cluster Valkey/Postgres/SeaweedFS StatefulSets (pinned to the data node), ConfigMaps, migrate **Job**
(post-install hook + Postgres-wait), prune **CronJob**, **KEDA ScaledObject** on `/scaling/backlog`, CPU
HPAs, PDBs, Ingress, dedicated SAs (`automountServiceAccountToken:false`), `checksum/config` annotations
(config change → pod roll), **NetworkPolicies (enabled + validated)**. securityContext hardened per
discovered image UIDs.

**NetworkPolicies (LIVE):** 11 policies, default-deny egress (`allow-dns` selects all pods), each
component granted exactly its graph — backend-api → valkey/postgres/S3/providers/internet:443 (Google),
worker → valkey/S3/providers, providers → internet:80/443 + pot, the data stores accept ingress only
from their real clients, and `/scaling/backlog` is fenced (backend-api ingress :3000 only from frontend
+ the KEDA namespace). Validated: download→convert→done, ingress 200, KEDA Ready, all `/ready` green
through the lockdown.

**Secrets (vault-free):** real creds only in `secrets/secrets.sops.yaml` (age-encrypted, `stringData`
only, **gitignored** for open-source hygiene); the chart references them via `existingSecret` and
**never templates a value**. Per-image split (worker omits `DATABASE_URL`+`GOOGLE_*`).

**Google OAuth (LIVE):** `google.enabled=true`; `GOOGLE_CLIENT_ID/SECRET` in `ypd-backend-secrets`,
`GOOGLE_REDIRECT_URI` derived from `ingress.host`. `GET /auth/google/url` returns a well-formed Google
consent URL (correct `client_id` + `redirect_uri` + `youtube`/`profile` scopes). Redirect URI
`https://ypd.pragmacode.fr/api/auth/google/callback` registered in the Google console.

**DNS / browser:** `ypd.pragmacode.fr` → `.202` via the local Pi-hole; the SPA loads over HTTPS (trust
`ypd-ca-tls`'s `ca.crt` to drop the self-signed warning).

**Docs / cleanup:** `infra/docs/architecture.md` written as the design reference; verbose code comments
trimmed to terse point-of-use notes across 40 infra files (proven render-neutral); README links the doc.

**Verification evidence:**
- `helm lint` clean; `helm template -f values-{proxmox,ovh}` → `kubeconform -strict` 36/36 + 30/30 valid.
- **Adversarial review** (5-lens workflow): 0 confirmed blockers/highs.
- **13/13 pods Running**; `GET /ready` → `db,valkey,s3,provider:ytdl,provider:youtubejs` all `ok`.
- **Anonymous download** `POST /downloads` → worker → `step:done` → `GET …/archive` → **valid 252 KB ZIP**;
  SeaweedFS `/data` holds the object.
- KEDA ScaledObject `Ready=True`, HPA reads `0/6`; `values-ovh` renders **0** StatefulSets (managed-dep
  pluggability proven).

**Reproducible flow:** `task infra:up` → `task cluster:addons` → `task deploy`.

---

## 🔧 KEY DECISIONS / GOTCHAS

(Full detail in [`infra/docs/architecture.md`](infra/docs/architecture.md) §7–§8 + ADR-0019.)

1. **Helm 3, not Helm 4** — Helm 4's plugin format + `--wait` hang helmfile on the webhook charts and
   break `helm secrets`. Pinned at `~/.local/bin/helm3` with an isolated plugin dir; `sops` decrypts.
2. **KEDA cross-namespace DNS** — the ScaledObject URL must be the FQDN (`…ypd.svc.cluster.local`).
3. **migrate = post-install hook** — in-cluster Postgres is absent at pre-install; `/health` is
   dependency-free and `/ready` is `SELECT 1`, so `helm --wait` converges then the hook migrates.
4. **Image UIDs pinned from reality** — backend/worker 1000, frontend 1001, ytdl 10001, youtubejs 100,
   valkey 999, seaweedfs 1000; postgres runs as root (gosu drops) + `PGDATA` subdir.
5. **DNS for the fake domain** — the local resolver must be the **only** one; a router/public secondary
   `NXDOMAIN`s `*.pragmacode.fr` and races the local answer (this caused the earlier flaky resolution).

---

## ▶ WHAT'S NEXT

### Now — commit
Everything is in the working tree, **uncommitted**, on branch `feat/helm-setup` (`secrets.sops.yaml` is
gitignored). Suggested:
```
feat: deploy YPD to Kubernetes on Talos — chart, SOPS secrets, autoscaling, persistence (Workstream F)
```

### Operator verification (quick)
- **Browser sign-in:** open `https://ypd.pragmacode.fr`, click sign-in, complete the Google consent →
  confirm the navbar shows your profile and a playlist download works end-to-end. (Infra is wired; this
  is the last click-through. If consent returns `access_denied`, add yourself as a Test user on the
  OAuth consent screen.)

### Deferred hardening (authored or noted — each is intrusive; execute deliberately)
- **Pretty node hostnames** (`ypd-cp-01`/`ypd-w-0N`) — **not done** on purpose: renaming live nodes
  re-registers them and evicts pods. Maintenance-window job; StatefulSets re-pin by the `ypd.io/data`
  label and survive it.
- **K8s Secrets `EncryptionConfiguration`** (defense-in-depth atop LUKS) via Talos `cluster.apiServer`;
  add a LUKS recovery passphrase slot.
- **tfstate → encrypted remote backend** (Talos machine secrets currently live in local tfstate).
- **CI** — `.github/workflows/infra.yml` added (tf fmt/validate + helm lint + kubeconform + gitleaks);
  wire a Renovate policy to bump `versions.env`.
- **HA / scale-out** — 3 control-planes (`control_plane_ips`); Longhorn for cross-node replicated storage
  (today: single-replica StatefulSets on node-local disk = persistence without HA); a Taskfile
  `validate` asserting the secret cross-equality invariant.
- **Secret rotation note** — a secret-only change (no ConfigMap delta) needs a manual
  `kubectl rollout restart` since the `checksum/config` annotation only tracks the ConfigMap.

---

## Critical files
- **Cluster:** `infra/terraform/*` (UserVolume + nodeLabel in `machine-config.tf`).
- **Add-ons:** `infra/bootstrap/{helmfile.yaml.gotmpl, cert-manager/, ingress-nginx/, storage/}`,
  `infra/Taskfile.yml` (Helm 3 wiring), `infra/versions.env`.
- **App:** `infra/helm/ypd/**` (chart), `infra/secrets/{.sops.yaml, secrets.example.yaml}` (real
  `secrets.sops.yaml` is gitignored).
- **Docs:** `infra/docs/architecture.md` (design), `infra/README.md` (runbook), `docs/decisions/README.md`
  (**ADR-0019**), `.github/workflows/infra.yml` (CI).
