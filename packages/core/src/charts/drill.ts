import type { ChartCtx } from '../context.js'
import type { Rect } from '../scene.js'
import type { Issue } from '../schema.js'
import { closest } from '../util/num.js'
import { clip, fit } from '../util/text.js'
import type { HierarchyNode } from './sunburst.js'

/** The `focus` field of treemap and sunburst. */
export const focusField = (levels: string): { kind: 'values'; max: number; desc: string } => ({
  kind: 'values',
  max: 6,
  desc: `Drill-down: a path of group values from the top level down (${levels}) that draws only that subtree, with a breadcrumb line ("All › Asia › Japan") at the top. [] or omitted draws the whole tree. A path that does not name a group with children warns and draws the whole tree. The web binding changes it when the viewer clicks a group (option \`drill\`).`
})

/** The node a `focus` path names: null when there is no path, or it does not lead to a node with children. */
export function focusNode(root: HierarchyNode, focus: unknown): HierarchyNode | null {
  if (!Array.isArray(focus) || !focus.length) return null
  let node = root
  for (const name of focus) {
    const next = node.children.find(c => c.name === String(name))
    if (!next) return null
    node = next
  }
  return node.children.length ? node : null
}

/**
 * Validation of `focus`: a warning (the whole tree is drawn) for a name that is not under its parent
 * (`focus_not_found`, with the nearest name and the ones that are there) or a path that ends on a leaf
 * (`focus_leaf`).
 */
export function checkFocus(root: HierarchyNode, focus: unknown, issues: Issue[], what = 'group'): void {
  if (!Array.isArray(focus) || !focus.length) return
  let node = root
  for (let i = 0; i < focus.length; i++) {
    const name = String(focus[i])
    const next = node.children.find(c => c.name === name)
    if (!next) {
      const names = node.children.map(c => c.name)
      const near = closest(name, names)
      const under = node === root ? 'at the top level' : `under "${clip(node.path.join(' > '), 60)}"`
      issues.push({
        severity: 'warning', code: 'focus_not_found', path: `focus[${i}]`,
        message: names.length ? `There is no ${what} "${clip(name, 60)}" ${under}; the whole tree is drawn.` : `"${clip(node.path.join(' > '), 60)}" has nothing under it; the whole tree is drawn.`,
        ...(names.length ? { hint: `${near ? `Did you mean "${near}"? ` : ''}${names.length > 12 ? 'Some of the' : 'The'} ${what}s there: ${names.slice(0, 12).map(n => clip(n, 30)).join(', ')}.` } : {})
      })
      return
    }
    node = next
  }
  if (!node.children.length) issues.push({ severity: 'warning', code: 'focus_leaf', path: `focus[${focus.length - 1}]`, message: `"${clip(node.path.join(' > '), 80)}" has no ${what}s under it, so there is nothing to drill into; the whole tree is drawn.`, hint: 'Drop the last value to focus on its parent.' })
}

/**
 * The breadcrumb line at the top of `area` ("All › Asia › Japan"): each ancestor is a text plus a transparent
 * `label` rect that carries its `drill` path (a button in interactive SVG, a click target on canvas); the last
 * item, where the chart is, is bold, not a target, and its text carries the whole path. Returns the area left below it.
 */
export function breadcrumb(c: ChartCtx, area: Rect, focus: string[]): Rect {
  const size = c.size
  const rowH = size + 10
  const items = [c.t('breadcrumbRoot'), ...focus]
  // The separator is its own text with a gap each side (SVG collapses the spaces of a ' › ' string).
  const sep = '›'
  const gap = 6
  const sepW = c.measure(sep) + gap * 2
  const each = Math.max(24, (area.w - sepW * (items.length - 1)) / items.length)
  let x = area.x
  const cy = area.y + rowH / 2
  items.forEach((name, i) => {
    const last = i === items.length - 1
    const text = fit(name, Math.max(each, last ? area.x + area.w - x : 0), size, c.env.measure, last ? 600 : 400)
    const w = c.measure(text, size, last ? 600 : 400)
    // The current item's text carries the whole focus path, so a binding can read where the chart is.
    c.marks.push(c.text(x, cy, text, { role: 'label', baseline: 'middle', fill: last ? c.c('text') : c.c('info'), weight: last ? 600 : 400, ...(last ? { drill: [...focus] } : {}) }))
    if (!last) {
      const path = focus.slice(0, i)
      c.marks.push({ type: 'rect', role: 'label', x: x - 3, y: area.y, w: w + 6, h: rowH, fill: 'transparent', drill: path, aria: c.t('breadcrumbUp', { name: clip(name, 60) }) })
      c.marks.push(c.text(x + w + gap, cy, sep, { role: 'label', baseline: 'middle' }))
    }
    x += w + sepW
  })
  return { x: area.x, y: area.y + rowH + 4, w: area.w, h: Math.max(40, area.h - rowH - 4) }
}
