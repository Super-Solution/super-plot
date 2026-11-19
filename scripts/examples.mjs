// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// Bundles the examples against the sources in this checkout (never published) and serves them.
//   node scripts/examples.mjs          build + serve on http://localhost:5173/
//   node scripts/examples.mjs --build  build only
import { build } from 'esbuild'
import { cpSync, createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'examples/dist')
rmSync(out, { recursive: true, force: true })
const alias = {
  '@supersolutions/super-plot-core/base': join(root, 'packages/core/src/base.ts'),
  '@supersolutions/super-plot-core/charts': join(root, 'packages/core/src/charts.ts'),
  '@supersolutions/super-plot-core': join(root, 'packages/core/src/index.ts'),
  '@supersolutions/super-plot-web/base': join(root, 'packages/bindings/web/src/base.ts'),
  '@supersolutions/super-plot-web': join(root, 'packages/bindings/web/src/index.ts'),
  '@supersolutions/super-plot-react': join(root, 'packages/bindings/react/src/index.tsx')
}
for (const [dir, entry] of [['gallery', 'main.ts'], ['react', 'main.tsx'], ['canvas', 'main.ts'], ['maps', 'main.ts'], ['features', 'main.ts']]) {
  mkdirSync(join(out, dir), { recursive: true })
  await build({ entryPoints: [join(root, 'examples', dir, entry)], outfile: join(out, dir, 'main.js'), bundle: true, format: 'esm', target: 'es2022', alias, jsx: 'automatic', logLevel: 'warning' })
  for (const f of ['index.html', 'gallery.css']) if (existsSync(join(root, 'examples', dir, f))) cpSync(join(root, 'examples', dir, f), join(out, dir, f))
}
mkdirSync(join(out, 'element'), { recursive: true })
await build({ entryPoints: [join(root, 'packages/bindings/web/src/global.ts')], outfile: join(out, 'element/super-plot.global.js'), bundle: true, format: 'iife', target: 'es2020', alias, minify: true, logLevel: 'warning' })
cpSync(join(root, 'examples/element/index.html'), join(out, 'element/index.html'))
cpSync(join(root, 'examples/index.html'), join(out, 'index.html'))
await import('./showcase.mjs')
console.log('examples built in examples/dist')
if (process.argv.includes('--build')) process.exit(0)

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  if (p.endsWith('/')) p += 'index.html'
  const f = join(out, p)
  if (!f.startsWith(out) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404).end('not found'); return }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' })
  createReadStream(f).pipe(res)
}).listen(5173, () => console.log('http://localhost:5173/'))
