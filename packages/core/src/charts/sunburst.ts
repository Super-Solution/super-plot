import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Row } from '../schema.js'
import { formatPercent } from '../util/format.js'
import { inkOn, mix } from '../util/color.js'
import { toNumber } from '../util/num.js'
import { tokenValue } from '../theme.js'
import { clip, fit } from '../util/text.js'
import { arc, fmtList, formatter, lead } from './shared.js'
import { breadcrumb, checkFocus, focusField, focusNode } from './drill.js'

/** Children kept per parent; the smallest beyond it are merged into one "Other" node. */
export const MAX_CHILDREN = 30
/** Arcs drawn at most; deeper rings stop once this is reached. */
const MAX_ARCS = 1500
export const MAX_LEVELS = 6

export interface HierarchyNode {
  name: string
  /** Names from the first level down to this node. */
  path: string[]
  /** Sum of the rows under this node (its children may add up to less: rows that stop early). */
  value: number
  children: HierarchyNode[]
  /** The merged remainder ("Other"). */
  other?: true
}

/**
 * Sum `value` over a hierarchy given by `levels` (column names, outermost group first). A row adds its value to
 * every node on its path. A row stops at its first empty level (null, undefined or ""), so it counts toward
 * its ancestors and leaves a gap outside them. Zero, negative and non-numeric values are skipped. Children are
 * ordered by value, largest first (ties in order of first appearance); past {@link MAX_CHILDREN} the smallest
 * are merged into "Other". Returns the root (name "", path []).
 */
export function hierarchy(rows: Row[], levels: string[], value: string): { root: HierarchyNode; merged: number } {
  const root: HierarchyNode = { name: '', path: [], value: 0, children: [] }
  const index = new Map<HierarchyNode, Map<string, HierarchyNode>>()
  for (const r of rows) {
    const v = toNumber(r[value])
    if (v === null || v <= 0) continue
    root.value += v
    let node = root
    for (const col of levels) {
      const raw = r[col]
      if (raw === null || raw === undefined || raw === '') break
      const name = String(raw)
      let kids = index.get(node)
      if (!kids) index.set(node, (kids = new Map()))
      let child = kids.get(name)
      if (!child) {
        child = { name, path: [...node.path, name], value: 0, children: [] }
        kids.set(name, child)
        node.children.push(child)
      }
      child.value += v
      node = child
    }
  }
  let merged = 0
  const tidy = (n: HierarchyNode): void => {
    n.children.sort((a, b) => b.value - a.value)
    if (n.children.length > MAX_CHILDREN) {
      const rest = n.children.splice(MAX_CHILDREN - 1)
      merged += rest.length
      n.children.push({ name: 'Other', path: [...n.path, 'Other'], value: rest.reduce((q, c) => q + c.value, 0), children: [], other: true })
    }
    n.children.forEach(tidy)
  }
  tidy(root)
  return { root, merged }
}

const levelsOf = (spec: Record<string, any>): string[] => (Array.isArray(spec.path) ? spec.path : [spec.path])

const depthOf = (n: HierarchyNode): number => (n.children.length ? 1 + Math.max(...n.children.map(depthOf)) : 0)

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const levels = levelsOf(s)
  const { root, merged } = hierarchy(s.data, levels, s.value)
  // The merged remainder is shown in the host's language (the tree is this compile's own copy).
  const rename = (n: HierarchyNode): void => {
    if (n.other) {
      n.name = c.t('other')
      n.path = [...n.path.slice(0, -1), n.name]
    }
    n.children.forEach(rename)
  }
  rename(root)
  if (merged) c.warn('many_children', 'path', `${merged} small groups were merged into "Other" (at most ${MAX_CHILDREN} per parent).`, 'Filter or aggregate with `transform` to show them.')
  const firsts = root.children.map(n => n.name)
  const series = c.makeSeries(firsts)
  // Drill-down: draw only the focused subtree. Its rings keep the colours they have in the whole tree, so the
  // legend (first-level branches) gives way to the breadcrumb, and legend toggles do not apply.
  const focus = focusNode(root, s.focus)
  const top = focus ?? root
  const live = focus ? focus.children : root.children.filter(n => !c.hidden.has(n.name))
  const total = focus ? root.value : live.reduce((q, n) => q + n.value, 0)
  const span = focus ? focus.value : total
  const base = focus ? focus.path.length : 0
  const frame = focus
    ? breadcrumb(c, c.frame({ series: [] }), focus.path)
    : c.frame({ series, autoSide: 'right', trailing: key => (c.hidden.has(key) ? '' : formatPercent(total ? (root.children.find(n => n.name === key)?.value ?? 0) / total : 0, c.locale)) })
  const depth = Math.max(1, depthOf(top))
  const R = Math.max(20, Math.min(frame.w, frame.h) / 2 - 4)
  const cx = frame.x + frame.w / 2
  const cy = frame.y + frame.h / 2
  const hole = R * (depth > 3 ? 0.16 : 0.24)
  const ring = (R - hole) / depth
  const bg = tokenValue(c.theme, 'background')
  const fmt = c.format
  const pct = (v: number): string => formatPercent(v, c.locale)
  let drawn = 0
  let dropped = 0

  const visit = (n: HierarchyNode, parent: number, a0: number, a1: number, d: number, hex: string, paint: string, key: string): void => {
    // `d` is the node's depth in the whole tree; the ring it is drawn on counts from the focus.
    const r0 = hole + (d - base - 1) * ring
    const r1 = r0 + ring
    const mid = (r0 + r1) / 2
    // Sub-pixel slivers are left to their parent's colour.
    if ((a1 - a0) * r1 < 0.5) return
    if (drawn >= MAX_ARCS) {
      dropped++
      return
    }
    drawn++
    const fill = d === 1 ? paint : mix(hex, bg, Math.min(0.62, 0.2 * (d - 1)))
    const shareParent = parent ? n.value / parent : 0
    const shareTotal = total ? n.value / total : 0
    const name = n.path.join(' / ')
    const rows = [{ label: String(s.value), value: fmt(n.value), color: fill }, ...(d > 1 ? [{ label: c.t('shareOfParent'), value: pct(shareParent) }] : []), { label: c.t('shareOfTotal'), value: pct(shareTotal) }]
    c.marks.push({
      type: 'path', role: 'data', series: key, d: arc(cx, cy, r0, r1, a0, a1), fill, stroke: c.c('background'), strokeWidth: 1, anim: 'fade',
      tip: { title: clip(name, 80), rows },
      aria: `${n.path.join(' > ')}: ${fmt(n.value)}${d > 1 ? `, ${c.t('shareOfParentAria', { share: pct(shareParent), parent: n.path[n.path.length - 2] })}` : ''}, ${c.t('shareOfTotalAria', { share: pct(shareTotal) })}`,
      datum: { path: n.path, value: n.value, depth: d },
      ...(n.children.length ? { drill: n.path } : {})
    })
    if (s.labels !== false) {
      const text = n.name
      const am = (a0 + a1) / 2
      const thick = r1 - r0
      const along = (a1 - a0) * mid
      const ink = inkOn(fill)
      const deg = (am * 180) / Math.PI
      const px = cx + mid * Math.cos(am)
      const py = cy + mid * Math.sin(am)
      // Along the ring when the arc is long enough, else along the radius when the ring is wide enough.
      if (along > c.measure(text, c.size - 1) + 8 && thick > c.size + 4 && along > 36) {
        const t = fit(text, along - 8, c.size - 1, c.env.measure)
        const up = Math.sin(am) > 0 ? deg - 90 : deg + 90
        c.marks.push(c.text(px, py, t, { role: 'label', anchor: 'middle', baseline: 'middle', size: c.size - 1, fill: ink, rotate: up }))
      } else if (thick > 32 && along > c.size + 4) {
        const t = fit(text, thick - 8, c.size - 1, c.env.measure)
        if (t !== '…' && t.length > 1) {
          const flip = Math.cos(am) < 0
          c.marks.push(c.text(px, py, t, { role: 'label', anchor: 'middle', baseline: 'middle', size: c.size - 1, fill: ink, rotate: flip ? deg + 180 : deg }))
        }
      }
    }
    let a = a0
    for (const k of n.children) {
      const sweep = n.value ? ((a1 - a0) * k.value) / n.value : 0
      visit(k, n.value, a, a + sweep, d + 1, hex, paint, key)
      a += sweep
    }
  }

  let a = -Math.PI / 2
  const branch = focus ? focus.path[0] : ''
  const bi = firsts.indexOf(branch)
  for (const n of live) {
    const i = focus ? bi : firsts.indexOf(n.name)
    const key = focus ? branch : n.name
    const sweep = span ? (n.value / span) * Math.PI * 2 : 0
    visit(n, focus ? focus.value : total, a, a + sweep, base + 1, c.seriesHex(key, i), series[i].color, key)
    a += sweep
  }
  if (dropped) c.warn('many_nodes', 'path', `Only the first ${MAX_ARCS} arcs were drawn; ${dropped} more were left out.`, 'Use fewer levels in `path`, or filter with `transform`.')
  if (hole > 30 && span > 0) {
    const t = fmt(span)
    const big = c.compact ? 14 : 18
    if (c.measure(t, big, 600) < hole * 1.8) {
      c.marks.push(c.text(cx, cy - 1, t, { role: 'label', anchor: 'middle', baseline: 'alphabetic', size: big, weight: 600, fill: c.c('text') }))
      c.marks.push(c.text(cx, cy + c.size + 2, focus ? fit(focus.name, hole * 1.7, c.size, c.env.measure) : c.t('total'), { role: 'label', anchor: 'middle', baseline: 'alphabetic', fill: c.c('text-muted') }))
    }
  }
  return { series }
}

export const sunburst: ChartDef = {
  type: 'sunburst',
  name: 'Sunburst',
  summary: 'Shows a hierarchy as rings: the first level in the middle ring, each level outside it split by its share of the parent.',
  useWhen: 'Parts of a whole across 2 to 4 levels (region > country > city, department > team), when the nesting matters as much as the sizes. Ring area distorts comparisons; for exact sizes use a treemap or a bar chart. Not for values that can be negative.',
  cartesian: false,
  fields: {
    path: { kind: 'columns', role: 'any', min: 1, max: MAX_LEVELS, required: true, desc: `Columns that form the hierarchy, outermost group first, e.g. ["region","country","city"] (1 to ${MAX_LEVELS} levels). A row whose level is empty stops there and still counts toward its parents.` },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving each row\'s size. Rows on the same path are summed; zero and negative values are skipped.' },
    labels: { kind: 'boolean', default: true, desc: 'Print names on arcs large enough.' },
    focus: focusField('one value per `path` level, e.g. ["Asia","Japan"]')
  },
  example: {
    type: 'sunburst', title: 'Sales by region, country and city', subtitle: 'USD thousands', path: ['region', 'country', 'city'], value: 'sales', format: 'compact',
    data: [
      ['Europe', 'Germany', 'Berlin', 320], ['Europe', 'Germany', 'Munich', 210], ['Europe', 'France', 'Paris', 380], ['Europe', 'France', 'Lyon', 90], ['Europe', 'Spain', 'Madrid', 150],
      ['Asia', 'Japan', 'Tokyo', 460], ['Asia', 'Japan', 'Osaka', 170], ['Asia', 'Taiwan', 'Taipei', 240], ['Asia', 'Taiwan', 'Kaohsiung', 80], ['Asia', 'India', 'Mumbai', 200], ['Asia', 'India', 'Delhi', 160],
      ['Americas', 'USA', 'New York', 410], ['Americas', 'USA', 'Chicago', 190], ['Americas', 'Brazil', 'São Paulo', 170], ['Americas', 'Canada', 'Toronto', 130]
    ].map(([region, country, city, sales]) => ({ region, country, city, sales }))
  },
  check(spec, ctx) {
    const levels = levelsOf(spec)
    const seen = new Set<string>()
    levels.forEach((l, i) => {
      if (seen.has(l)) ctx.issues.push({ severity: 'error', code: 'duplicate_column', path: `path[${i}]`, message: `"${l}" appears twice in path.`, hint: 'Each level of the hierarchy needs its own column.' })
      seen.add(l)
    })
    if (levels.includes(spec.value as string)) ctx.issues.push({ severity: 'warning', code: 'value_in_path', path: 'value', message: `"${spec.value}" is both a level and the value.` })
    let neg = 0
    for (const r of ctx.rows) {
      const v = toNumber(r[spec.value as string])
      if (v !== null && v <= 0) neg++
    }
    if (neg) ctx.issues.push({ severity: 'warning', code: 'negative_slices', path: 'value', message: `${neg} zero or negative value(s) will be skipped; a share cannot be negative.` })
    if (Array.isArray(spec.focus) && spec.focus.length) {
      if (spec.focus.length >= levels.length) ctx.issues.push({ severity: 'warning', code: 'focus_leaf', path: `focus[${spec.focus.length - 1}]`, message: `focus names ${spec.focus.length} level(s) and path has ${levels.length}: the last level has nothing under it to drill into; the whole tree is drawn.`, hint: `Give at most ${levels.length - 1} value(s).` })
      else checkFocus(hierarchy(ctx.rows, levels, spec.value as string).root, spec.focus, ctx.issues)
    }
  },
  compile,
  describe(spec, env) {
    const levels = levelsOf(spec)
    const { root } = hierarchy(spec.data, levels, spec.value)
    const f = formatter(spec, env.locale)
    const pct = (v: number): string => formatPercent(root.value ? v / root.value : 0, env.locale)
    if (!root.children.length) return `${lead(spec, 'Sunburst')} No positive values.`
    let leaves = 0
    let biggest: HierarchyNode | null = null
    const walk = (n: HierarchyNode): void => {
      if (!n.children.length && n !== root) {
        leaves++
        if (!biggest || n.value > biggest.value) biggest = n
      }
      n.children.forEach(walk)
    }
    walk(root)
    const top = root.children.slice(0, 3).map(n => `${clip(n.name, 30)} (${pct(n.value)})`)
    let t = `${lead(spec, 'Sunburst')} ${levels.length} level${levels.length > 1 ? 's' : ''} (${levels.join(' > ')}), ${leaves} leaves totalling ${f(root.value)}. First level: ${root.children.length} groups, largest ${fmtList(top, 3)}.`
    const b = biggest as HierarchyNode | null
    if (b && b.path.length > 1) t += ` Largest leaf: ${clip(b.path.join(' > '), 80)} (${f(b.value)}, ${pct(b.value)}).`
    const fn = focusNode(root, spec.focus)
    if (fn) {
      const share = (v: number): string => formatPercent(fn.value ? v / fn.value : 0, env.locale)
      const kids = fn.children.slice(0, 3).map(n => `${clip(n.name, 30)} (${share(n.value)})`)
      t += ` Showing only ${clip(fn.path.join(' > '), 80)}: ${f(fn.value)}, ${pct(fn.value)} of the total, in ${fn.children.length} group${fn.children.length > 1 ? 's' : ''}, largest ${fmtList(kids, 3)}.`
    }
    return t
  }
}
