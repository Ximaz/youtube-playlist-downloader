// YPD / Queue & Workers — the download/convert pipeline and the worker fleet.
local ypd = import '../lib/ypd.libsonnet';

ypd.dashboard('YPD / Queue & Workers', 'ypd-queue', [
  ypd.timeseries(
    'Queue depth by state',
    [ypd.target('sum by (queue, state) (bullmq_queue_depth)', '{{queue}} / {{state}}')],
    desc='BullMQ jobs per queue and state (download, convert).',
    legendTable=true,
  ),
  ypd.timeseries(
    'Worker utilization',
    [ypd.target('sum by (pool) (bullmq_worker_active) / clamp_min(sum by (pool) (bullmq_worker_concurrency), 1)', '{{pool}}')],
    unit='percentunit',
    desc='Active / configured concurrency per pool. 1.0 = saturated.',
  ),
  ypd.stat(
    'Backlog by queue',
    [ypd.target('sum by (queue) (bullmq_queue_depth{state=~"waiting|prioritized"})', '{{queue}}')],
    desc='Waiting + prioritized — what the worker autoscaler reacts to.',
  ),
  ypd.stat(
    'Active jobs',
    [ypd.target('sum by (pool) (bullmq_worker_active)', '{{pool}}')],
    desc='Jobs processing across the fleet, per pool.',
  ),
  ypd.stat(
    'Workers connected',
    [ypd.target('max by (queue) (bullmq_workers_connected)', '{{queue}}')],
    desc='Worker instances connected per queue (KEDA scales this).',
  ),
  ypd.timeseries(
    'Active vs concurrency',
    [
      ypd.target('sum by (pool) (bullmq_worker_active)', 'active {{pool}}'),
      ypd.target('sum by (pool) (bullmq_worker_concurrency)', 'capacity {{pool}}'),
    ],
    desc='Fleet active jobs against total configured capacity per pool.',
  ),
])
