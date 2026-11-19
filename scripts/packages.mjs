// The single list of packages: build, check and release scripts all read this.
export const VERSION = '0.4.0'
export const packages = [
  { dir: 'packages/core', name: '@supersolutions/super-plot-core', entries: { index: 'src/index.ts', base: 'src/base.ts', charts: 'src/charts.ts', tools: 'src/tools.ts', adapters: 'src/adapters.ts' }, allowed: [], split: true },
  { dir: 'packages/bindings/web', name: '@supersolutions/super-plot-web', entries: { index: 'src/index.ts', base: 'src/base.ts', element: 'src/element-entry.ts' }, allowed: ['@supersolutions/super-plot-core', 'earcut'], global: 'src/global.ts', split: true },
  { dir: 'packages/bindings/react', name: '@supersolutions/super-plot-react', entries: { index: 'src/index.tsx', base: 'src/base.tsx' }, allowed: ['@supersolutions/super-plot-web', 'react'], split: true }
]
