// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// What a page pays for common imports of the built packages (esbuild minify + gzip, the entry and what it imports
// statically; code loaded on demand is listed apart). Run `npm run build` first.
//   node scripts/size.mjs           print the table
//   node scripts/size.mjs --check   also fail when a case is over its budget (`npm run gate` runs this)
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { overBudget } from './size-budget.mjs'

const core = '@supersolutions/super-plot-core'
const web = '@supersolutions/super-plot-web'
/** Each case: the code, and its budget in KB gzip (a little above what it measured when the budget was set). */
const cases = {
  'core base, no chart': [`import { renderToSvg } from '${core}/base'; console.log(renderToSvg({}))`, 25],
  'core base+bar validate': [`import { validatePlot, registerChart } from '${core}/base'; import { bar } from '${core}/charts'; registerChart(bar); console.log(validatePlot({}))`, 29],
  'core base+bar renderToSvg': [`import { renderToSvg, registerChart } from '${core}/base'; import { bar } from '${core}/charts'; registerChart(bar); console.log(renderToSvg({}))`, 41],
  'core base+basic': [`import { renderToSvg, registerCharts } from '${core}/base'; import { basicCharts } from '${core}/charts/basic'; registerCharts(basicCharts); console.log(renderToSvg({}))`, 64],
  'core base+basic+transforms': [`import { renderToSvg, registerCharts, registerTransforms } from '${core}/base'; import { basicCharts } from '${core}/charts/basic'; import { allTransforms } from '${core}/transforms'; registerCharts(basicCharts); registerTransforms(allTransforms); console.log(renderToSvg({}))`, 69.3],
  'core base+bar resolveRef': [`import { resolveRef, registerChart } from '${core}/base'; import { bar } from '${core}/charts'; registerChart(bar); console.log(resolveRef({}, 'ref:p'))`, 32.5],
  'core full': [`import { renderToSvg } from '${core}'; console.log(renderToSvg({}))`, 136],
  'web base, no chart': [`import { SuperPlot } from '${web}/base'; new SuperPlot(document.body, {})`, 51],
  'web base+bar+line': [`import { SuperPlot } from '${web}/base'; import { registerChart } from '${core}/base'; import { bar, line } from '${core}/charts'; registerChart(bar); registerChart(line); new SuperPlot(document.body, {})`, 77],
  'web base+basic': [`import { SuperPlot } from '${web}/base'; import { registerCharts } from '${core}/base'; import { basicCharts } from '${core}/charts/basic'; registerCharts(basicCharts); new SuperPlot(document.body, {})`, 91.5],
  'web full': [`import { SuperPlot } from '${web}'; new SuperPlot(document.body, {})`, 164.6],
  'chat plugin': [`import { createPlotChatPlugin } from '@supersolutions/super-plot-chat-plugin'; console.log(createPlotChatPlugin())`, 174.5]
}

const kb = n => (n / 1024).toFixed(1)
const measured = {}
const lazy = new Map()
for (const [name, [src]] of Object.entries(cases)) {
  // `tsconfigRaw` keeps the checkout's tsconfig `paths` (which point at the sources) out: this is the published dist.
  const r = await build({ stdin: { contents: src, resolveDir: process.cwd(), loader: 'js' }, bundle: true, minify: true, write: false, metafile: true, splitting: true, outdir: 'size-out', format: 'esm', platform: 'browser', external: ['earcut'], logLevel: 'error', tsconfigRaw: '{}' })
  const outs = r.metafile.outputs
  const seen = new Set()
  const visit = k => {
    if (seen.has(k)) return
    seen.add(k)
    for (const i of outs[k].imports) if (i.kind === 'import-statement' && outs[i.path]) visit(i.path)
  }
  visit(Object.keys(outs).find(k => k.endsWith('stdin.js')))
  const bytes = k => Buffer.from(r.outputFiles.find(f => f.path.endsWith(k.replace(/^size-out\//, '/'))).contents)
  const main = Buffer.concat([...seen].map(bytes))
  measured[name] = gzipSync(main).length / 1024
  console.log(name.padEnd(28), kb(main.length).padStart(6), 'KB min', kb(gzipSync(main).length).padStart(6), 'KB gzip')
  // Chunks a web `/base` page fetches on demand (named by the module that starts them; shared ones as "shared").
  if (name === 'web base, no chart') {
    for (const [k, o] of Object.entries(outs)) {
      if (seen.has(k) || !k.endsWith('.js')) continue
      const entry = o.entryPoint?.replace(/^.*\/dist\//, '').replace(/\.js$/, '') ?? 'shared'
      const b = bytes(k)
      lazy.set(entry, [(lazy.get(entry)?.[0] ?? 0) + b.length, (lazy.get(entry)?.[1] ?? 0) + gzipSync(b).length])
    }
  }
}
console.log('\nloaded on demand (web /base):')
for (const [k, [min, gz]] of [...lazy].sort((a, b) => b[1][1] - a[1][1])) console.log(`  ${k.padEnd(26)} ${kb(min).padStart(6)} KB min ${kb(gz).padStart(6)} KB gzip`)

if (process.argv.includes('--check')) {
  const over = overBudget(measured, Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v[1]])))
  if (over.length) {
    console.error(over.map(o => `  x ${o.name}: ${o.size.toFixed(1)} KB gzip, budget ${o.budget} KB`).join('\n'))
    console.error('A bundle grew past its budget: find what came in (`metafile`), or raise the budget in scripts/size.mjs on purpose.')
    process.exit(1)
  }
  console.log(`size: ${Object.keys(cases).length} cases within budget`)
}
