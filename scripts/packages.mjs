// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// The single list of packages: build, check and release scripts all read this. `entries` are the public entry
// points (`.` for index, `./<key>` otherwise); check-package holds each package.json `exports` to them.
export const VERSION = '0.5.0'
export const packages = [
  {
    dir: 'packages/core', name: '@supersolutions/super-plot-core', allowed: [],
    entries: {
      index: 'src/index.ts', base: 'src/base.ts', charts: 'src/charts.ts', tools: 'src/tools.ts', adapters: 'src/adapters.ts',
      transforms: 'src/transforms.ts', canvas: 'src/canvas.ts', view: 'src/view.ts',
      'charts/basic': 'src/groups/basic.ts', 'charts/business': 'src/groups/business.ts', 'charts/stats': 'src/groups/stats.ts', 'charts/maps': 'src/groups/maps.ts',
      'charts/hierarchy': 'src/groups/hierarchy.ts', 'charts/3d': 'src/groups/3d.ts', 'charts/text': 'src/groups/text.ts'
    }
  },
  { dir: 'packages/bindings/web', name: '@supersolutions/super-plot-web', entries: { index: 'src/index.ts', base: 'src/base.ts', element: 'src/element-entry.ts' }, allowed: ['@supersolutions/super-plot-core', 'earcut'], global: 'src/global.ts' },
  { dir: 'packages/bindings/react', name: '@supersolutions/super-plot-react', entries: { index: 'src/index.tsx', base: 'src/base.tsx' }, allowed: ['@supersolutions/super-plot-web', 'react'] },
  {
    dir: 'packages/integrations/chat-plugin', name: '@supersolutions/super-plot-chat-plugin', entries: { index: 'src/index.ts' },
    allowed: ['@supersolutions/super-plot-core', '@supersolutions/super-plot-web', '@supersolutions/super-protocol']
  }
]
