// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// Builds examples/dist/showcase.html: one self-contained file (script inlined), opens by double click.
import { build } from 'esbuild'
import { sourceAliases } from './aliases.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const alias = sourceAliases(root)
const r = await build({ entryPoints: [join(root, 'examples/showcase/main.ts')], bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, alias, logLevel: 'warning' })
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = readFileSync(join(root, 'examples/showcase/index.html'), 'utf8').replace('/*BUNDLE*/', () => js)
mkdirSync(join(root, 'examples/dist'), { recursive: true })
writeFileSync(join(root, 'examples/dist/showcase.html'), html)
console.log(`examples/dist/showcase.html (${Math.round(html.length / 1024)} KB)`)
