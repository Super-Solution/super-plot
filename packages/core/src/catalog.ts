import { chartTypes, fieldsOf, getChart } from './registry.js'
import { fieldDefault, fieldSchema, fieldType, LIMITS } from './schema.js'

export interface FieldInfo { name: string; type: string; required: boolean; default?: unknown; description: string }
export interface ChartInfo {
  type: string
  name: string
  summary: string
  useWhen: string
  fields: FieldInfo[]
  example: Record<string, unknown>
}

/** Everything an agent needs to pick a chart and fill in its spec, generated from the registry. */
export function chartCatalog(): ChartInfo[] {
  return chartTypes().map(t => {
    const def = getChart(t)!
    return {
      type: def.type,
      name: def.name,
      summary: def.summary,
      useWhen: def.useWhen,
      fields: Object.entries(fieldsOf(def)).map(([name, f]) => ({ name, type: fieldType(f).replace(/\\\|/g, '|'), required: f.required === true, ...(fieldDefault(f) !== undefined ? { default: fieldDefault(f) } : {}), description: f.desc })),
      example: def.example
    }
  })
}

/** JSON Schema (2020-12) for a plot spec, one branch per chart type. */
export function plotJsonSchema(): Record<string, unknown> {
  const branches = chartTypes().map(t => {
    const def = getChart(t)!
    const props: Record<string, unknown> = {}
    const required: string[] = []
    for (const [name, f] of Object.entries(fieldsOf(def))) {
      props[name] = name === 'type' ? { const: def.type } : fieldSchema(f)
      if (f.required) required.push(name)
    }
    return { title: def.name, description: `${def.summary} ${def.useWhen}`, type: 'object', additionalProperties: false, required, properties: props }
  })
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://supersolution.io/schemas/super-plot/plot-spec-v1.json',
    title: 'Super Plot spec v1',
    description: `A declarative chart: a chart type, tabular rows and the columns to encode. Limits: ${LIMITS.maxRows} rows.`,
    oneOf: branches
  }
}
