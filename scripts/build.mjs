// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { packages } from './packages.mjs'

/** Every source module of a package (`.d.ts` files excluded). */
function sources(dir) {
  const out = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const noDts = process.argv.includes('--no-dts')
for (const p of packages) {
  rmSync(join(p.dir, 'dist'), { recursive: true, force: true })
  // One output file per source module, not a bundle: the user's bundler then sees the same files as the sources,
  // so `sideEffects` and tree shaking drop what a page does not import, and a dynamic `import()` (the canvas,
  // WebGL, navigator, toolbar, map-control and transition code) stays its own chunk in the user's build.
  await build({
    entryPoints: sources(join(p.dir, 'src')),
    outdir: join(p.dir, 'dist'),
    outbase: join(p.dir, 'src'),
    bundle: false,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
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
