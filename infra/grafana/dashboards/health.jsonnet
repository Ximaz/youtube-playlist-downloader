// YPD / Health & Readiness — per-dependency readiness, blackbox routes, pod health.
local ypd = import '../lib/ypd.libsonnet';

ypd.dashboard('YPD / Health & Readiness', 'ypd-health', [
  ypd.upDown(
    'Per-dependency readiness',
    [ypd.target('min by (component, check) (ypd_readiness_check)', '{{component}} / {{check}}')],
    desc='ypd_readiness_check from /ready: green ok, red failing. min across pods.',
  ),
  ypd.upDown(
    'Health routes up/down',
    [ypd.target('probe_success', '{{instance}}')],
    desc='blackbox probe_success per /health and /ready target URL.',
  ),
  ypd.table(
    'Health route HTTP status',
    [ypd.instant('probe_http_status_code', '{{instance}}')],
    desc='Latest status per probed route (200 healthy, 503 degraded).',
  ),
  ypd.timeseries(
    'Probe duration',
    [ypd.target('probe_duration_seconds', '{{instance}}')],
    unit='s',
    desc='blackbox probe round-trip per route.',
  ),
  ypd.stat(
    'Pods ready (ypd)',
    [ypd.target('sum by (pod) (kube_pod_status_ready{namespace="ypd", condition="true"})', '{{pod}}')],
    desc='Ready condition per ypd pod (kube-state-metrics).',
  ),
  ypd.timeseries(
    'Container restarts (ypd)',
    [ypd.target('sum by (pod) (kube_pod_container_status_restarts_total{namespace="ypd"})', '{{pod}}')],
    desc='Cumulative container restarts per pod — crash-loop early warning.',
  ),
])
