// Differential fuzzing of the ports against the reference implementation.
//   node ports/fuzz/generate.mjs <seed> <out.json>
// Writes random numbers (formatting, ticks, bins, box statistics) and random specs of every chart type together
// with what the TypeScript implementation says about them. `check.py` and `cmd/fuzzcheck` compare a port to it.
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../..', import.meta.url).pathname
const core = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href)
const seed = Number(process.argv[2] ?? 7)
const target = process.argv[3]
let s = seed
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
s = seed
const vals = []
for (let i = 0; i < 6000; i++) {
  const mag = Math.floor(rnd() * 22) - 7
  let v = (rnd() - 0.4) * 10 ** mag
  const r = rnd()
  if (r < 0.3) v = Math.round(v * 100) / 100
  else if (r < 0.4) v = Math.round(v * 1000) / 1000 + 0.0005
  else if (r < 0.5) v = Math.round(v)
  else if (r < 0.55) v = Math.round(v * 2) / 2
  if (Object.is(v, -0)) v = 0
  vals.push(v)
}
const formats = ['auto', 'compact', 'integer', 'percent', 'fixed:1', 'fixed:4', 'currency:USD', 'currency:EUR', 'currency:JPY']
const out = []
for (const f of formats) { const fn = core.valueFormatter(f, 'en'); for (const v of vals) out.push([f, v, fn(v)]) }
const ticks = []
for (let i = 0; i < 3000; i++) { const a = (rnd() - 0.3) * 10 ** (Math.floor(rnd() * 8) - 3); const b = a + rnd() * 10 ** (Math.floor(rnd() * 8) - 3); const n = 2 + Math.floor(rnd() * 9); ticks.push([a, b, n, core.linearTicks(a, b, n), core.niceDomain(a, b, n)]) }
const bins = []
for (let i = 0; i < 800; i++) { const n = 2 + Math.floor(rnd() * 150); const sc = 10 ** (Math.floor(rnd() * 6) - 2); const vs = Array.from({ length: n }, () => Math.round(rnd() * rnd() * sc * 100) / 100); const b = rnd() < 0.5 ? 'auto' : 1 + Math.floor(rnd() * 40); bins.push([vs, b, core.binEdges(vs, b), core.binCounts(vs, core.binEdges(vs, b)), core.boxStats(vs)]) }
const numeric = { out, ticks, bins }

s = seed + 1
const pick = a => a[Math.floor(rnd() * a.length)]
const chance = p => rnd() < p
const words = ['alpha', 'Beta', 'gamma', 'δelta', '台灣', 'Other', 'a b', '', 'x'.repeat(45), '😀 smile', 'Q1', 'Q2']
const dates = ['2026-01-05', '2026-02-10', '2026-03-31', '2026-03-01T10:30:00Z', '2025-12-01', '2026-02-30', '2024-02-29', '2026-07']
const numval = () => pick([() => Math.round(rnd() * 100), () => rnd() * 1000, () => -rnd() * 50, () => Math.round(rnd() * 1e6), () => rnd() / 100, () => 0, () => 1e7 * rnd(), () => String(Math.round(rnd() * 50)), () => null, () => 'n/a', () => '', () => true])()
const cat = () => pick(words)
const types = core.chartTypes()
const colsFor = { bar: ['x', 'y'], line: ['x', 'y'], area: ['x', 'y'], scatter: ['x', 'y'], pie: ['label', 'value'], donut: ['label', 'value'], histogram: ['value'], box: ['y'], heatmap: ['x', 'y', 'value'], radar: ['x', 'y'], treemap: ['label', 'value'], sankey: ['from', 'to', 'value'] }
function makeSpec() {
  const type = pick(types)
  const n = 1 + Math.floor(rnd() * 14)
  const data = []
  const wide = chance(0.3)
  const xKind = pick(['cat', 'date', 'num'])
  for (let i = 0; i < n; i++) {
    const row = {}
    row.k = xKind === 'cat' ? cat() : xKind === 'date' ? pick(dates) : Math.round(rnd() * 30) / (chance(0.3) ? 4 : 1)
    row.g = pick(['p', 'q', 'r', 's'])
    row.a = numval(); row.b = numval(); row.c = numval(); row.d = cat(); row.e = cat()
    if (chance(0.05)) delete row.a
    data.push(row)
  }
  const spec = { type, data }
  const num = () => pick(['a', 'b', 'c'])
  switch (type) {
    case 'bar': case 'line': case 'area': case 'radar':
      spec.x = chance(0.9) ? 'k' : 'd'; spec.y = wide ? ['a', 'b'].slice(0, 1 + Math.floor(rnd() * 2)) : num()
      if (!wide && chance(0.4)) spec.series = 'g'
      if (type === 'bar' && chance(0.4)) { spec.stack = pick(['none', 'stack', 'normalize']); spec.sort = pick(['asc', 'desc', 'none']) }
      if (type === 'area' && chance(0.5)) spec.stack = pick(['stack', 'normalize'])
      if ((type === 'line' || type === 'area') && chance(0.3)) spec.xType = pick(['auto', 'category', 'linear', 'time'])
      break
    case 'scatter': spec.x = chance(0.7) ? 'a' : 'k'; spec.y = num(); if (chance(0.4)) spec.series = 'g'; if (chance(0.2)) spec.xType = pick(['linear', 'time']); break
    case 'pie': case 'donut': spec.label = 'd'; spec.value = num(); if (chance(0.5)) spec.sort = pick(['none', 'asc', 'desc']); if (chance(0.5)) spec.maxSlices = 2 + Math.floor(rnd() * 6); break
    case 'histogram': spec.value = num(); if (chance(0.4)) spec.series = 'g'; if (chance(0.3)) spec.bins = 1 + Math.floor(rnd() * 20); if (chance(0.2)) spec.binWidth = pick([0.5, 2, 25]); break
    case 'box': spec.y = num(); if (chance(0.7)) spec.x = 'g'; break
    case 'heatmap': spec.x = 'd'; spec.y = 'e'; spec.value = num(); break
    case 'treemap': spec.label = 'd'; spec.value = num(); if (chance(0.5)) spec.group = pick(['e', 'g', 'd']); break
    case 'sankey': spec.from = 'd'; spec.to = 'e'; spec.value = num(); break
  }
  if (chance(0.5)) spec.format = pick(['auto', 'compact', 'integer', 'percent', 'fixed:2', 'currency:USD', 'currency:EUR'])
  if (chance(0.3)) spec.title = pick(words)
  if (chance(0.08)) spec.legend = pick(['top', 'weird'])
  if (chance(0.05)) spec.colors = { a: pick(['red', 'url(x)', '#fff', 'rgb(1,2,3)']) }
  if (chance(0.05)) spec.bogus = 1
  return spec
}
const specOut = []
for (let i = 0; i < 4000; i++) {
  const spec = makeSpec()
  const v = core.validatePlot(spec)
  const d = core.describePlot(spec)
  specOut.push({ spec, ok: v.ok, issues: v.issues.map(x => [x.severity, x.code, x.path]), normalized: v.spec ? (({ data, ...r }) => r)(v.spec) : null, describe: d.ok ? d.text : null })
}
const specs = specOut

writeFileSync(target, JSON.stringify({ ...numeric, specs }))
console.log(`seed ${seed}: ${numeric.out.length + numeric.ticks.length + numeric.bins.length} numeric cases, ${specs.length} specs`)
