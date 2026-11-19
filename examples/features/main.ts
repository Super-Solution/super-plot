import { SuperPlot, type BrushSelection, type DrawTarget, type ZoomRange } from '@supersolutions/super-plot-web'

type Row = Record<string, unknown>
let seed = 11
const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
const day = (i: number): string => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10)
const REGIONS = ['APAC', 'EMEA', 'Americas']

// Daily sales per region, Jan to Jun 2026 (sample data).
const sales: Row[] = []
for (let i = 0; i < 181; i++) for (const [k, region] of REGIONS.entries()) {
  sales.push({ date: day(i), region, revenue: Math.max(0, Math.round(80 + k * 25 + 30 * Math.sin(i / 14 + k) + 12 * gauss())) })
}
const plots: Record<string, SuperPlot> = {}
const el = (id: string): HTMLElement => document.getElementById(id)!

// ---- linked brush --------------------------------------------------------------------------
const linkedSpec = (sel: BrushSelection | null): Row => ({
  type: 'bar', x: 'region', y: 'revenue', data: sales, format: 'compact',
  title: sel ? 'Revenue in the brushed days' : 'Revenue, all days', subtitle: 'Sum by region',
  transform: [...(sel?.filters ?? []).map(filter => ({ filter })), { aggregate: { groupBy: ['region'], fields: { revenue: 'sum' } } }]
})
const fmt = (z: ZoomRange | BrushSelection | null): string => {
  const x = z?.x as { range?: unknown[] } | undefined
  return x?.range ? x.range.map(v => String(v).slice(0, 10)).join(' to ') : ''
}
plots.linked = new SuperPlot(el('linked'), linkedSpec(null), { animate: false })
plots.daily = new SuperPlot(el('daily'), {
  type: 'line', x: 'date', y: 'revenue', series: 'region', data: sales, zoom: 'x', brush: 'x',
  title: 'Daily revenue', subtitle: 'Brush a range of days'
}, {
  onBrush: sel => {
    plots.linked.setSpec(linkedSpec(sel))
    el('daily-out').textContent = sel ? `Brushed ${fmt(sel)}` : 'Brush cleared'
  },
  onZoom: z => { el('daily-out').textContent = z ? `Zoomed to ${fmt(z)}` : 'Full range' }
})

// ---- live data -----------------------------------------------------------------------------
let t = 0
let level = 50
const tick = (): Row => ({ t: new Date(Date.UTC(2026, 0, 1, 9) + t++ * 1000).toISOString(), value: +(level += gauss()).toFixed(2) })
plots.live = new SuperPlot(el('live'), { type: 'area', x: 't', y: 'value', data: Array.from({ length: 120 }, tick), title: 'Sensor reading', subtitle: 'One row a second, last 240 kept' }, {
  animate: false,
  onRender: e => { el('live-out').textContent = `Drawn in ${e.ms.toFixed(1)} ms on ${e.renderer}` }
})
let timer = window.setInterval(() => plots.live.appendRows([tick()], { max: 240 }), 250)
el('live-toggle').addEventListener('click', e => {
  const b = e.currentTarget as HTMLButtonElement
  if (timer) { clearInterval(timer); timer = 0; b.textContent = 'Resume' }
  else { timer = window.setInterval(() => plots.live.appendRows([tick()], { max: 240 }), 250); b.textContent = 'Pause' }
})

// ---- transform, facet, combo ---------------------------------------------------------------
plots.monthly = new SuperPlot(el('monthly'), {
  type: 'bar', x: 'month', y: 'revenue', series: 'region', stack: 'stack', data: sales, format: 'compact',
  title: 'Monthly revenue', subtitle: 'Daily rows, bucketed and summed by the spec',
  transform: [{ timeUnit: { field: 'date', unit: 'month', as: 'month' } }, { aggregate: { groupBy: ['month', 'region'], fields: { revenue: 'sum' } } }]
})
plots.combo = new SuperPlot(el('combo'), {
  type: 'bar', x: 'quarter', y: 'actual', line: 'target', format: 'compact', title: 'Actual vs target', subtitle: 'Bars with a line on the same axis',
  data: [{ quarter: 'Q1', actual: 420, target: 400 }, { quarter: 'Q2', actual: 380, target: 430 }, { quarter: 'Q3', actual: 510, target: 460 }, { quarter: 'Q4', actual: 560, target: 520 }]
})
const people = Array.from({ length: 900 }, (_, i) => {
  const region = REGIONS[i % 3]
  const tenure = Math.abs(gauss() * 4 + 6)
  return { region, tenure: +tenure.toFixed(1), salary: Math.round(40 + tenure * (3 + (i % 3)) + gauss() * 8) }
})
plots.facet = new SuperPlot(el('facet'), { type: 'scatter', x: 'tenure', y: 'salary', facet: 'region', data: people, title: 'Salary by tenure', subtitle: 'One panel per region, shared axes', xLabel: 'Years', yLabel: 'Salary (k)' })

// ---- density, patterns, shadcn, plugin -----------------------------------------------------
const cloud = Array.from({ length: 30000 }, () => { const a = gauss(); return { x: +(a * 10).toFixed(3), y: +(a * 6 + gauss() * 5).toFixed(3) } })
plots.hex = new SuperPlot(el('hex'), { type: 'scatter', x: 'x', y: 'y', data: cloud, density: 'auto', title: '30,000 points', subtitle: 'Hexagons, darker is more points' })
const mix = ['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => ({ q, Hardware: 30 + i * 5, Software: 22 + i * 8, Services: 18 + i * 3 }))
plots.patterns = new SuperPlot(el('patterns'), { type: 'bar', x: 'q', y: ['Hardware', 'Software', 'Services'], stack: 'stack', patterns: true, data: mix, title: 'Revenue mix', subtitle: 'A texture per series' })
plots.shadcn = new SuperPlot(el('shadcn'), { type: 'bar', x: 'q', y: ['Hardware', 'Software', 'Services'], data: mix, title: 'shadcn theme', subtitle: 'Colours from --chart-1..5' }, { theme: 'shadcn' })

/** A small plugin: a "Preliminary" stamp in the plot's corner, drawn after the chart on SVG or canvas. */
const stamp = {
  name: 'preliminary',
  afterDraw: ({ scene, svg, ctx }: DrawTarget) => {
    const p = scene.axes?.plot
    if (!p) return
    if (svg) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      Object.entries({ x: p.x + p.w - 6, y: p.y + 14, 'text-anchor': 'end', 'font-size': 11, fill: '#F23645', 'font-weight': 600 }).forEach(([k, v]) => t.setAttribute(k, String(v)))
      t.textContent = 'PRELIMINARY'
      svg.appendChild(t)
    } else if (ctx) {
      ctx.save(); ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = '#F23645'; ctx.textAlign = 'right'; ctx.fillText('PRELIMINARY', p.x + p.w - 6, p.y + 14); ctx.restore()
    }
  }
}
const planSpec = { type: 'line', x: 'month', y: ['plan', 'forecast'], title: 'Plan vs forecast', subtitle: 'afterDraw plugin; data table option', data: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((month, i) => ({ month, plan: 100 + i * 10, forecast: 96 + i * 12 })) }
plots.plugin = new SuperPlot(el('plugin'), planSpec, { plugins: [stamp] })
el('table-toggle').addEventListener('change', e => plots.plugin.setOptions({ dataTable: (e.target as HTMLInputElement).checked ? 'visible' : true }))
plots.plugin.setOptions({ dataTable: true })

// ---- sync, toolbar, tooltipFormat, sonify ---------------------------------------------------
const ops = Array.from({ length: 90 }, (_, i) => ({ date: day(i), orders: Math.round(200 + 60 * Math.sin(i / 9) + 15 * gauss()), latency: +(120 + 40 * Math.cos(i / 11) + 8 * gauss()).toFixed(1) }))
plots.syncA = new SuperPlot(el('sync-a'), { type: 'line', x: 'date', y: 'orders', data: ops, zoom: 'x', title: 'Orders', subtitle: 'Per day' }, {
  sync: 'ops', toolbar: ['png', 'svg', 'csv', 'table', 'reset', 'sound'],
  tooltipFormat: t => `${t.title}\n${t.rows[0]?.value ?? ''} orders`
})
plots.syncB = new SuperPlot(el('sync-b'), { type: 'area', x: 'date', y: 'latency', data: ops, zoom: 'x', title: 'Latency', subtitle: 'p50, ms' }, { sync: 'ops', toolbar: true })

;(window as unknown as { plots: typeof plots }).plots = plots
document.body.dataset.ready = '1'
