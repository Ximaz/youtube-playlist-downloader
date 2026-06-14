// YPD / Providers & Storage — the yt-dlp/youtubei.js provider tier and S3.
local ypd = import '../lib/ypd.libsonnet';

ypd.dashboard('YPD / Providers & Storage', 'ypd-providers', [
  ypd.timeseries(
    'Provider request latency (p95)',
    [ypd.target('histogram_quantile(0.95, sum by (le, provider) (rate(provider_request_duration_seconds_bucket[5m])))', '{{provider}}')],
    unit='s',
    desc='p95 of backend→provider calls (metadata + stream open).',
  ),
  ypd.timeseries(
    'Provider request rate by status',
    [ypd.target('sum by (provider, status) (rate(provider_request_duration_seconds_count[5m]))', '{{provider}} / {{status}}')],
    unit='reqps',
    desc='Request throughput per provider and status family.',
    legendTable=true,
  ),
  ypd.timeseries(
    'Provider fallbacks / sec',
    [ypd.target('sum by (from, reason) (rate(provider_fallbacks_total[5m]))', '{{from}} / {{reason}}')],
    unit='reqps',
    desc='A provider failed and the next was tried (by reason).',
    legendTable=true,
  ),
  ypd.timeseries(
    'Contract violations / sec',
    [ypd.target('sum by (provider, path) (rate(contract_violations_total[5m]))', '{{provider}} / {{path}}')],
    unit='reqps',
    desc='Provider responses failing Zod validation.',
  ),
  ypd.timeseries(
    'S3 op latency (p95)',
    [ypd.target('histogram_quantile(0.95, sum by (le, op) (rate(s3_op_duration_seconds_bucket[5m])))', '{{op}}')],
    unit='s',
    desc='p95 of S3 operations by type.',
  ),
  ypd.timeseries(
    'S3 op rate',
    [ypd.target('sum by (op) (rate(s3_op_duration_seconds_count[5m]))', '{{op}}')],
    unit='reqps',
    desc='S3 operation throughput by type.',
  ),
])
