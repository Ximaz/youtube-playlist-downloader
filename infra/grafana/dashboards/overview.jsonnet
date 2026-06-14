// YPD / Overview — the at-a-glance screen: backlog, fleet, readiness, golden signals.
local ypd = import '../lib/ypd.libsonnet';

ypd.dashboard('YPD / Overview', 'ypd-overview', [
  ypd.stat(
    'Queue backlog',
    [ypd.target('sum (bullmq_queue_depth{state=~"waiting|prioritized"})')],
    desc='Actionable download+convert jobs waiting to be picked up.',
  ),
  ypd.stat(
    'Workers connected',
    [ypd.target('max by (queue) (bullmq_workers_connected)', '{{queue}}')],
    desc='Worker instances connected per queue (fleet size).',
  ),
  ypd.stat(
    'Pods ready (ypd)',
    [ypd.target('sum (kube_pod_status_ready{namespace="ypd", condition="true"})')],
    desc='Ready pods in the ypd namespace (kube-state-metrics).',
  ),
  ypd.timeseries(
    'Worker utilization',
    [ypd.target('sum by (pool) (bullmq_worker_active) / clamp_min(sum by (pool) (bullmq_worker_concurrency), 1)', '{{pool}}')],
    unit='percentunit',
    desc='Active / configured concurrency per pool. 1.0 = saturated.',
  ),
  ypd.upDown(
    'Per-dependency readiness',
    [ypd.target('min by (component, check) (ypd_readiness_check)', '{{component}} / {{check}}')],
    desc='Each /ready dependency, min across pods. Red = failing somewhere.',
  ),
  ypd.upDown(
    'Health routes',
    [ypd.target('probe_success', '{{instance}}')],
    desc='blackbox probe_success per /health and /ready target.',
  ),
])
