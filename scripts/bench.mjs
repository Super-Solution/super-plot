// Measures compile, SVG string, SVG DOM mount, canvas draw, hover and bundle sizes.
// Usage: node scripts/bench.mjs   (needs `npm run build` first). Prints JSON; numbers are medians.
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const core = await import(root + 'packages/core/dist/index.js')
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
let seed = 7
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())

const specs = {
  scatter: n => ({ type: 'scatter', x: 'x', y: 'y', series: 's', data: Array.from({ length: n }, () => ({ x: gauss(), y: gauss(), s: ['A', 'B', 'C'][Math.floor(rnd() * 3)] })) }),
  line: n => { let v = 100; return { type: 'line', x: 't', y: 'v', data: Array.from({ length: n }, (_, i) => ({ t: 1.7e12 + i * 60000, v: (v += gauss()) })) } },
  histogram: n => ({ type: 'histogram', value: 'v', data: Array.from({ length: n }, () => ({ v: gauss() })) })
}
const sizes = [1000, 10000, 50000]

function time(fn, runs) { const t = []; let out; for (let i = 0; i < runs; i++) { const a = performance.now(); out = fn(); t.push(performance.now() - a) } return { ms: median(t), out } }

const node = []
for (const [name, make] of Object.entries(specs)) for (const n of sizes) {
  const spec = make(n)
  const runs = n >= 50000 ? 5 : 9
  const c = time(() => core.compilePlot(spec, { width: 900, height: 500 }), runs)
  if (!c.out.ok) { node.push({ name, n, error: c.out.issues[0]?.message }); continue }
  const v = time(() => core.validatePlot(spec), runs)
  const s = time(() => core.renderSvg(c.out.scene, {}), runs)
  const svg = core.renderSvg(c.out.scene, {})
  node.push({ chart: name, rows: n, validateMs: +v.ms.toFixed(1), compileMs: +c.ms.toFixed(1), svgStringMs: +s.ms.toFixed(1), marks: c.out.scene.marks.length, dataMarks: core.dataMarkCount(c.out.scene), svgKB: Math.round(svg.length / 1024), issues: c.out.issues.map(i => i.code) })
}
// Heap held by one compiled scene (after GC)
const heap = []
if (globalThis.gc) for (const n of sizes) {
  const spec = specs.scatter(n); gc(); const b = process.memoryUsage().heapUsed
  const r = core.compilePlot(spec, { width: 900, height: 500 }); gc(); const a = process.memoryUsage().heapUsed
  heap.push({ rows: n, specMB: 0, sceneMB: +((a - b) / 1048576).toFixed(1), keep: r.ok })
}

// Bundle sizes (minified, esbuild) of what an app would actually ship
const size = async (code, label) => {
  const r = await build({ stdin: { contents: code, resolveDir: root, loader: 'js' }, bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', treeShaking: true, external: ['react', 'react/jsx-runtime'], logLevel: 'error' })
  const buf = Buffer.from(r.outputFiles[0].contents)
  return { label, minKB: +(buf.length / 1024).toFixed(1), gzipKB: +(gzipSync(buf).length / 1024).toFixed(1), brotliKB: +(brotliCompressSync(buf).length / 1024).toFixed(1) }
}
const bundles = [
  await size(`import {validatePlot} from './packages/core/dist/index.js'; console.log(validatePlot)`, 'core: validatePlot only'),
  await size(`import {renderToSvg} from './packages/core/dist/index.js'; console.log(renderToSvg)`, 'core: renderToSvg (server/static SVG)'),
  await size(`import {SuperPlot} from './packages/bindings/web/dist/index.js'; console.log(SuperPlot)`, 'web: SuperPlot (browser mount, all 12 charts)'),
  await size(`import {SuperPlot} from './packages/bindings/web/dist/index.js'; import './packages/bindings/web/dist/element.js'; console.log(SuperPlot)`, 'web + <super-plot> element'),
  await size(`import * as t from './packages/core/dist/tools.js'; console.log(t)`, 'core/tools (agent tools, incl. core)'),
  await size(readFileSync(root + 'packages/bindings/react/dist/index.js', 'utf8').replace(/^/, ''), 'react binding (excl. react)')
]

// Browser
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
await page.setContent('<!doctype html><body style="margin:0"><div id="h" style="width:900px;height:500px"></div></body>')
await page.addScriptTag({ path: root + 'packages/bindings/web/dist/super-plot.global.js' })
const cdp = await page.context().newCDPSession(page)
const browserRes = []
for (const [name, make] of Object.entries(specs)) for (const n of sizes) for (const renderer of ['svg', 'canvas']) {
  const spec = make(n)
  const r = await page.evaluate(async ({ spec, renderer }) => {
    const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const out = { mountMs: [], frameMs: [], nodes: 0 }
    for (let i = 0; i < 5; i++) {
      const host = document.getElementById('h'); host.replaceChildren()
      const t0 = performance.now()
      const p = new SuperPlot.SuperPlot(host, spec, { renderer, animate: false })
      const t1 = performance.now()
      await raf()
      const t2 = performance.now()
      out.mountMs.push(t1 - t0); out.frameMs.push(t2 - t0)
      out.nodes = host.getElementsByTagName('*').length
      out.renderer = p.getRenderer()
      if (i === 4) {
        // resize/redraw (what a window drag or setSpec costs) and hover
        const t3 = performance.now(); p.setOptions({ width: 880 }); const t4 = performance.now(); await raf(); out.redrawMs = t4 - t3; out.redrawFrameMs = performance.now() - t3
        const el = renderer === 'canvas' ? host.querySelector('canvas') : host.querySelector('svg')
        const b = el.getBoundingClientRect(); const times = []
        for (let k = 0; k < 40; k++) { const a = performance.now(); el.dispatchEvent(new PointerEvent('pointermove', { clientX: b.x + 100 + k * 13, clientY: b.y + 150 + (k % 7) * 30, bubbles: true })); times.push(performance.now() - a) }
        times.sort((x, y) => x - y); out.hoverMs = times[Math.floor(times.length / 2)]
      }
      p.dispose()
    }
    const m = a => { a = [...a].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }
    return { mountMs: m(out.mountMs), firstFrameMs: m(out.frameMs), domNodes: out.nodes, renderer: out.renderer, redrawMs: out.redrawMs, hoverMs: out.hoverMs }
  }, { spec, renderer })
  await cdp.send('HeapProfiler.collectGarbage')
  const mem = await page.evaluate(() => performance.memory.usedJSHeapSize)
  browserRes.push({ chart: name, rows: n, asked: renderer, ...r, jsHeapMB: +(mem / 1048576).toFixed(0) })
}
await browser.close()
console.log(JSON.stringify({ machine: { cpus: (await import('node:os')).cpus().length, model: (await import('node:os')).cpus()[0].model, node: process.version }, node, heap, bundles, browser: browserRes }, null, 1))
