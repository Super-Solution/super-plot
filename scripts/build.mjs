import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { packages } from './packages.mjs'

const noDts = process.argv.includes('--no-dts')
for (const p of packages) {
  rmSync(join(p.dir, 'dist'), { recursive: true, force: true })
  await build({
    entryPoints: Object.fromEntries(Object.entries(p.entries).map(([k, v]) => [k, join(p.dir, v)])),
    outdir: join(p.dir, 'dist'),
    bundle: true,
    format: 'esm',
    // Code loaded on demand (the WebGL layer) becomes its own chunk.
    splitting: p.split === true,
    chunkNames: 'chunks/[name]-[hash]',
    target: 'es2022',
    platform: 'neutral',
    // Sibling packages and React are dependencies, never bundled in.
    external: ['@supersolutions/*', 'react', 'react/jsx-runtime', 'earcut'],
    jsx: 'automatic',
    sourcemap: true,
    logLevel: 'warning'
  })
  if (p.global) {
    await build({ entryPoints: [join(p.dir, p.global)], outfile: join(p.dir, 'dist/super-plot.global.js'), bundle: true, format: 'iife', target: 'es2020', platform: 'browser', minify: true, logLevel: 'warning' })
  }
  if (!noDts) execFileSync('npx', ['tsc', '-p', join(p.dir, 'tsconfig.build.json')], { stdio: 'inherit' })
  console.log(`built ${p.name}`)
}
