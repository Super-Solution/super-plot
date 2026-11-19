import { getChart } from './registry.js'
import { validatePlot } from './validate.js'
import type { Issue } from './schema.js'
import { pointNotes } from './charts/shared.js'

/**
 * Plain-language reading of a chart: what it shows and its headline numbers. The same text is the
 * SVG's `<desc>`, so a screen reader or a text-only agent gets the data without seeing pixels.
 */
export function describePlot(input: unknown, options: { locale?: string } = {}): { ok: true; text: string; issues: Issue[] } | { ok: false; issues: Issue[] } {
  const v = validatePlot(input)
  if (!v.ok || !v.spec) return { ok: false, issues: v.issues }
  const spec = v.spec
  const text = typeof spec.description === 'string' && spec.description ? spec.description : getChart(spec.type)!.describe(spec, { locale: options.locale ?? 'en' }) + pointNotes(spec)
  return { ok: true, text, issues: v.issues }
}
