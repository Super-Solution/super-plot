// Server-side / agent-side use: no DOM. Run after `npm run build`:  node examples/node/render-svg.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { chartCatalog, renderToSvg } from '../../packages/core/dist/index.js'
import { plotTools, getPlotTool } from '../../packages/core/dist/tools.js'

mkdirSync('examples/node/out', { recursive: true })
for (const info of chartCatalog()) writeFileSync(`examples/node/out/${info.type}.svg`, renderToSvg(info.example, { width: 720, theme: 'light' }))
console.log(`wrote ${chartCatalog().length} SVG files to examples/node/out/`)

// What an agent runtime does: pick tools by name, call them with JSON.
console.log('tools:', plotTools.map(t => t.name).join(', '))
const bad = getPlotTool('plot_validate').run({ spec: { type: 'bar', x: 'regoin', y: 'revenue', data: [{ region: 'APAC', revenue: 120 }] } })
console.log(JSON.stringify(bad, null, 2))
