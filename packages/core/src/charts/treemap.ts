import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { distinct } from '../data.js'
import { formatPercent } from '../util/format.js'
import { inkOn, mix } from '../util/color.js'
import { toNumber } from '../util/num.js'
import { tokenValue } from '../theme.js'
import { clip, fit } from '../util/text.js'
import { fmtList, formatter, lead } from './shared.js'

const MAX_TILES = 150

interface Tile { label: string; group: string; value: number }
interface Box { x: number; y: number; w: number; h: number }

function tiles(spec: Record<string, any>): Tile[] {
  const sums = new Map<string, Tile>()
  for (const r of spec.data as Record<string, unknown>[]) {
    const v = toNumber(r[spec.value])
    if (v === null || v <= 0) continue
    const group = spec.group ? String(r[spec.group] ?? '') : ''
    const label = String(r[spec.label] ?? '')
    const k = `${group}\u0000${label}`
    const t = sums.get(k)
    if (t) t.value += v
    else sums.set(k, { label, group, value: v })
  }
  return [...sums.values()]
}

/** Squarified treemap (Bruls et al.): rows of items laid along the short side, keeping tiles near square. */
export function squarify<T extends { value: number }>(items: T[], box: Box): { item: T; box: Box }[] {
  const out: { item: T; box: Box }[] = []
  const sorted = [...items].filter(i => i.value > 0).sort((a, b) => b.value - a.value)
  const total = sorted.reduce((q, i) => q + i.value, 0)
  if (!total || box.w <= 0 || box.h <= 0) return out
  const scale = (box.w * box.h) / total
  let { x, y, w, h } = box
  let i = 0
  const worst = (row: number[], side: number): number => {
    const sum = row.reduce((q, v) => q + v, 0)
    const max = Math.max(...row)
    const min = Math.min(...row)
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }
  while (i < sorted.length) {
    const side = Math.min(w, h)
    const row: number[] = []
    let j = i
    while (j < sorted.length) {
      const next = [...row, sorted[j].value * scale]
      if (row.length && worst(next, side) > worst(row, side)) break
      row.push(sorted[j].value * scale)
      j++
    }
    const sum = row.reduce((q, v) => q + v, 0)
    const thick = sum / side
    let off = 0
    for (let k = 0; k < row.length; k++) {
      const len = row[k] / thick
      const b: Box = w >= h ? { x, y: y + off, w: thick, h: len } : { x: x + off, y, w: len, h: thick }
      out.push({ item: sorted[i + k], box: b })
      off += len
    }
    if (w >= h) { x += thick; w -= thick } else { y += thick; h -= thick }
    i = j
  }
  return out
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  let all = tiles(s)
  if (all.length > MAX_TILES) {
    const keep = [...all].sort((a, b) => b.value - a.value)
    const rest = keep.slice(MAX_TILES - 1)
    all = [...keep.slice(0, MAX_TILES - 1), { label: c.t('other'), group: s.group ? c.t('other') : '', value: rest.reduce((q, t) => q + t.value, 0) }]
    c.warn('many_tiles', 'data', `More than ${MAX_TILES} tiles: the smallest were merged into "Other".`)
  }
  const grouped = Boolean(s.group)
  const groups = grouped ? distinct(all.map(t => t.group)) : []
  const series = grouped ? c.makeSeries(groups) : []
  const live = all.filter(t => !grouped || !c.hidden.has(t.group))
  const frame = c.frame({ series })
  const total = live.reduce((q, t) => q + t.value, 0)
  const bg = tokenValue(c.theme, 'background')
  const gap = c.theme.gap
  const fmt = c.format
  const low = tokenValue(c.theme, 'seq-low')
  const high = tokenValue(c.theme, 'seq-high')
  const maxV = Math.max(...live.map(t => t.value), 1)

  const draw = (t: Tile, b: Box, fill: string, rank?: string): void => {
    const w = b.w - gap
    const h = b.h - gap
    if (w < 2 || h < 2) return
    const share = total ? t.value / total : 0
    c.marks.push({
      type: 'rect', role: 'data', series: grouped ? t.group : undefined, x: b.x + gap / 2, y: b.y + gap / 2, w, h, r: Math.min(3, w / 4, h / 4), fill, anim: 'fade',
      tip: { title: clip(t.label, 60), rows: [...(grouped ? [{ label: String(s.group), value: clip(t.group, 40) }] : []), { label: String(s.value), value: fmt(t.value), color: fill }, { label: c.t('share'), value: formatPercent(share, c.locale) }] },
      aria: `${t.label}${grouped ? ` (${t.group})` : ''}: ${fmt(t.value)}, ${formatPercent(share, c.locale)}`, datum: { label: t.label, group: grouped ? t.group : undefined, value: t.value }
    })
    const pad = 6
    if (s.labels !== false && w > 38 && h > c.size + 8) {
      const ink = inkOn(fill)
      c.marks.push(c.text(b.x + gap / 2 + pad, b.y + gap / 2 + pad, fit(t.label, w - pad * 2, c.size, c.env.measure, 600), { role: 'label', baseline: 'hanging', weight: 600, fill: ink }))
      const vt = fmt(t.value)
      if (h > c.size * 2 + 12 && w > c.measure(vt, c.size - 1) + pad * 2) c.marks.push(c.text(b.x + gap / 2 + pad, b.y + gap / 2 + pad + c.size + 3, vt, { role: 'label', baseline: 'hanging', size: c.size - 1, fill: ink, opacity: 0.85 }))
    }
    void rank
  }

  if (grouped) {
    const gs = groups.filter(g => !c.hidden.has(g)).map(g => ({ g, value: live.filter(t => t.group === g).reduce((q, t) => q + t.value, 0) }))
    for (const { item, box } of squarify(gs, frame)) {
      const idx = groups.indexOf(item.g)
      const hex = c.seriesHex(item.g, idx)
      const kids = live.filter(t => t.group === item.g).sort((a, b) => b.value - a.value)
      squarify(kids, { x: box.x, y: box.y, w: box.w, h: box.h }).forEach(({ item: t, box: b }, rank, arr) => {
        // Biggest tile in a group is the full group colour; smaller ones fade toward the surface.
        const fill = mix(hex, bg, arr.length > 1 ? (rank / (arr.length - 1)) * 0.38 : 0)
        draw(t, b, fill)
      })
    }
  } else {
    for (const { item, box } of squarify(live, frame)) {
      draw(item, box, mix(low, high, 0.25 + 0.75 * Math.sqrt(item.value / maxV)))
    }
  }
  return { series }
}

export const treemap: ChartDef = {
  type: 'treemap',
  name: 'Treemap',
  summary: 'Shows parts of a whole as nested rectangles whose area is the value; an optional group splits it into coloured blocks.',
  useWhen: 'Many parts (10-100) of one whole where size ranking matters more than exact values, with an optional one-level grouping (sector > company, region > product). Not for few parts (use a bar or pie) or for values that can be negative.',
  cartesian: false,
  fields: {
    label: { kind: 'column', role: 'any', required: true, desc: 'Column naming each tile.' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving each tile\'s area. Rows with the same group and label are summed; zero and negative values are skipped.' },
    group: { kind: 'column', role: 'any', desc: 'Optional column that groups tiles into coloured blocks (one level). Each group becomes a legend entry.' },
    labels: { kind: 'boolean', default: true, desc: 'Print the name and value on tiles large enough.' }
  },
  example: {
    type: 'treemap', title: 'Revenue by product', subtitle: 'USD millions, grouped by line', label: 'product', value: 'revenue', group: 'line', format: 'compact',
    data: [
      { line: 'Cloud', product: 'Compute', revenue: 420 }, { line: 'Cloud', product: 'Storage', revenue: 260 }, { line: 'Cloud', product: 'Network', revenue: 110 },
      { line: 'Apps', product: 'Mail', revenue: 190 }, { line: 'Apps', product: 'Docs', revenue: 150 }, { line: 'Apps', product: 'Chat', revenue: 90 },
      { line: 'Services', product: 'Support', revenue: 160 }, { line: 'Services', product: 'Consulting', revenue: 120 }, { line: 'Devices', product: 'Hubs', revenue: 70 }
    ]
  },
  check(spec, ctx) {
    let neg = 0
    for (const r of ctx.rows) { const v = r[spec.value as string]; if (typeof v === 'number' && v <= 0) neg++ }
    if (neg) ctx.issues.push({ severity: 'warning', code: 'negative_slices', path: 'value', message: `${neg} zero or negative value(s) will be skipped; area cannot be negative.` })
    if (spec.group && spec.group === spec.label) ctx.issues.push({ severity: 'warning', code: 'redundant_group', path: 'group', message: '`group` is the same column as `label`.' })
  },
  compile,
  describe(spec, env) {
    const ts = tiles(spec)
    const f = formatter(spec, env.locale)
    const total = ts.reduce((q, t) => q + t.value, 0)
    if (!ts.length) return `${lead(spec, 'Treemap')} No positive values.`
    const groups = spec.group ? distinct(ts.map(t => t.group)) : []
    let t = `${lead(spec, 'Treemap')} ${ts.length} tiles totalling ${f(total)}${groups.length ? ` in ${groups.length} groups (${fmtList(groups)})` : ''}.`
    const sorted = [...ts].sort((a, b) => b.value - a.value)
    t += ` Largest: ${clip(sorted[0].label, 40)} (${formatPercent(sorted[0].value / total, env.locale)}).`
    if (groups.length) {
      const gs = groups.map(g => ({ g, v: ts.filter(x => x.group === g).reduce((q, x) => q + x.value, 0) })).sort((a, b) => b.v - a.v)
      t += ` Largest group: ${clip(gs[0].g, 40)} (${formatPercent(gs[0].v / total, env.locale)}).`
    }
    return t
  }
}
