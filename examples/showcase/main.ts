// One static page: every chart type in light and dark, then the same charts restyled three ways.
import { SuperPlot } from '@supersolutions/super-plot-web'
import { createTheme } from '@supersolutions/super-plot-core'
import { gallery } from '../_shared/specs'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}
const card = (parent: HTMLElement, mode: 'light' | 'dark', label: string, spec: Record<string, unknown>, theme: Parameters<typeof SuperPlot.prototype.setOptions>[0]['theme'], extra = ''): void => {
  const wrap = el('div', `card ${mode} ${extra}`)
  wrap.dataset.mode = mode
  wrap.appendChild(el('span', 'tag', label))
  const host = el('div', 'plot')
  wrap.appendChild(host)
  parent.appendChild(wrap)
  new SuperPlot(host, spec, { theme })
}

const types = document.getElementById('types')!
for (const g of gallery) {
  const row = el('section', 'row')
  const head = el('div', 'rowhead')
  head.appendChild(el('h3', '', g.id))
  head.appendChild(el('p', '', g.note))
  row.appendChild(head)
  const pair = el('div', 'pair')
  card(pair, 'light', 'light', g.spec, 'light')
  card(pair, 'dark', 'dark', g.spec, 'dark')
  row.appendChild(pair)
  types.appendChild(row)
}

// Same specs, three overrides. No fork, no re-render logic: CSS variables, a theme object, a spec colour.
const pick = (id: string): Record<string, unknown> => gallery.find(g => g.id === id)!.spec
const variants: { title: string; how: string; cls: string; theme: Parameters<typeof SuperPlot.prototype.setOptions>[0]['theme']; code: string }[] = [
  { title: 'Default', how: 'Nothing set.', cls: '', theme: 'light', code: '' },
  { title: 'Brand colours + serif', how: 'CSS variables on a parent element, including the font.', cls: 'v-brand', theme: 'light',
    code: '.brand {\n  --sp-series-1: #e8445a;\n  --sp-series-2: #1f8a70;\n  --sp-series-3: #f5a524;\n  --sp-font: Georgia, serif;\n}' },
  { title: 'Ink on paper', how: 'A theme object: palette, rounder bars, thicker lines.', cls: 'v-ink',
    theme: createTheme('light', { name: 'ink', palette: ['#111827', '#6b7280', '#9ca3af', '#d1d5db'], barRadius: 8, lineWidth: 3, colors: { grid: '#e5e7eb', 'seq-low': '#f3f4f6', 'seq-high': '#111827' } }),
    code: "createTheme('light', {\n  palette: ['#111827', '#6b7280', ...],\n  barRadius: 8, lineWidth: 3\n})" },
  { title: 'Dark violet', how: 'A dark theme with its own palette.', cls: 'v-violet',
    theme: createTheme('dark', { name: 'violet', palette: ['#8b7cff', '#2dd4bf', '#f472b6', '#facc15'], colors: { background: '#12101f', surface: '#1b1830', grid: '#2a2645', axis: '#3b3560', 'seq-low': '#241f45', 'seq-high': '#8b7cff' } }),
    code: "createTheme('dark', {\n  palette: ['#8b7cff', '#2dd4bf', ...],\n  colors: { background: '#12101f', ... }\n})" }
]
const themes = document.getElementById('themes')!
for (const v of variants) {
  const col = el('section', 'variant')
  col.appendChild(el('h3', '', v.title))
  col.appendChild(el('p', '', v.how))
  if (v.code) col.appendChild(el('pre', '', v.code))
  const dark = v.title === 'Dark violet'
  for (const id of ['bar', 'donut', 'line']) card(col, dark ? 'dark' : 'light', id, pick(id), v.theme, v.cls)
  themes.appendChild(col)
}

// Colour-vision safe preset: the same specs, one theme name.
const a11y = document.getElementById('a11y')!
for (const id of ['bar', 'donut', 'line']) {
  const row = el('section', 'row')
  const head = el('div', 'rowhead')
  head.appendChild(el('h3', '', id))
  row.appendChild(head)
  const pair = el('div', 'pair')
  card(pair, 'light', 'accessible', pick(id), 'accessible')
  card(pair, 'dark', 'accessible-dark', pick(id), 'accessible-dark')
  row.appendChild(pair)
  a11y.appendChild(row)
}

// Dense data: 20,000 points, drawn on canvas without the caller doing anything.
let seed = 11
const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
const dots: Record<string, unknown>[] = []
const centres: [string, number, number][] = [['Cluster A', 30, 40], ['Cluster B', 62, 58], ['Cluster C', 50, 24]]
for (let i = 0; i < 20000; i++) {
  const [name, cx, cy] = centres[i % 3]
  dots.push({ g: name, x: Math.round((cx + gauss() * 9) * 100) / 100, y: Math.round((cy + gauss() * 8) * 100) / 100 })
}
const dense = document.getElementById('dense')!
const row = el('section', 'row')
const head = el('div', 'rowhead')
head.appendChild(el('h3', '', 'scatter, 20,000 points'))
head.appendChild(el('p', '', 'Three clusters. Click a legend entry to hide one.'))
row.appendChild(head)
const pair = el('div', 'pair')
const denseSpec = { type: 'scatter', title: '20,000 measurements', x: 'x', y: 'y', series: 'g', xLabel: 'Signal', yLabel: 'Response', data: dots }
card(pair, 'light', 'light (canvas)', denseSpec, 'light')
card(pair, 'dark', 'dark (canvas)', denseSpec, 'dark')
row.appendChild(pair)
dense.appendChild(row)
