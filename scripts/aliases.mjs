// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// esbuild `alias` from every package entry point to its source (examples, showcase): built against the checkout.
import { join } from 'node:path'
import { packages } from './packages.mjs'

export function sourceAliases(root) {
  const out = []
  for (const p of packages) for (const [key, src] of Object.entries(p.entries)) out.push([key === 'index' ? p.name : `${p.name}/${key}`, join(root, p.dir, src)])
  // Longest first: a subpath must not be taken for its package.
  return Object.fromEntries(out.sort((a, b) => b[0].length - a[0].length))
}
