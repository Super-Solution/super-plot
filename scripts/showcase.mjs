// Builds examples/dist/showcase.html: one self-contained file (script inlined), opens by double click.
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const root = new URL('..', import.meta.url).pathname
const alias = {
  '@supersolutions/super-plot-core': join(root, 'packages/core/src/index.ts'),
  '@supersolutions/super-plot-web': join(root, 'packages/bindings/web/src/index.ts')
}
const r = await build({ entryPoints: [join(root, 'examples/showcase/main.ts')], bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, alias, logLevel: 'warning' })
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = readFileSync(join(root, 'examples/showcase/index.html'), 'utf8').replace('/*BUNDLE*/', () => js)
mkdirSync(join(root, 'examples/dist'), { recursive: true })
writeFileSync(join(root, 'examples/dist/showcase.html'), html)
console.log(`examples/dist/showcase.html (${Math.round(html.length / 1024)} KB)`)
