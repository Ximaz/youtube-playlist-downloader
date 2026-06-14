// Shared grafonnet helpers for the YPD dashboards. Keeps the per-dashboard files declarative:
// panels are built from queries, layout is auto-gridded. See infra/docs/architecture.md §9.
local g = import 'github.com/grafana/grafonnet/gen/grafonnet-latest/main.libsonnet';

// All panels bind to the dashboard's `datasource` template variable (any Prometheus source).
local dsUid = '${datasource}';

{
  g:: g,
  dsUid:: dsUid,

  // A Prometheus query target.
  target(expr, legend=null)::
    g.query.prometheus.new(dsUid, expr)
    + (if legend != null then g.query.prometheus.withLegendFormat(legend) else {}),

  // Instant table target (for the latest value per series).
  instant(expr, legend=null)::
    self.target(expr, legend)
    + g.query.prometheus.withInstant(true)
    + g.query.prometheus.withFormat('table'),

  timeseries(title, targets, unit=null, desc=null, legendTable=false)::
    g.panel.timeSeries.new(title)
    + g.panel.timeSeries.queryOptions.withDatasource('prometheus', dsUid)
    + g.panel.timeSeries.queryOptions.withTargets(targets)
    + g.panel.timeSeries.fieldConfig.defaults.custom.withFillOpacity(10)
    + g.panel.timeSeries.options.legend.withDisplayMode(if legendTable then 'table' else 'list')
    + g.panel.timeSeries.options.legend.withPlacement('bottom')
    + (if legendTable then g.panel.timeSeries.options.legend.withCalcs(['lastNotNull', 'max']) else {})
    + (if unit != null then g.panel.timeSeries.standardOptions.withUnit(unit) else {})
    + (if desc != null then { description: desc } else {}),

  stat(title, targets, unit='short', desc=null)::
    g.panel.stat.new(title)
    + g.panel.stat.queryOptions.withDatasource('prometheus', dsUid)
    + g.panel.stat.queryOptions.withTargets(targets)
    + g.panel.stat.standardOptions.withUnit(unit)
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.options.withGraphMode('area')
    + g.panel.stat.options.reduceOptions.withCalcs(['lastNotNull'])
    + (if desc != null then { description: desc } else {}),

  // 0/1 state timeline (up/down, ok/failing). Red below 1, green at 1.
  upDown(title, targets, desc=null)::
    g.panel.stateTimeline.new(title)
    + g.panel.stateTimeline.queryOptions.withDatasource('prometheus', dsUid)
    + g.panel.stateTimeline.queryOptions.withTargets(targets)
    + g.panel.stateTimeline.options.withMergeValues(true)
    + g.panel.stateTimeline.options.withShowValue('never')
    + g.panel.stateTimeline.options.legend.withDisplayMode('list')
    + g.panel.stateTimeline.options.legend.withPlacement('bottom')
    + g.panel.stateTimeline.standardOptions.withMappings([
      { type: 'value', options: { '0': { text: 'down', color: 'red' }, '1': { text: 'up', color: 'green' } } },
    ])
    + g.panel.stateTimeline.standardOptions.thresholds.withSteps([
      { color: 'red', value: null },
      { color: 'green', value: 1 },
    ])
    + (if desc != null then { description: desc } else {}),

  table(title, targets, desc=null)::
    g.panel.table.new(title)
    + g.panel.table.queryOptions.withDatasource('prometheus', dsUid)
    + g.panel.table.queryOptions.withTargets(targets)
    + (if desc != null then { description: desc } else {}),

  // Assemble a dashboard: datasource variable + auto-gridded panels (12-wide, 2 per row).
  dashboard(title, uid, panels)::
    g.dashboard.new(title)
    + g.dashboard.withUid(uid)
    + g.dashboard.withTags(['ypd'])
    + g.dashboard.withRefresh('30s')
    + g.dashboard.withTimezone('browser')
    + g.dashboard.time.withFrom('now-1h')
    + g.dashboard.time.withTo('now')
    + g.dashboard.withVariables([
      g.dashboard.variable.datasource.new('datasource', 'prometheus')
      + g.dashboard.variable.datasource.generalOptions.withLabel('Data source'),
    ])
    + g.dashboard.withPanels(g.util.grid.makeGrid(panels, panelWidth=12, panelHeight=8)),
}
