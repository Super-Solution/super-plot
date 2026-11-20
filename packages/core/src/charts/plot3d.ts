// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * Non-map 3D charts: `scatter3d` (points in a box) and `surface` (z over a grid of x and y). Core projects every
 * point with the camera of `view3d.ts` and emits ordinary 2D marks, painted back to front, so the SVG and canvas
 * renderers (and the WebGL dot layer) draw the same picture, and the web binding turns the box with the map
 * controls.
 *
 * 3D misleads: depth hides points, positions on screen mix three values, and perspective shrinks what is far.
 * So these charts are safe by default: orthographic projection, exact x, y and z in every tooltip and in the
 * data table, ranges and extremes in the description, a fixed keyboard order (by x, then y), and an `info`
 * issue (`perspective_3d`) that says what to read with care and which 2D chart shows the same data.
 */
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { FieldMap, ValidateCtx } from '../schema.js'
import type { Mark, Rect, SeriesInfo, Tip } from '../scene.js'
import { distinct } from '../data.js'
import { extent, linearTicks, niceDomain, toNumber } from '../util/num.js'
import { clip, fit } from '../util/text.js'
import { tickFormatter } from '../util/format.js'
import { fmtList, formatter, lead, seqLegend, seqScale } from './shared.js'
import { CAMERA3D_LIMITS, makeView3d, project3d, type Projected3d, type Projection3d, type View3d, type View3dInput } from '../view3d.js'
import { DROP_LINES_AUTO, MAX_SURFACE_SIDE, is3dType } from './kinds.js'

type Spec = Record<string, any>
type R = Record<string, unknown>

export { DROP_LINES_AUTO, MAX_SURFACE_SIDE, is3dType }

const FIELDS_3D: FieldMap = {
  projection: { kind: 'enum', values: ['orthographic', 'perspective'], default: 'orthographic', desc: '`orthographic` (default): a size or length on screen does not change with depth. `perspective`: nearer is drawn larger, which reads as depth but makes sizes and distances impossible to compare.' },
  camera: { kind: 'camera', keys: ['zoom', 'pitch', 'bearing'], limits: CAMERA3D_LIMITS, desc: 'Starting view: pitch (0 looks straight down, 90 from the side; default 60), bearing (degrees clockwise; default 35) and zoom (1 fits the box, up to 8). The viewer can drag, use the arrow keys and zoom from there.' },
  xLabel: { kind: 'string', max: 80, desc: 'Title of the x axis (default: the x column).' },
  yLabel: { kind: 'string', max: 80, desc: 'Title of the y axis (default: the y column).' },
  zLabel: { kind: 'string', max: 80, desc: 'Title of the vertical z axis (default: the z column; include the unit).' }
}

// ---- the box: back planes, grid, ticks and titles --------------------------------------------

interface Axis3 {
  lo: number
  hi: number
  title: string
  /** Formats tick labels. */
  tick: (v: number, count: number) => string
}

const toBox = (a: Axis3, v: number): number => (a.hi === a.lo ? 0 : -1 + (2 * (v - a.lo)) / (a.hi - a.lo))
const f1 = (v: number): string => String(Math.round(v * 10) / 10)
const pathOf = (pts: Projected3d[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${f1(p.x)} ${f1(p.y)}`).join('') + 'Z'
type V3 = [number, number, number]

/** Exact numbers for tooltips and aria text: up to 10 decimals, grouped by the locale. */
function exactFormatter(locale: string): (v: number) => string {
  let nf: Intl.NumberFormat
  try { nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 10 }) } catch { nf = new Intl.NumberFormat('en', { maximumFractionDigits: 10 }) }
  return v => nf.format(v)
}

/** The plot area of a 3D chart: the frame less room for tick labels and axis titles round the box. */
const boxArea = (frame: Rect, compact: boolean): Rect => {
  const mx = compact ? 22 : 40, my = compact ? 14 : 22
  return { x: frame.x + mx, y: frame.y + my, w: Math.max(40, frame.w - 2 * mx), h: Math.max(40, frame.h - 2 * my) }
}

/**
 * Draw the parts of the box behind the data: the floor and the two walls that face away from the viewer, each
 * with its grid, then the ticks and titles on the front edges (x and y along the floor, z on a side edge). An
 * edge seen end-on (shorter than 24 px on screen) gets no labels: a straight-down view has no readable z axis.
 */
function drawBox(c: ChartCtx, v: View3d, ax: { x: Axis3; y: Axis3; z: Axis3 }, clipId: string): void {
  const P = (p: V3): Projected3d => project3d(v, p[0], p[1], p[2])
  const push = (m: Mark): void => { c.marks.push({ ...m, clip: clipId }) }
  // The wall of each horizontal axis that is farther from the viewer than the box centre.
  const bx = P([1, 0, 0]).z <= P([-1, 0, 0]).z ? 1 : -1
  const by = P([0, 1, 0]).z <= P([0, -1, 0]).z ? 1 : -1
  const len = (a: V3, b: V3): number => { const p = P(a), q = P(b); return Math.hypot(q.x - p.x, q.y - p.y) }
  const count = (l: number): number => Math.max(3, Math.min(6, Math.round(l / 45)))
  const ticksOf = (a: Axis3, l: number): number[] => (a.hi === a.lo ? [a.lo] : linearTicks(a.lo, a.hi, count(l)).filter(t => t >= a.lo - 1e-9 * Math.abs(a.hi - a.lo) && t <= a.hi + 1e-9 * Math.abs(a.hi - a.lo)))
  const xEdge: [V3, V3] = [[-1, -by, -1], [1, -by, -1]]
  const yEdge: [V3, V3] = [[-bx, -1, -1], [-bx, 1, -1]]
  // z labels on the side edge further left on screen (the other two vertical edges are the nearest and farthest).
  const side: [number, number][] = [[bx, -by], [-bx, by]]
  const zc = side.map(([sx, sy]) => P([sx, sy, -1]).x)
  const [zx, zy] = zc[0] <= zc[1] ? side[0] : side[1]
  const zEdge: [V3, V3] = [[zx, zy, -1], [zx, zy, 1]]
  const lx = len(...xEdge), ly = len(...yEdge), lz = len(...zEdge)
  const tx = ticksOf(ax.x, lx), ty = ticksOf(ax.y, ly), tz = ticksOf(ax.z, lz)
  const X = (t: number): number => toBox(ax.x, t), Y = (t: number): number => toBox(ax.y, t), Z = (t: number): number => toBox(ax.z, t)

  const faces: { corners: V3[]; lines: [V3, V3][] }[] = [
    { corners: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]], lines: [...tx.map(t => [[X(t), -1, -1], [X(t), 1, -1]] as [V3, V3]), ...ty.map(t => [[-1, Y(t), -1], [1, Y(t), -1]] as [V3, V3])] },
    { corners: [[bx, -1, -1], [bx, 1, -1], [bx, 1, 1], [bx, -1, 1]], lines: [...ty.map(t => [[bx, Y(t), -1], [bx, Y(t), 1]] as [V3, V3]), ...tz.map(t => [[bx, -1, Z(t)], [bx, 1, Z(t)]] as [V3, V3])] },
    { corners: [[-1, by, -1], [1, by, -1], [1, by, 1], [-1, by, 1]], lines: [...tx.map(t => [[X(t), by, -1], [X(t), by, 1]] as [V3, V3]), ...tz.map(t => [[-1, by, Z(t)], [1, by, Z(t)]] as [V3, V3])] }
  ]
  for (const face of faces) {
    const pts = face.corners.map(P)
    push({ type: 'path', role: 'background', d: pathOf(pts), fill: c.c('grid'), opacity: 0.55 })
    const grid = face.lines.map(([a, b]) => { const p = P(a), q = P(b); return `M${f1(p.x)} ${f1(p.y)}L${f1(q.x)} ${f1(q.y)}` }).join('')
    if (grid) push({ type: 'path', role: 'grid', d: grid, stroke: c.c('axis'), strokeWidth: 0.6, opacity: 0.8 })
    push({ type: 'path', role: 'axis', d: pathOf(pts), stroke: c.c('axis'), strokeWidth: 1 })
  }

  const tickSize = c.size - 1
  // Screen direction pointing away from the box at an edge; straight down when the edge is seen end-on.
  const outward = (at: V3, away: V3): { dx: number; dy: number } => {
    const p = P(at), q = P([at[0] + away[0] * 0.3, at[1] + away[1] * 0.3, at[2] + away[2] * 0.3])
    const l = Math.hypot(q.x - p.x, q.y - p.y)
    return l < 2 ? { dx: 0, dy: 1 } : { dx: (q.x - p.x) / l, dy: (q.y - p.y) / l }
  }
  const place = (d: { dx: number; dy: number }): { anchor: 'start' | 'middle' | 'end'; baseline: 'alphabetic' | 'middle' | 'hanging' } => ({
    anchor: d.dx > 0.38 ? 'start' : d.dx < -0.38 ? 'end' : 'middle',
    baseline: d.dy > 0.38 ? 'hanging' : d.dy < -0.38 ? 'alphabetic' : 'middle'
  })
  const label = (a: Axis3, edge: [V3, V3], l: number, ticks: number[], at: (t: number) => V3, away: V3): void => {
    if (l < 24) return
    const mid: V3 = [(edge[0][0] + edge[1][0]) / 2, (edge[0][1] + edge[1][1]) / 2, (edge[0][2] + edge[1][2]) / 2]
    const d = outward(mid, away)
    const pos = place(d)
    let widest = 0
    for (const t of ticks) {
      const p = P(at(t))
      const text = a.tick(t, ticks.length)
      widest = Math.max(widest, c.measure(text, tickSize))
      push({ type: 'line', role: 'axis', x1: p.x, y1: p.y, x2: p.x + d.dx * 4, y2: p.y + d.dy * 4, stroke: c.c('axis'), strokeWidth: 1 })
      push(c.text(p.x + d.dx * 8, p.y + d.dy * 8, text, { ...pos, size: tickSize }))
    }
    const gap = 14 + Math.abs(d.dx) * widest + Math.abs(d.dy) * tickSize
    const m = P(mid)
    const title = fit(a.title, 160, c.size, c.measure.bind(c))
    // Keep the title inside the clip (the plot area plus its margin): a side edge near the frame would cut it off.
    // Text width is estimated in core, so leave 15% room for the browser's real font.
    const tw = c.measure(title, c.size) * 1.15 + 2
    const L = Math.max(0, v.rect.x - 40), R = Math.min(c.width, v.rect.x + v.rect.w + 40)
    const lo = L + (pos.anchor === 'end' ? tw : pos.anchor === 'middle' ? tw / 2 : 0)
    const hi = R - (pos.anchor === 'start' ? tw : pos.anchor === 'middle' ? tw / 2 : 0)
    const tx0 = m.x + d.dx * gap
    if (tx0 >= lo && tx0 <= hi) {
      push(c.text(tx0, m.y + d.dy * gap, title, { ...pos, fill: c.c('text'), size: c.size }))
      return
    }
    // No room beside the edge (it runs close to the frame): put the title above the edge's upper end, over its
    // tick labels, the way a vertical axis title sits on top of the axis.
    const ends = [P(edge[0]), P(edge[1])]
    const top = ends[0].y <= ends[1].y ? ends[0] : ends[1]
    const half = tw / 2
    const x = Math.min(R - half, Math.max(L + half, top.x + d.dx * (8 + widest / 2)))
    push(c.text(x, top.y - tickSize - 4, title, { anchor: 'middle', baseline: 'alphabetic', fill: c.c('text'), size: c.size }))
  }
  label(ax.x, xEdge, lx, tx, t => [X(t), -by, -1], [0, -by, 0])
  label(ax.y, yEdge, ly, ty, t => [-bx, Y(t), -1], [-bx, 0, 0])
  label(ax.z, zEdge, lz, tz, t => [zx, zy, Z(t)], [zx, zy, 0])
}

/** The view, the clip of the plot area and the `scene.view3d` payload for a 3D chart. */
function view3dOf(c: ChartCtx, area: Rect): { view: View3d; input: View3dInput; clipId: string } {
  const s = c.spec
  const input: View3dInput = { projection: s.projection as Projection3d, rect: area, camera: { ...(s.camera ?? {}), ...(c.env.camera ?? {}) } }
  const view = makeView3d(input)
  const clipId = 'plot3d'
  c.clips[clipId] = `M${f1(area.x - 40)} ${f1(area.y - 22)}h${f1(area.w + 80)}v${f1(area.h + 44)}h${f1(-area.w - 80)}Z`
  return { view, input: { ...input, camera: view.camera }, clipId }
}

const tickFmt = (format: unknown, locale: string, a: { lo: number; hi: number }) => (t: number, n: number): string => tickFormatter(format as string | undefined, locale, [a.lo, a.hi], n)(t)

function perspectiveNote(spec: Record<string, unknown>, ctx: ValidateCtx, alternative: string): void {
  const persp = spec.projection === 'perspective'
  ctx.issues.push({
    severity: 'info', code: 'perspective_3d', path: 'projection',
    message: persp
      ? 'Perspective draws nearer things larger and farther ones smaller, so sizes and distances on screen do not compare across depth; points can also hide behind others.'
      : 'A 3D chart hides points behind others, and a position on screen mixes all three values: read exact values from the tooltip, the data table or the description.',
    hint: `${persp ? 'Keep the default orthographic projection unless depth matters more than comparison. ' : ''}${alternative}`
  })
}

// ---- scatter3d -------------------------------------------------------------------------------

interface P3 { row: R; x: number; y: number; z: number; s: string; size: number | null; name: string | null; i: number }

function points3d(spec: Spec): P3[] {
  const out: P3[] = []
  ;(spec.data as R[]).forEach((r, i) => {
    const x = toNumber(r[spec.x]), y = toNumber(r[spec.y]), z = toNumber(r[spec.z])
    if (x === null || y === null || z === null) return
    const size = spec.size ? toNumber(r[spec.size]) : null
    if (spec.size && (size === null || size < 0)) return
    out.push({ row: r, x, y, z, s: spec.series ? String(r[spec.series] ?? '') : String(spec.z), size, name: spec.label ? String(r[spec.label] ?? '') : null, i })
  })
  return out
}

const niceAxis = (vals: number[], title: string, format: unknown, locale: string): Axis3 => {
  const ex = extent(vals) ?? [0, 1]
  const [lo, hi] = niceDomain(ex[0], ex[1], 5)
  return { lo, hi, title, tick: tickFmt(format, locale, { lo, hi }) }
}

function scatter3dCompile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const all = points3d(s)
  const keys = s.series ? distinct(all.map(p => p.s)) : []
  const series = c.makeSeries(keys)
  const show = all.filter(p => !c.hidden.has(p.s))
  const frame = c.frame({ series, autoSide: 'top' })
  // The box spans every point, hidden series included, so toggling a series does not rescale it.
  const ax = {
    x: niceAxis(all.map(p => p.x), s.xLabel ?? String(s.x), undefined, c.locale),
    y: niceAxis(all.map(p => p.y), s.yLabel ?? String(s.y), undefined, c.locale),
    z: niceAxis(all.map(p => p.z), s.zLabel ?? String(s.z), s.format, c.locale)
  }
  const { view, input, clipId } = view3dOf(c, boxArea(frame, c.compact))
  drawBox(c, view, ax, clipId)

  const dense = show.length > DROP_LINES_AUTO
  const drops = s.dropLines === true || (s.dropLines !== false && !dense)
  if (dense && s.dropLines === undefined) c.warn('drop_lines_dense', 'dropLines', `Drop lines are left out above ${DROP_LINES_AUTO} visible points: they would cover the data.`, 'Set dropLines: true to draw them anyway.')
  const sizes = extent(show.map(p => p.size).filter((v): v is number => v !== null))
  const exact = exactFormatter(c.locale)
  const zf = s.format ? c.format : exact
  const color = (p: P3): string => (s.series ? series[keys.indexOf(p.s)].color : c.seriesColor(String(s.z), 0))
  const placed = show.map(p => ({ p, q: project3d(view, toBox(ax.x, p.x), toBox(ax.y, p.y), toBox(ax.z, p.z)) }))
  // Painter's order: far first; ties keep the data order, so the same spec always gives the same scene.
  placed.sort((a, b) => a.q.z - b.q.z || a.p.i - b.p.i)
  if (drops) {
    // All drop lines before any point: a line never hides a point.
    for (const { p, q } of placed) {
      const f = project3d(view, toBox(ax.x, p.x), toBox(ax.y, p.y), -1)
      const col = color(p)
      c.marks.push({ type: 'line', role: 'grid', x1: f.x, y1: f.y, x2: q.x, y2: q.y, stroke: col, strokeWidth: 1, opacity: 0.4, series: p.s, clip: clipId })
      c.marks.push({ type: 'circle', role: 'grid', cx: f.x, cy: f.y, r: 1.8 * f.k, fill: col, opacity: 0.45, series: p.s, clip: clipId })
    }
  }
  const marks = new Map<P3, number>()
  for (const { p, q } of placed) {
    const r0 = p.size === null || !sizes ? (dense ? 2.5 : 4.5) : 3 + 9 * Math.sqrt(sizes[1] === 0 ? 1 : p.size / sizes[1])
    const fill = color(p)
    const tip: Tip = {
      ...(p.name ? { title: clip(p.name, 60) } : s.series ? { title: clip(p.s, 60) } : {}),
      rows: [
        { label: String(s.x), value: exact(p.x) },
        { label: String(s.y), value: exact(p.y) },
        { label: String(s.z), value: zf(p.z), color: fill },
        ...(s.size && p.size !== null ? [{ label: String(s.size), value: exact(p.size) }] : []),
        ...(s.series && p.name ? [{ label: String(s.series), value: clip(p.s, 40) }] : [])
      ]
    }
    const aria = `${p.name ? `${clip(p.name, 60)}: ` : ''}${s.x} ${exact(p.x)}, ${s.y} ${exact(p.y)}, ${s.z} ${zf(p.z)}${s.size && p.size !== null ? `, ${s.size} ${exact(p.size)}` : ''}${s.series ? ` (${clip(p.s, 40)})` : ''}`
    marks.set(p, c.marks.length)
    c.marks.push({
      type: 'circle', role: 'data', cx: q.x, cy: q.y, r: r0 * q.k, fill, opacity: p.size !== null ? 0.75 : 0.9,
      ...(dense ? {} : { stroke: c.c('background'), strokeWidth: 1 }), tip, aria, anim: 'fade', series: p.s, clip: clipId,
      datum: { x: p.x, y: p.y, z: p.z, ...(p.size !== null ? { size: p.size } : {}), ...(s.series ? { series: p.s } : {}), ...(p.name !== null ? { label: p.name } : {}) },
      rows: c.rowsOf([p.row])
    })
  }
  const order = [...show].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z || a.i - b.i).map(p => marks.get(p)!)
  c.view3d = { view, input, order }
  return { series }
}

export const scatter3d: ChartDef = {
  type: 'scatter3d',
  name: '3D scatter plot',
  summary: 'Places each row as a point in a box by three numbers (x, y and the vertical z), with drop lines to the floor; the viewer turns the box.',
  useWhen: 'Exploring how three measures relate when all three matter at once (clusters in three dimensions). Depth hides points and positions on screen mix all three values, so for comparison a 2D scatter of two measures (colour or size for the third) or small multiples read better. Exact values are in the tooltip and the data table.',
  cartesian: false,
  ref: { x: ['x'], y: ['y'], series: 'series' },
  fields: {
    x: { kind: 'column', role: 'number', required: true, desc: 'Numeric column for x (left to right on the floor).' },
    y: { kind: 'column', role: 'number', required: true, desc: 'Numeric column for y (front to back on the floor).' },
    z: { kind: 'column', role: 'number', required: true, desc: 'Numeric column for z (height).' },
    series: { kind: 'column', role: 'any', desc: 'Column that colours points by group (with a legend).' },
    size: { kind: 'column', role: 'number', desc: 'Numeric column mapped to point area (negative values are skipped).' },
    label: { kind: 'column', role: 'any', desc: 'Column used as each point\'s name in the tooltip.' },
    dropLines: { kind: 'boolean', desc: `Default true (off above ${DROP_LINES_AUTO} visible points, with a warning). A thin line from each point down to the floor, and a dot where it lands: it shows where the point sits in x and y, which depth alone cannot.` },
    ...FIELDS_3D
  },
  example: {
    type: 'scatter3d', title: 'Three clusters in three measures', subtitle: 'Invented measurements; drag to turn the box', x: 'width', y: 'depth', z: 'height', series: 'kind', label: 'id',
    xLabel: 'Width (mm)', yLabel: 'Depth (mm)', zLabel: 'Height (mm)',
    data: (['A', 'B', 'C'] as const).flatMap((kind, g) => Array.from({ length: 9 }, (_, i) => ({
      id: `${kind}${i + 1}`, kind: `Kind ${kind}`,
      width: Math.round((20 + g * 14 + 6 * Math.sin(i * 1.7 + g)) * 10) / 10,
      depth: Math.round((30 + (g === 1 ? 18 : g * 4) + 6 * Math.cos(i * 2.3 + g * 2)) * 10) / 10,
      height: Math.round((12 + g * 9 + 5 * Math.sin(i * 0.9 + g * 3)) * 10) / 10
    })))
  },
  check(spec, ctx) {
    perspectiveNote(spec, ctx, 'For exact comparison show two of the measures in a scatter plot (colour or size for the third), or small multiples.')
    if (ctx.issues.some(i => i.severity === 'error')) return
    const rows = ctx.rows
    if (spec.size) {
      let neg = 0
      for (const r of rows) { const v = toNumber(r[spec.size as string]); if (v !== null && v < 0) neg++ }
      if (neg) ctx.issues.push({ severity: 'warning', code: 'negative_skipped', path: 'size', message: `${neg} rows have a negative size and are skipped: an area cannot be negative.` })
    }
    const n = points3d({ ...spec, data: rows }).length
    if (!n) ctx.issues.push({ severity: 'error', code: 'no_points', path: 'data', message: 'No row has a numeric x, y and z (and size, when set).' })
    else if (n < rows.length) ctx.issues.push({ severity: 'warning', code: 'incomplete_rows', path: 'data', message: `${rows.length - n} of ${rows.length} rows lack a numeric x, y or z${spec.size ? ' (or a size)' : ''} and are left out.` })
  },
  compile: scatter3dCompile,
  describe(spec, env) {
    const pts = points3d(spec)
    // `format` is for z, as on the axes and in the tooltips; x and y are given exactly.
    const f = formatter(spec, env.locale), e = exactFormatter(env.locale)
    if (!pts.length) return `${lead(spec, '3D scatter plot')} No points.`
    const groups = spec.series ? distinct(pts.map(p => p.s)) : []
    const ex = (k: 'x' | 'y' | 'z'): [number, number] => extent(pts.map(p => p[k]))!
    const [x, y, z] = [ex('x'), ex('y'), ex('z')]
    const top = pts.reduce((a, b) => (b.z > a.z ? b : a))
    const low = pts.reduce((a, b) => (b.z < a.z ? b : a))
    const at = (p: P3): string => `${p.name ? `${clip(p.name, 40)}, ` : ''}${spec.x} ${e(p.x)}, ${spec.y} ${e(p.y)}`
    return `${lead(spec, '3D scatter plot')} ${pts.length} points of ${spec.z} against ${spec.x} and ${spec.y}${spec.size ? `, sized by ${spec.size}` : ''}${groups.length > 1 ? `, in ${groups.length} groups (${fmtList(groups)})` : ''}. ${spec.x} ranges from ${e(x[0])} to ${e(x[1])}, ${spec.y} from ${e(y[0])} to ${e(y[1])} and ${spec.z} from ${f(z[0])} to ${f(z[1])}. Highest ${spec.z}: ${f(top.z)} (${at(top)}). Lowest: ${f(low.z)} (${at(low)}).`
  }
}

// ---- surface ---------------------------------------------------------------------------------

interface Grid {
  xs: number[]
  ys: number[]
  /** `${xi},${yi}` to the first z given for that cell. */
  cells: Map<string, number>
  /** Rows that repeat a cell already given. */
  repeats: number
  /** Cells of the full grid that have no value, in x then y order. */
  missing: [number, number][]
}

function gridOf(spec: Spec): Grid {
  const rows: [number, number, number][] = []
  for (const r of spec.data as R[]) {
    const x = toNumber(r[spec.x]), y = toNumber(r[spec.y]), z = toNumber(r[spec.z])
    if (x !== null && y !== null && z !== null) rows.push([x, y, z])
  }
  const xs = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b)
  const ys = [...new Set(rows.map(r => r[1]))].sort((a, b) => a - b)
  const xi = new Map(xs.map((v, i) => [v, i]))
  const yi = new Map(ys.map((v, i) => [v, i]))
  const cells = new Map<string, number>()
  let repeats = 0
  for (const [x, y, z] of rows) {
    const k = `${xi.get(x)},${yi.get(y)}`
    if (cells.has(k)) repeats++
    else cells.set(k, z)
  }
  const missing: [number, number][] = []
  if (xs.length <= MAX_SURFACE_SIDE && ys.length <= MAX_SURFACE_SIDE) {
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) if (!cells.has(`${i},${j}`)) missing.push([xs[i], ys[j]])
  }
  return { xs, ys, cells, repeats, missing }
}

function surfaceCompile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const g = gridOf(s)
  const zs = [...g.cells.values()]
  const zex = extent(zs) ?? [0, 1]
  const dom = s.domain as [number | null, number | null] | undefined
  const lo = dom?.[0] ?? zex[0]
  const hi = dom?.[1] ?? zex[1]
  const colorOf = seqScale(c, lo, hi)
  const frame = c.frame({ series: [] })
  const barW = 64
  const area = boxArea({ ...frame, w: frame.w - barW }, c.compact)
  const [zlo, zhi] = niceDomain(zex[0], zex[1], 5)
  const ax = {
    x: { lo: g.xs[0], hi: g.xs[g.xs.length - 1], title: s.xLabel ?? String(s.x), tick: tickFmt(undefined, c.locale, { lo: g.xs[0], hi: g.xs[g.xs.length - 1] }) },
    y: { lo: g.ys[0], hi: g.ys[g.ys.length - 1], title: s.yLabel ?? String(s.y), tick: tickFmt(undefined, c.locale, { lo: g.ys[0], hi: g.ys[g.ys.length - 1] }) },
    z: { lo: zlo, hi: zhi, title: s.zLabel ?? String(s.z), tick: tickFmt(s.format, c.locale, { lo: zlo, hi: zhi }) }
  }
  const { view, input, clipId } = view3dOf(c, area)
  drawBox(c, view, ax, clipId)

  const nx = g.xs.length, ny = g.ys.length
  const zAt = (i: number, j: number): number | undefined => g.cells.get(`${i},${j}`)
  // A point of the mesh in half-cell steps (a = 2i is the column of x[i]): the mean of the cells around it.
  const vertex = (a: number, b: number): Projected3d => {
    const is = [Math.floor(a / 2), Math.ceil(a / 2)], js = [Math.floor(b / 2), Math.ceil(b / 2)]
    let sum = 0, n = 0
    for (const i of new Set(is)) for (const j of new Set(js)) { const z = zAt(i, j); if (z !== undefined) { sum += z; n++ } }
    const x = (g.xs[is[0]] + g.xs[is[1]]) / 2, y = (g.ys[js[0]] + g.ys[js[1]]) / 2
    return project3d(view, toBox(ax.x, x), toBox(ax.y, y), toBox(ax.z, sum / n))
  }
  const ring: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
  const exact = exactFormatter(c.locale)
  const zf = s.format ? c.format : exact
  const mesh = s.mesh !== false
  // The rows behind each grid point (\`Mark.rows\`).
  const atPoint = new Map<string, R[]>()
  for (const r of s.data as R[]) {
    const k = `${toNumber(r[s.x])},${toNumber(r[s.y])}`
    atPoint.set(k, [...(atPoint.get(k) ?? []), r])
  }
  const tiles: { i: number; j: number; z: number; depth: number }[] = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const z = zAt(i, j)
    if (z === undefined) continue
    tiles.push({ i, j, z, depth: project3d(view, toBox(ax.x, g.xs[i]), toBox(ax.y, g.ys[j]), toBox(ax.z, z)).z })
  }
  tiles.sort((a, b) => a.depth - b.depth || a.i - b.i || a.j - b.j)
  const index = new Map<string, number>()
  for (const t of tiles) {
    // Each tile is centred on its grid point and reaches halfway to the neighbours (half a tile at the edges).
    const keys: string[] = []
    const corners: [number, number][] = []
    for (const [da, db] of ring) {
      const a = Math.max(0, Math.min(2 * (nx - 1), 2 * t.i + da)), b = Math.max(0, Math.min(2 * (ny - 1), 2 * t.j + db))
      const key = `${a},${b}`
      // At the grid's edge neighbouring offsets clamp to the same point: keep it once.
      if (key === keys[keys.length - 1] || (key === keys[0] && corners.length === ring.length - 1)) continue
      keys.push(key)
      corners.push([a, b])
    }
    const pts = corners.map(([a, b]) => vertex(a, b))
    const fill = colorOf(t.z)
    const x = g.xs[t.i], y = g.ys[t.j]
    const own = c.rowsOf(atPoint.get(`${x},${y}`) ?? [])
    index.set(`${t.i},${t.j}`, c.marks.length)
    c.marks.push({
      type: 'path', role: 'data', d: pathOf(pts), fill, stroke: mesh ? c.c('background') : fill, strokeWidth: mesh ? 0.6 : 0.5, anim: 'fade', clip: clipId,
      tip: { rows: [{ label: String(s.x), value: exact(x) }, { label: String(s.y), value: exact(y) }, { label: String(s.z), value: zf(t.z), color: fill }] },
      aria: `${s.x} ${exact(x)}, ${s.y} ${exact(y)}: ${s.z} ${zf(t.z)}`, datum: { x, y, z: t.z },
      rows: own
    })
  }
  // The colour key: the value scale of heatmaps, labelled with the z column. It sits at the bottom right, so the
  // web binding's turn and zoom buttons (top right) never cover its title.
  const h = Math.max(30, Math.min(area.h - 24, 160))
  const lx = frame.x + frame.w - barW + 22
  const ly = area.y + area.h - h
  seqLegend(c, lx, ly, h, lo, hi)
  c.marks.push(c.text(lx, ly - 10, fit(String(s.zLabel ?? s.z), barW + 10, c.size - 1, c.measure.bind(c)), { role: 'legend', size: c.size - 1 }))
  const order: number[] = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const k = index.get(`${i},${j}`); if (k !== undefined) order.push(k) }
  c.view3d = { view, input, order }
  return { series: [] }
}

export const surface: ChartDef = {
  type: 'surface',
  name: 'Surface',
  summary: 'Draws z over a regular grid of x and y as a coloured surface in a box (colour is the z value, with a key); the viewer turns it.',
  useWhen: 'Showing the shape of a function of two numbers (a response surface, a terrain, a fitted model) where peaks, valleys and saddles matter more than exact values. Give one row per grid point. Depth hides parts of the surface: for exact reading a heatmap of the same grid is clearer. Exact values are in the tooltip and the data table.',
  cartesian: false,
  ref: { x: ['x'], y: ['y'], yRow: true },
  fields: {
    x: { kind: 'column', role: 'number', required: true, desc: `Numeric column for x: the grid's columns (at most ${MAX_SURFACE_SIDE} distinct values).` },
    y: { kind: 'column', role: 'number', required: true, desc: `Numeric column for y: the grid's rows (at most ${MAX_SURFACE_SIDE} distinct values).` },
    z: { kind: 'column', role: 'number', required: true, desc: 'Numeric column for the height at each (x, y). Missing grid points are drawn as holes; repeated ones keep the first value.' },
    mesh: { kind: 'boolean', default: true, desc: 'Outline each grid cell, which helps the eye follow the shape.' },
    domain: { kind: 'domain', desc: 'Fix the colour range, e.g. [0, 100], to compare surfaces.' },
    ...FIELDS_3D
  },
  example: {
    type: 'surface', title: 'Yield by temperature and pressure', subtitle: 'Invented response surface; drag to turn', x: 'temp', y: 'pressure', z: 'yield',
    xLabel: 'Temperature (°C)', yLabel: 'Pressure (bar)', zLabel: 'Yield (%)', format: 'fixed:1',
    data: Array.from({ length: 13 }, (_, i) => 14 + i * 1.5).flatMap(temp => Array.from({ length: 11 }, (_, j) => 1 + j * 0.8).map(pressure => ({
      temp, pressure: Math.round(pressure * 10) / 10,
      yield: Math.round((82 - 0.22 * (temp - 22) ** 2 - 1.5 * (pressure - 5) ** 2 + 0.2 * (temp - 22) * (pressure - 5)) * 10) / 10
    })))
  },
  check(spec, ctx) {
    perspectiveNote(spec, ctx, 'For exact reading, a heatmap of z over x and y shows the same grid without depth.')
    if (ctx.issues.some(i => i.severity === 'error')) return
    const g = gridOf({ ...spec, data: ctx.rows })
    if (!g.cells.size) { ctx.issues.push({ severity: 'error', code: 'no_points', path: 'data', message: 'No row has a numeric x, y and z.' }); return }
    for (const [k, n] of [['x', g.xs.length], ['y', g.ys.length]] as const) {
      if (n < 2) ctx.issues.push({ severity: 'error', code: 'grid_too_small', path: k, message: `"${spec[k]}" has ${n} distinct value${n === 1 ? '' : 's'}; a surface needs at least 2 for x and 2 for y.`, hint: 'For one row of values use a line chart.' })
      else if (n > MAX_SURFACE_SIDE) ctx.issues.push({ severity: 'error', code: 'grid_too_large', path: k, message: `"${spec[k]}" has ${n} distinct values; a surface takes at most ${MAX_SURFACE_SIDE} (a ${MAX_SURFACE_SIDE} x ${MAX_SURFACE_SIDE} grid).`, hint: `Round or bin ${k} first (a bin step, then aggregate the mean of z per bin), or draw the rows as a scatter3d.` })
    }
    if (ctx.issues.some(i => i.severity === 'error')) return
    if (g.repeats) ctx.issues.push({ severity: 'warning', code: 'duplicate_cells', path: 'data', message: `${g.repeats} rows repeat an (x, y) point already given; the first value is drawn.`, hint: 'Aggregate first (for example the mean of z per x and y) if the repeats are measurements to combine.' })
    if (g.missing.length) {
      const total = g.xs.length * g.ys.length
      const sparse = g.cells.size < total / 2
      ctx.issues.push({
        severity: 'warning', code: 'missing_cells', path: 'data',
        message: `${g.missing.length} of ${total} grid points (${g.xs.length} x by ${g.ys.length} y) have no z value and are drawn as holes, e.g. ${fmtList(g.missing.slice(0, 3).map(([x, y]) => `(${x}, ${y})`), 3)}.`,
        hint: sparse ? 'Most of the grid is empty: this looks like scattered points rather than a grid. Use scatter3d, or bin x and y.' : 'Give one row for every combination of the x and y values to close the holes.'
      })
    }
  },
  compile: surfaceCompile,
  describe(spec, env) {
    const g = gridOf(spec)
    // `format` is for z, as on the axes and in the tooltips; x and y are given exactly.
    const f = formatter(spec, env.locale), e = exactFormatter(env.locale)
    if (!g.cells.size) return `${lead(spec, 'Surface')} No values.`
    let top: [number, number, number] | null = null, low: [number, number, number] | null = null
    for (let i = 0; i < g.xs.length; i++) for (let j = 0; j < g.ys.length; j++) {
      const z = g.cells.get(`${i},${j}`)
      if (z === undefined) continue
      if (!top || z > top[2]) top = [g.xs[i], g.ys[j], z]
      if (!low || z < low[2]) low = [g.xs[i], g.ys[j], z]
    }
    const total = g.xs.length * g.ys.length
    const at = (p: [number, number, number]): string => `${spec.x} ${e(p[0])}, ${spec.y} ${e(p[1])}`
    return `${lead(spec, 'Surface')} ${spec.z} over a grid of ${g.xs.length} ${spec.x} by ${g.ys.length} ${spec.y} values${g.cells.size < total ? ` (${total - g.cells.size} of ${total} points missing)` : ''}, coloured by ${spec.z}. ${spec.x} ranges from ${e(g.xs[0])} to ${e(g.xs[g.xs.length - 1])} and ${spec.y} from ${e(g.ys[0])} to ${e(g.ys[g.ys.length - 1])}. Highest ${spec.z}: ${f(top![2])} at ${at(top!)}. Lowest: ${f(low![2])} at ${at(low!)}.`
  }
}

