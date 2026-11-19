import { chartCatalog, GEO_PRESETS, registerGeography, getGeography, type Issue } from '@supersolutions/super-plot-core'
import { SuperPlot } from '@supersolutions/super-plot-web'

type Spec = Record<string, unknown>
const by = (type: string): Spec => structuredClone(chartCatalog().find(c => c.type === type)!.example) as Spec

const CHARTS: Record<string, { label: string; spec: () => Spec }> = {
  choropleth: { label: 'Choropleth', spec: () => by('choropleth') },
  raised: { label: 'Raised regions', spec: () => ({ ...by('choropleth'), extrude: true, title: 'Rainfall, raised by value' }) },
  bubbles: { label: 'Bubbles', spec: () => by('bubble-map') },
  columns: { label: '3D columns', spec: () => by('column-map') },
  flows: { label: 'Flows', spec: () => by('flow-map') },
  imported: { label: 'Imported file', spec: () => importedSpec() }
}
const VIEWS: Record<string, { label: string; patch: Spec }> = {
  flat: { label: 'Flat', patch: { view: 'flat' } },
  tilted: { label: 'Tilted', patch: { view: 'flat', camera: { pitch: 45, bearing: -15 } } },
  globe: { label: 'Globe', patch: { view: 'globe' } }
}
const RENDERERS = ['auto', 'svg', 'canvas', 'webgl'] as const

let chart = 'choropleth'
let view = 'flat'
let renderer: (typeof RENDERERS)[number] = 'auto'
let disputed = 'same'

function specNow(): Spec {
  const s = CHARTS[chart].spec()
  const v = VIEWS[view].patch
  return { ...s, ...v, camera: { ...(s.camera as Spec | undefined), ...(v.camera as Spec | undefined) }, disputed }
}

/** The imported geography with a deterministic demo value per region (say so in the title). */
function importedSpec(): Spec {
  const g = getGeography('imported')
  if (!g) return { type: 'choropleth', geo: 'imported', region: 'region', value: 'value', data: [] }
  const data = g.regions.map((r, i) => ({ region: r.key, value: ((i * 7919) % 97) + 3 }))
  return { type: 'choropleth', title: 'Your boundaries', subtitle: `${g.regions.length} regions · values are placeholders, generated per region`, geo: 'imported', region: 'region', value: 'value', data }
}

const host = document.getElementById('plot')!
const stat = document.getElementById('stat')!
const plot = new SuperPlot(host, specNow(), {
  renderer, animate: false,
  onCameraChange: () => show(),
  onIssues: issues => { if (chart === 'imported') listIssues(issues, false) }
})

function seg(id: string, items: [string, string][], cur: () => string, set: (v: string) => void): void {
  const box = document.getElementById(id)!
  box.innerHTML = items.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')
  box.addEventListener('click', e => {
    const v = (e.target as HTMLElement).dataset.v
    if (v) { set(v); redo() }
  })
  ;(box as HTMLElement & { sync?: () => void }).sync = () => { for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === cur())) }
}
seg('chart', Object.entries(CHARTS).map(([k, c]) => [k, c.label]), () => chart, v => { chart = v })
seg('view', Object.entries(VIEWS).map(([k, c]) => [k, c.label]), () => view, v => { view = v })
seg('r', RENDERERS.map(r => [r, r === 'webgl' ? 'WebGL' : r[0].toUpperCase() + r.slice(1)]), () => renderer, v => { renderer = v as typeof renderer })
document.querySelector<HTMLButtonElement>('#chart [data-v="imported"]')!.hidden = true

function show(): void {
  const c = plot.getCamera()
  const cam = c ? ` · camera ${c.lng.toFixed(1)}°, ${c.lat.toFixed(1)}° · zoom ${c.zoom.toFixed(2)} · pitch ${c.pitch.toFixed(0)}° · bearing ${c.bearing.toFixed(0)}°` : ''
  stat.innerHTML = `Renderer <b>${plot.getRenderer()}</b>${cam}`
  for (const b of document.querySelectorAll<HTMLElement & { sync?: () => void }>('.seg')) b.sync?.()
  document.body.dataset.ready = '1'
}
// The WebGL layer loads on first use, so the renderer can change after `setOptions` returns.
new MutationObserver(show).observe(host, { subtree: true, attributes: true, attributeFilter: ['data-renderer'] })

function redo(): void {
  plot.setOptions({ renderer })
  plot.resetCamera()
  plot.setSpec(specNow())
  show()
}

// ---- import --------------------------------------------------------------------------------
const presetBox = document.getElementById('preset') as HTMLSelectElement
for (const [k, p] of Object.entries(GEO_PRESETS)) presetBox.add(new Option(`${k}: ${p.description.split('.')[0]}`, k))
const issuesBox = document.getElementById('issues')!
function listIssues(issues: Issue[], replace = true): void {
  if (replace) issuesBox.replaceChildren()
  for (const i of issues.slice(0, 12)) {
    const li = document.createElement('li')
    li.className = i.severity
    li.textContent = `${i.severity}: ${i.message}${i.hint ? ` ${i.hint}` : ''}`
    issuesBox.appendChild(li)
  }
}
let fileText = ''
async function useFile(): Promise<void> {
  if (!fileText) return
  let data: unknown
  try { data = JSON.parse(fileText) } catch { return listIssues([{ severity: 'error', code: 'invalid_json', path: 'file', message: 'This file is not JSON.' }]) }
  const preset = presetBox.value
  const keyProp = (document.getElementById('keyProp') as HTMLInputElement).value.trim()
  const base = preset ? { ...GEO_PRESETS[preset] } : {}
  const options = keyProp ? { ...base, key: (p: Record<string, unknown>) => p[keyProp] } : base
  const issues = registerGeography('imported', data, options)
  listIssues(issues)
  const g = getGeography('imported')
  if (g) {
    const li = document.createElement('li')
    li.textContent = `Loaded ${g.regions.length} regions, e.g. ${g.regions.slice(0, 5).map(r => r.name || r.key).join(', ')}.`
    issuesBox.prepend(li)
    document.querySelector<HTMLButtonElement>('#chart [data-v="imported"]')!.hidden = false
    chart = 'imported'
    redo()
  }
}
document.getElementById('file')!.addEventListener('change', async e => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  fileText = await f.text()
  await useFile()
})
presetBox.addEventListener('change', () => void useFile())
document.getElementById('keyProp')!.addEventListener('change', () => void useFile())
document.getElementById('disputed')!.addEventListener('change', e => { disputed = (e.target as HTMLSelectElement).value; redo() })

show()
;(window as unknown as { plot: SuperPlot; registerGeography: typeof registerGeography }).plot = plot
;(window as unknown as { registerGeography: typeof registerGeography }).registerGeography = registerGeography
