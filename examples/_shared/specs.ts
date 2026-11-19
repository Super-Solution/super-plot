import { chartCatalog } from '@supersolutions/super-plot-core'

const rnd = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)

/** Deterministic daily series (no network, no randomness between runs). */
function daily(days: number, start: string, seed: number, base: number, drift: number, noise: number): { date: string; value: number }[] {
  const r = rnd(seed)
  const t0 = Date.parse(start)
  let v = base
  return Array.from({ length: days }, (_, i) => {
    v += drift + (r() - 0.5) * noise
    return { date: new Date(t0 + i * 864e5).toISOString().slice(0, 10), value: Math.round(v * 100) / 100 }
  })
}

const by = (type: string): Record<string, unknown> => chartCatalog().find(c => c.type === type)!.example

export const gallery: { id: string; note: string; spec: Record<string, unknown> }[] = [
  { id: 'bar', note: 'Grouped bars from wide-form columns', spec: by('bar') },
  {
    id: 'bar-stacked', note: 'Stacked and sorted, horizontal, value labels',
    spec: {
      type: 'bar', title: 'Tickets resolved by team', subtitle: 'Last quarter', orientation: 'horizontal', stack: 'stack', sort: 'desc', labels: true,
      x: 'team', y: 'count', series: 'priority',
      data: [['Payments', 'High', 42], ['Payments', 'Normal', 118], ['Platform', 'High', 31], ['Platform', 'Normal', 96], ['Growth', 'High', 12], ['Growth', 'Normal', 64], ['Mobile', 'High', 27], ['Mobile', 'Normal', 73]].map(([team, priority, count]) => ({ team, priority, count }))
    }
  },
  {
    id: 'bar-normalized', note: '100% stacked: composition, not size',
    spec: {
      type: 'bar', title: 'Browser share by quarter', x: 'q', y: ['Chrome', 'Safari', 'Edge', 'Other'], stack: 'normalize', legend: 'bottom',
      data: [{ q: 'Q1', Chrome: 61, Safari: 19, Edge: 11, Other: 9 }, { q: 'Q2', Chrome: 60, Safari: 20, Edge: 12, Other: 8 }, { q: 'Q3', Chrome: 58, Safari: 22, Edge: 13, Other: 7 }, { q: 'Q4', Chrome: 57, Safari: 23, Edge: 14, Other: 6 }]
    }
  },
  { id: 'line', note: 'Dates detected automatically; reference line', spec: by('line') },
  {
    id: 'line-dense', note: '730 daily points, smooth curve, crosshair tooltip',
    spec: {
      type: 'line', title: 'Daily revenue', subtitle: 'USD, two years', x: 'date', y: 'value', curve: 'smooth', format: 'currency:USD', yLabel: 'Revenue',
      annotations: [{ axis: 'x', value: '2026-01-01', label: 'Pricing change', tone: 'warning' }],
      data: daily(730, '2025-01-01', 7, 1800, 4, 260)
    }
  },
  { id: 'area', note: 'Stacked areas over a numeric axis', spec: by('area') },
  { id: 'area-stream', note: 'Stream graph (stack: "center"): layers centred, so the value axis has no zero and no ticks', spec: { ...by('area'), title: 'Energy mix as a stream', stack: 'center' } },
  { id: 'scatter', note: 'Groups, bubble size and per-group trend', spec: by('scatter') },
  {
    id: 'scatter-log', note: 'Log axes, error bars and a LOESS trend',
    spec: (() => {
      const r = rnd(17)
      const data = Array.from({ length: 60 }, (_, i) => {
        const size = Math.round(10 ** (1 + (i / 60) * 3) * (0.8 + r() * 0.4))
        const ms = Math.round(4 * size ** 0.55 * (0.7 + r() * 0.6))
        return { size, ms, lo: Math.round(ms * 0.8), hi: Math.round(ms * 1.25) }
      })
      return { type: 'scatter', title: 'Query time by table size', subtitle: 'Synthetic data generated in the page; bars show the 80% interval', x: 'size', y: 'ms', xScale: 'log', yScale: 'log', yLower: 'lo', yUpper: 'hi', trend: 'loess', xLabel: 'Rows', yLabel: 'Milliseconds', data }
    })()
  },
  {
    id: 'line-band', note: 'Confidence band, a gap left open, a labelled point',
    spec: (() => {
      const r = rnd(5)
      const data = daily(60, '2026-03-01', 9, 120, 0.6, 6).map((d, i) => {
        const e = 6 + i * 0.15 + r() * 2
        return { date: d.date, forecast: i >= 30 && i < 34 ? null : d.value, lo: Math.round((d.value - e) * 10) / 10, hi: Math.round((d.value + e) * 10) / 10 }
      })
      return { type: 'line', title: 'Demand forecast', subtitle: 'Synthetic; the band is the 90% interval, no data for four days', x: 'date', y: 'forecast', yLower: 'lo', yUpper: 'hi', gaps: 'break', yLabel: 'Orders', annotations: [{ x: '2026-04-20', y: data[50].forecast as number, label: 'Promotion' }], data }
    })()
  },
  {
    id: 'lollipop', note: 'Lollipops with whiskers, sorted',
    spec: { type: 'bar', mark: 'lollipop', orientation: 'horizontal', sort: 'desc', labels: true, title: 'Satisfaction by team', subtitle: 'Mean score with 95% interval (invented)', x: 'team', y: 'score', yLower: 'lo', yUpper: 'hi', data: [['Support', 8.1, 7.6, 8.5], ['Sales', 7.4, 6.8, 7.9], ['Product', 7.9, 7.5, 8.3], ['Finance', 6.6, 5.9, 7.2], ['Ops', 7.0, 6.5, 7.6]].map(([team, score, lo, hi]) => ({ team, score, lo, hi })) }
  },
  {
    id: 'transform-window', note: 'fold and window steps: wide quarters to a running total per region',
    spec: { type: 'line', title: 'Cumulative revenue', subtitle: 'fold, then a running sum per region', x: 'quarter', y: 'total', series: 'region', data: [{ region: 'APAC', Q1: 120, Q2: 138, Q3: 151, Q4: 160 }, { region: 'EMEA', Q1: 98, Q2: 104, Q3: 99, Q4: 120 }], transform: [{ fold: { fields: ['Q1', 'Q2', 'Q3', 'Q4'], as: ['quarter', 'revenue'] } }, { window: { op: 'sum', field: 'revenue', as: 'total', groupBy: ['region'], sortBy: 'quarter' } }] }
  },
  { id: 'pie', note: 'Few parts of a whole', spec: by('pie') },
  { id: 'donut', note: 'Total in the hole', spec: by('donut') },
  { id: 'histogram', note: 'Distribution of one measure', spec: by('histogram') },
  {
    id: 'histogram-groups', note: 'Overlaid groups share bins',
    spec: {
      type: 'histogram', title: 'Order value by customer type', value: 'amount', series: 'type', bins: 14, mode: 'percent', format: 'currency:USD', xLabel: 'Order value',
      data: [...Array.from({ length: 160 }, (_, i) => ({ type: 'New', amount: Math.round(18 + 60 * ((i * 7919) % 100 / 100) ** 1.6) })), ...Array.from({ length: 160 }, (_, i) => ({ type: 'Returning', amount: Math.round(35 + 90 * ((i * 104729) % 100 / 100) ** 1.2) }))]
    }
  },
  { id: 'box', note: 'Spread per group with outliers', spec: by('box') },
  { id: 'box-points', note: 'Every value as a dot, with a fixed jitter (points: "all")', spec: { ...by('box'), title: 'Delivery time by carrier, every parcel', points: 'all' } },
  { id: 'violin', note: 'Density per group: the Team plan has two peaks', spec: by('violin') },
  {
    id: 'violin-quartiles', note: 'Horizontal, quartile lines and every value',
    spec: { ...Object.fromEntries(Object.entries(by('violin')).filter(([k]) => k !== 'yLabel')), orientation: 'horizontal', inner: 'quartiles', points: 'all', xLabel: 'Minutes' }
  },
  { id: 'heatmap', note: 'Two categorical dimensions', spec: by('heatmap') },
  { id: 'waterfall', note: 'Running total: changes float, totals stand on zero', spec: by('waterfall') },
  {
    id: 'waterfall-horizontal', note: 'Horizontal, opening balance as a total row, start-to-end connectors',
    spec: {
      type: 'waterfall', title: 'Cash bridge', subtitle: 'USD k, October 2026', orientation: 'horizontal', labels: true, x: 'item', y: 'amount', total: 'closing', format: 'integer',
      data: [['Opening cash', 820, true], ['Customer receipts', 1240, false], ['Payroll', -610, false], ['Suppliers', -385, false], ['Loan drawdown', 250, false], ['Capex', -190, false], ['Closing cash', null, true]].map(([item, amount, closing]) => ({ item, amount, closing }))
    }
  },
  { id: 'bullet', note: 'KPIs against target and ranges, each on its own scale', spec: by('bullet') },
  {
    id: 'bullet-shared', note: 'One shared scale: same unit for every row',
    spec: {
      type: 'bullet', title: 'Regional sales against quota', subtitle: 'USD k, Q3', x: 'region', value: 'sales', target: 'quota', ranges: ['below', 'near', 'above'], format: 'integer',
      data: [['North', 412, 450, 300, 420, 520], ['South', 388, 360, 260, 340, 440], ['East', 295, 400, 280, 380, 480], ['West', 503, 470, 330, 450, 560]].map(([region, sales, quota, below, near, above]) => ({ region, sales, quota, below, near, above }))
    }
  },
  { id: 'bump', note: 'Ranks over time, labelled at the line ends', spec: by('bump') },
  { id: 'timeline', note: 'Gantt-style plan: one lane per task, colour by team, a "today" line', spec: by('timeline') },
  {
    id: 'timeline-hours', note: 'Shifts over one night: dates with times, durations printed on the bars',
    spec: {
      type: 'timeline', title: 'On-call shifts', subtitle: 'Times in UTC; durations on the bars', y: 'person', start: 'from', end: 'to', series: 'rota', labels: true,
      data: [['Ana', 'Primary', '2026-03-07T22:00:00Z', '2026-03-08T06:00:00Z'], ['Ben', 'Primary', '2026-03-08T06:00:00Z', '2026-03-08T14:30:00Z'], ['Chen', 'Primary', '2026-03-08T14:30:00Z', '2026-03-08T22:00:00Z'], ['Dev', 'Backup', '2026-03-07T22:00:00Z', '2026-03-08T10:00:00Z'], ['Eli', 'Backup', '2026-03-08T10:00:00Z', '2026-03-08T22:00:00Z']].map(([person, rota, from, to]) => ({ person, rota, from, to }))
    }
  },
  { id: 'calendar', note: 'One cell per day; days without data stay empty', spec: by('calendar') },
  { id: 'radar', note: 'A few items across shared measures', spec: by('radar') },
  { id: 'treemap', note: 'Area is the value; groups get a colour', spec: by('treemap') },
  {
    id: 'treemap-plain', note: 'No groups: shade by size',
    spec: { type: 'treemap', title: 'Largest cities', subtitle: 'Population, millions', label: 'city', value: 'pop', format: 'fixed:1', data: [['Tokyo', 37.4], ['Delhi', 31], ['Shanghai', 27.1], ['São Paulo', 22], ['Mexico City', 21.8], ['Cairo', 21.3], ['Mumbai', 20.4], ['Beijing', 20.4], ['Dhaka', 19.6], ['Osaka', 19.2], ['New York', 18.8], ['Karachi', 16.1], ['Taipei', 7.1]].map(([city, pop]) => ({ city, pop })) }
  },
  { id: 'sunburst', note: 'A hierarchy as rings; hover for share of parent and total', spec: by('sunburst') },
  { id: 'sankey', note: 'Flows between stages, loops refused', spec: by('sankey') },
  { id: 'funnel', note: 'Centred bars, share of the first stage; rising values are warned', spec: by('funnel') },
  { id: 'parallel', note: 'Each line is a row across four measures', spec: by('parallel') },
  { id: 'choropleth', note: 'Regions coloured by value (invented islands: Super Plot ships no boundaries)', spec: by('choropleth') },
  { id: 'bubble-map', note: 'Places sized by value, on imported land', spec: by('bubble-map') },
  { id: 'column-map', note: '3D columns on a globe: drag to turn', spec: by('column-map') },
  { id: 'flow-map', note: 'Arcs from origin to destination', spec: by('flow-map') }
]
