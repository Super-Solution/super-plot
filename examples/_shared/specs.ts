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
  { id: 'scatter', note: 'Groups, bubble size and per-group trend', spec: by('scatter') },
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
  { id: 'heatmap', note: 'Two categorical dimensions', spec: by('heatmap') },
  { id: 'radar', note: 'A few items across shared measures', spec: by('radar') },
  { id: 'treemap', note: 'Area is the value; groups get a colour', spec: by('treemap') },
  {
    id: 'treemap-plain', note: 'No groups: shade by size',
    spec: { type: 'treemap', title: 'Largest cities', subtitle: 'Population, millions', label: 'city', value: 'pop', format: 'fixed:1', data: [['Tokyo', 37.4], ['Delhi', 31], ['Shanghai', 27.1], ['São Paulo', 22], ['Mexico City', 21.8], ['Cairo', 21.3], ['Mumbai', 20.4], ['Beijing', 20.4], ['Dhaka', 19.6], ['Osaka', 19.2], ['New York', 18.8], ['Karachi', 16.1], ['Taipei', 7.1]].map(([city, pop]) => ({ city, pop })) }
  },
  { id: 'sankey', note: 'Flows between stages, loops refused', spec: by('sankey') }
]
