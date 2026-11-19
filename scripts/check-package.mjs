// Fails the build when a package breaks the layering, ships the wrong files, or does not run in plain Node.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

// Plain Node: the server-safe entries import and render without a DOM.
try {
  globalThis.document = undefined
  const core = await import(pathToFileURL(join('packages/core/dist/index.js')).href)
  const tools = await import(pathToFileURL(join('packages/core/dist/tools.js')).href)
  await import(pathToFileURL(join('packages/core/dist/adapters.js')).href)
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
