// Bundle cost of common imports (built packages, esbuild minify + gzip): node scripts/size.mjs. Run npm run build first.
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
const cases = {
  'full validate': `import { validatePlot } from '@supersolutions/super-plot-core'; console.log(validatePlot({}))`,
  'base+bar validate': `import { validatePlot, registerChart } from '@supersolutions/super-plot-core/base'; import { bar } from '@supersolutions/super-plot-core/charts'; registerChart(bar); console.log(validatePlot({}))`,
  'base+bar renderToSvg': `import { renderToSvg, registerChart } from '@supersolutions/super-plot-core/base'; import { bar } from '@supersolutions/super-plot-core/charts'; registerChart(bar); console.log(renderToSvg({}))`,
  'full renderToSvg': `import { renderToSvg } from '@supersolutions/super-plot-core'; console.log(renderToSvg({}))`,
  'web full': `import { SuperPlot } from '@supersolutions/super-plot-web'; new SuperPlot(document.body, {})`,
  'web base+bar+line': `import { SuperPlot } from '@supersolutions/super-plot-web/base'; import { registerChart } from '@supersolutions/super-plot-core/base'; import { bar, line } from '@supersolutions/super-plot-core/charts'; registerChart(bar); registerChart(line); new SuperPlot(document.body, {})`,
}
for (const [k, src] of Object.entries(cases)) {
  const r = await build({ stdin: { contents: src, resolveDir: process.cwd(), loader: 'js' }, bundle: true, minify: true, write: false, metafile: true, splitting: true, outdir: 'size-out', format: 'esm', platform: 'browser', external: ['earcut'], logLevel: 'error' })
  // The entry and what it imports statically; code loaded on demand (the WebGL layer) is left out.
  const outs = r.metafile.outputs
  const seen = new Set()
  const visit = k => {
    if (seen.has(k)) return
    seen.add(k)
    for (const i of outs[k].imports) if (i.kind === 'import-statement' && outs[i.path]) visit(i.path)
  }
  visit(Object.keys(outs).find(k => k.endsWith('stdin.js')))
  const files = r.outputFiles.filter(f => [...seen].some(k => f.path.endsWith(k.replace(/^size-out\//, '/'))))
  const main = Buffer.concat(files.map(f => Buffer.from(f.contents)))
  console.log(k.padEnd(24), (main.length / 1024).toFixed(1), 'KB min', (gzipSync(main).length / 1024).toFixed(1), 'KB gzip')
}
