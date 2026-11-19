import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const p = (s: string): string => fileURLToPath(new URL(s, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@supersolutions/super-plot-core/tools': p('./packages/core/src/tools.ts'),
      '@supersolutions/super-plot-core/adapters': p('./packages/core/src/adapters.ts'),
      '@supersolutions/super-plot-core': p('./packages/core/src/index.ts'),
      '@supersolutions/super-plot-web/element': p('./packages/bindings/web/src/element.ts'),
      '@supersolutions/super-plot-web': p('./packages/bindings/web/src/index.ts'),
      '@supersolutions/super-plot-react': p('./packages/bindings/react/src/index.tsx')
    }
  },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' }
})
