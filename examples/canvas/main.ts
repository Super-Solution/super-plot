import { SuperPlot } from '@supersolutions/super-plot-web'

type R = 'auto' | 'svg' | 'canvas'
const rnd = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())

/** Three overlapping clusters: the kind of data where a scatter plot at this size is the right chart. */
function points(n: number): Record<string, unknown>[] {
  const r = rnd(7)
  const groups = [{ name: 'Search', cx: 30, cy: 40, sx: 9, sy: 12 }, { name: 'Social', cx: 55, cy: 60, sx: 12, sy: 9 }, { name: 'Email', cx: 70, cy: 30, sx: 8, sy: 8 }]
  return Array.from({ length: n }, (_, i) => {
    const g = groups[i % 3]
    return { spend: Math.round((g.cx + gauss(r) * g.sx) * 10) / 10, signups: Math.round((g.cy + gauss(r) * g.sy) * 10) / 10, channel: g.name }
  })
}
const spec = (n: number): Record<string, unknown> => ({
  type: 'scatter', title: `${n.toLocaleString('en')} campaigns`, subtitle: 'Spend against signups, by channel', x: 'spend', y: 'signups', series: 'channel',
  xLabel: 'Spend (USD k)', yLabel: 'Signups (k)', data: points(n)
})

const sizes = [1000, 5000, 20000, 50000]
let n = 20000
let renderer: R = 'auto'
const plot = new SuperPlot(document.getElementById('plot')!, spec(n), { renderer, animate: false })
const stat = document.getElementById('stat')!
const nBox = document.getElementById('n')!
nBox.innerHTML = sizes.map(s => `<button data-v="${s}">${s.toLocaleString('en')}</button>`).join('')

function show(ms: number): void {
  stat.innerHTML = `Renderer <b>${plot.getRenderer()}</b> · ${n.toLocaleString('en')} points · setup <b>${Math.round(ms)} ms</b>`
  for (const b of nBox.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.v) === n))
  for (const b of document.querySelectorAll('#r button')) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === renderer))
  document.body.dataset.ready = '1'
}
function redo(): void {
  const t = performance.now()
  plot.setOptions({ renderer })
  plot.setSpec(spec(n))
  show(performance.now() - t)
}
nBox.addEventListener('click', e => { const v = (e.target as HTMLElement).dataset.v; if (v) { n = Number(v); redo() } })
document.getElementById('r')!.addEventListener('click', e => { const v = (e.target as HTMLElement).dataset.v as R | undefined; if (v) { renderer = v; redo() } })
redo()
;(window as unknown as { plot: SuperPlot }).plot = plot
