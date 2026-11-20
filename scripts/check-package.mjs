// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// Fails the build when a package breaks the layering, ships the wrong files, or does not run in plain Node.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { packages, VERSION } from './packages.mjs'

const errors = []
const fail = m => errors.push(m)
const BANNED = ['vue', 'solid-js', 'svelte', 'klinecharts', 'd3', 'chart.js', 'echarts', 'plotly.js']

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

const bare = src => [...src.matchAll(/(?<![\w$.'"`])(?:from|import)\s*\(?\s*['"]([^'"./][^'"]*)['"]/g)].map(m => m[1]).map(s => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]))

for (const p of packages) {
  const pj = JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8'))
  if (pj.name !== p.name) fail(`${p.dir}: name ${pj.name} != ${p.name}`)
  if (pj.version !== VERSION) fail(`${p.name}: version ${pj.version} != lockstep ${VERSION}`)
  for (const [dep, v] of Object.entries(pj.dependencies ?? {})) if (!/^\d+\.\d+\.\d+/.test(v)) fail(`${p.name}: dependency ${dep} must be an exact version, got ${v}`)
  const declared = new Set([...Object.keys(pj.dependencies ?? {}), ...Object.keys(pj.peerDependencies ?? {})])
  for (const a of p.allowed) if (!declared.has(a)) fail(`${p.name}: allowed import ${a} is not declared in package.json`)
  for (const d of declared) if (BANNED.includes(d)) fail(`${p.name}: banned dependency ${d}`)
  for (const [sub, e] of Object.entries(pj.exports ?? {})) {
    for (const f of typeof e === 'string' ? [e] : Object.values(e)) if (!existsSync(join(p.dir, f))) fail(`${p.name}: export ${sub} -> ${f} missing (run build)`)
  }
  // Every entry point in packages.mjs is exported, from the file its source compiles to.
  for (const [key, src] of Object.entries(p.entries)) {
    const sub = key === 'index' ? '.' : `./${key}`
    const out = `./${src.replace(/^src\//, 'dist/').replace(/\.tsx?$/, '')}`
    const e = pj.exports?.[sub]
    if (!e) fail(`${p.name}: entry ${key} (${src}) has no "${sub}" in package.json exports`)
    else if (e.import !== `${out}.js` || e.types !== `${out}.d.ts`) fail(`${p.name}: export "${sub}" must point at ${out}.js and ${out}.d.ts`)
  }
  for (const sub of Object.keys(pj.exports ?? {})) {
    if (sub !== './global' && !Object.keys(p.entries).some(k => (k === 'index' ? '.' : `./${k}`) === sub)) fail(`${p.name}: export "${sub}" is not an entry in scripts/packages.mjs`)
  }
  // Layering: source and dist may import only what the package allows.
  for (const root of ['src', 'dist']) {
    if (!existsSync(join(p.dir, root))) continue
    for (const f of walk(join(p.dir, root))) {
      if (!/\.(ts|tsx|js)$/.test(f) || f.endsWith('.d.ts') && false) continue
      for (const imp of bare(readFileSync(f, 'utf8'))) {
        if (imp === 'react/jsx-runtime') continue
        if (!p.allowed.includes(imp)) fail(`${f}: imports "${imp}" which ${p.name} may not depend on`)
      }
    }
  }
  const pack = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: p.dir, encoding: 'utf8' }))[0]
  const files = pack.files.map(f => f.path)
  if (files.some(f => f.startsWith('src/') || f.startsWith('tests/') || f.endsWith('.tsbuildinfo'))) fail(`${p.name}: package ships sources or tests`)
  if (!files.includes('README.md')) fail(`${p.name}: README.md missing from package`)
  if (!files.some(f => f.startsWith('dist/'))) fail(`${p.name}: dist missing from package`)
}

// Code split on purpose: what `/base` reaches through static imports must not include the modules that are loaded
// on demand or registered separately (it is what keeps `npm run size` honest; import only types from them).
const resolveDist = (from, spec) => {
  if (spec.startsWith('.')) return join(dirname(from), spec)
  const m = spec.match(/^(@supersolutions\/super-plot-[a-z]+)(?:\/(.+))?$/)
  const pkg = m && packages.find(q => q.name === m[1])
  if (!pkg) return null
  const src = pkg.entries[m[2] ?? 'index']
  return src ? join(pkg.dir, src.replace(/^src\//, 'dist/').replace(/\.tsx?$/, '.js')) : null
}
const staticGraph = entry => {
  const seen = new Set()
  const todo = [entry]
  while (todo.length) {
    const f = todo.pop()
    if (seen.has(f) || !existsSync(f)) continue
    seen.add(f)
    // Static imports and re-exports only (a dynamic `import()` is a chunk).
    for (const m of readFileSync(f, 'utf8').matchAll(/^(?:import|export)\b[^;'"]*?(?:from\s*)?['"]([^'"]+)['"]/gm)) {
      const r = resolveDist(f, m[1])
      if (r) todo.push(r)
    }
  }
  return seen
}
const LAZY = ['packages/core/dist/canvas.js', 'packages/core/dist/transforms.js', 'packages/core/dist/geo/view.js', 'packages/core/dist/view3d.js', 'packages/core/dist/charts.js', 'packages/bindings/web/dist/canvas.js', 'packages/bindings/web/dist/gl/index.js', 'packages/bindings/web/dist/navigator.js', 'packages/bindings/web/dist/toolbar.js', 'packages/bindings/web/dist/map-control.js', 'packages/bindings/web/dist/transition.js']
for (const entry of ['packages/core/dist/base.js', 'packages/bindings/web/dist/base.js', 'packages/bindings/react/dist/base.js']) {
  const g = staticGraph(entry)
  for (const l of LAZY) if (g.has(l)) fail(`${entry} reaches ${l} through static imports: it would land in every /base bundle`)
}

// Plain Node: the server-safe entries import and render without a DOM.
try {
  globalThis.document = undefined
  const core = await import(pathToFileURL(join('packages/core/dist/index.js')).href)
  const tools = await import(pathToFileURL(join('packages/core/dist/tools.js')).href)
  await import(pathToFileURL(join('packages/core/dist/adapters.js')).href)
  for (const src of Object.values(packages[0].entries)) await import(pathToFileURL(join('packages/core', src.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js'))).href)
  const svg = core.renderToSvg(core.chartCatalog()[0].example)
  if (!svg.startsWith('<svg')) fail('core: renderToSvg did not return an svg in plain Node')
  if (tools.plotTools.length < 4) fail('core/tools: tools missing')
} catch (e) {
  fail(`core does not run in plain Node: ${e.message}`)
}

if (errors.length) {
  console.error(errors.map(e => `  x ${e}`).join('\n'))
  process.exit(1)
}
console.log(`check-package: ${packages.length} packages OK`)
