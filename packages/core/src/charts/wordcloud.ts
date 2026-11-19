// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, SeriesInfo } from '../scene.js'
import type { Row, ValidateCtx } from '../schema.js'
import { distinct } from '../data.js'
import { mix } from '../util/color.js'
import { tokenValue } from '../theme.js'
import { toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { fmtList, formatter, lead } from './shared.js'

/** Limits of a word cloud: words drawn at most, the font size floor and ceiling (px). */
export const CLOUD_LIMITS = { maxWords: 150, minFont: 10, maxFont: 64 } as const

/** cos(5k degrees) x 10000, rounded, for k = 0..18: the spiral's only trigonometry (see {@link cloudLayout}). */
export const CLOUD_COS = [10000, 9962, 9848, 9659, 9397, 9063, 8660, 8192, 7660, 7071, 6428, 5736, 5000, 4226, 3420, 2588, 1736, 872, 0] as const

/** Radial growth of the spiral, in pixels per turn. */
export const CLOUD_SPACING = 4

export interface CloudWord {
  text: string
  /** Font size in whole pixels. */
  size: number
  /** Turned 90 degrees (reads bottom to top). */
  rotate?: boolean
}

/** A placed word's box, in whole pixels from the top left of the layout area (padding included). */
export interface CloudBox { x: number; y: number; w: number; h: number; rotate: boolean }

/** cos(5k degrees) x 10000 for any integer k, from the quarter table. */
const cos5 = (k: number): number => {
  const q = ((k % 72) + 72) % 72
  if (q <= 18) return CLOUD_COS[q]
  if (q <= 36) return -CLOUD_COS[36 - q]
  if (q <= 54) return -CLOUD_COS[q - 36]
  return CLOUD_COS[72 - q]
}

/** n / d rounded half away from zero, for integers with d > 0. */
const divRound = (n: number, d: number): number => (n < 0 ? -Math.floor((-2 * n + d) / (2 * d)) : Math.floor((2 * n + d) / (2 * d)))

/**
 * Place words (largest first) on an Archimedean spiral without overlap. Everything is integer arithmetic, so
 * another language reproduces it exactly given the same widths:
 *
 * 1. `W = floor(width)`, `H = floor(height)`. Each word's box is `w = ceil(measure(text, size)) + 2` by
 *    `h = size + floor((size + 4) / 5) + 2` (1 px of padding on every side); a rotated word swaps `w` and `h`.
 * 2. Words are placed in the given order. For step `t = 0, 1, 2, ...` up to `floor(72 * H / CLOUD_SPACING)`,
 *    with `k = t mod 72` (5 degree steps, 72 per turn) and `cos5(k)` from {@link CLOUD_COS} (`sin5(k) = cos5(k - 18)`):
 *    `dx = divRound(CLOUD_SPACING * t * cos5(k) * W, 72 * 10000 * H)` (the spiral is stretched to the area's
 *    aspect) and `dy = divRound(CLOUD_SPACING * t * sin5(k), 72 * 10000)`, where `divRound` rounds half away
 *    from zero. The box's top left is `x = floor(W / 2) + dx - floor(w / 2)`, `y = floor(H / 2) + dy - floor(h / 2)`.
 * 3. The first step whose box lies inside `[0, W] x [0, H]` and overlaps no placed box (boxes that only touch
 *    do not overlap) places the word. A word with no such step is left out (`null`) and the next word is tried.
 *
 * `measure(text, size)` is the renderer's text width: core's `estimateWidth` on a server, a canvas measurement
 * in the browser. The two differ by a few pixels, so a server SVG and the browser can place words differently.
 */
export function cloudLayout(words: readonly CloudWord[], width: number, height: number, measure: (text: string, size: number) => number): (CloudBox | null)[] {
  const W = Math.floor(width)
  const H = Math.floor(height)
  const placed: CloudBox[] = []
  // A 32 px grid of placed boxes, only to find candidates faster; the result is the same as checking them all.
  const CELL = 32
  const grid = new Map<number, number[]>()
  const cells = (b: CloudBox, f: (key: number) => void): void => {
    for (let gx = Math.floor(b.x / CELL); gx <= Math.floor((b.x + b.w - 1) / CELL); gx++) {
      for (let gy = Math.floor(b.y / CELL); gy <= Math.floor((b.y + b.h - 1) / CELL); gy++) f(gx * 65536 + gy)
    }
  }
  const hits = (b: CloudBox): boolean => {
    let hit = false
    cells(b, key => {
      if (hit) return
      for (const i of grid.get(key) ?? []) {
        const o = placed[i]
        if (b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h) {
          hit = true
          return
        }
      }
    })
    return hit
  }
  const steps = Math.floor((72 * H) / CLOUD_SPACING)
  return words.map(word => {
    const tw = Math.ceil(measure(word.text, word.size)) + 2
    const th = word.size + Math.floor((word.size + 4) / 5) + 2
    const rotate = word.rotate === true
    const w = rotate ? th : tw
    const h = rotate ? tw : th
    if (w > W || h > H || W <= 0 || H <= 0) return null
    for (let t = 0; t <= steps; t++) {
      const k = t % 72
      const dx = divRound(CLOUD_SPACING * t * cos5(k) * W, 72 * 10000 * H)
      const dy = divRound(CLOUD_SPACING * t * cos5(k - 18), 72 * 10000)
      const b: CloudBox = { x: Math.floor(W / 2) + dx - Math.floor(w / 2), y: Math.floor(H / 2) + dy - Math.floor(h / 2), w, h, rotate }
      if (b.x < 0 || b.y < 0 || b.x + w > W || b.y + h > H || hits(b)) continue
      const i = placed.push(b) - 1
      cells(b, key => {
        const list = grid.get(key)
        if (list) list.push(i)
        else grid.set(key, [i])
      })
      return b
    }
    return null
  })
}

export interface CloudEntry { text: string; value: number; series: string | undefined }

/**
 * The words of a cloud: rows with the same `text` are summed (the first row's `series` names the word's group);
 * empty texts, missing values and values at or below zero are left out (a font size cannot show them). Sorted by
 * value, largest first, ties in data order; only the largest {@link CLOUD_LIMITS}.maxWords are kept.
 */
export function cloudWords(spec: Record<string, any>): { words: CloudEntry[]; total: number; skipped: number } {
  const sums = new Map<string, CloudEntry>()
  let skipped = 0
  for (const r of spec.data as Row[]) {
    const raw = r[spec.text]
    const text = raw === null || raw === undefined ? '' : String(raw).trim()
    const v = toNumber(r[spec.value])
    if (!text || v === null) continue
    if (v <= 0) {
      skipped++
      continue
    }
    const e = sums.get(text)
    if (e) e.value += v
    else sums.set(text, { text, value: v, series: typeof spec.series === 'string' ? String(r[spec.series] ?? '') : undefined })
  }
  const all = [...sums.values()].filter(e => e.value > 0)
  const ranked = all.map((e, i) => ({ e, i })).sort((a, b) => b.e.value - a.e.value || a.i - b.i).map(x => x.e)
  return { words: ranked.slice(0, CLOUD_LIMITS.maxWords), total: ranked.length, skipped }
}

/**
 * Font size of a word: `max(minFont, floor(maxFont * sqrt(value / largest)))`, so the area of a word's box
 * grows with its value (for words of equal length) rather than its height. Words under the floor are drawn at
 * `minFont`, larger than their value implies.
 */
export const cloudFontSize = (value: number, largest: number, maxFont: number, minFont: number = CLOUD_LIMITS.minFont): number => Math.max(minFont, Math.floor(maxFont * Math.sqrt(value / largest)))

function compile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const { words } = cloudWords(s)
  const vKey = String(s.value)
  const grouped = typeof s.series === 'string'
  const groups = grouped ? distinct(words.map(w => w.series ?? '')) : []
  // A word without a group gets the key "" (colours, toggles, datum) and the label "no <column>".
  const series = grouped ? c.makeSeries(groups, { '': c.t('noValue', { name: String(s.series) }) }) : [{ key: vKey, label: clip(vKey, 60), color: c.seriesColor(vKey, 0), hidden: c.hidden.has(vKey) }]
  const area = c.frame({ series, autoSide: 'top' })
  if (!words.length) return { series }
  const largest = words[0].value
  const smallest = words[words.length - 1].value
  const W = Math.floor(area.w)
  const H = Math.floor(area.h)
  const minFont = CLOUD_LIMITS.minFont
  const maxFont0 = Math.max(minFont, Math.min(CLOUD_LIMITS.maxFont, Math.floor(Math.min(W, H) / 5)))
  const measure = (text: string, size: number): number => c.measure(text, size, 500)
  const rotateSome = s.rotate === 'some'
  // Try the largest fonts first; shrink (x0.8, up to three times) while words are left out, keep the best try.
  let best: { boxes: (CloudBox | null)[]; sizes: number[]; placed: number } | null = null
  let maxFont = maxFont0
  for (let attempt = 0; attempt < 4; attempt++) {
    const sizes = words.map(w => cloudFontSize(w.value, largest, maxFont, minFont))
    const boxes = cloudLayout(words.map((w, i) => ({ text: w.text, size: sizes[i], rotate: rotateSome && i % 4 === 3 })), W, H, measure)
    const placed = boxes.filter(Boolean).length
    if (!best || placed > best.placed) best = { boxes, sizes, placed }
    if (placed === words.length) break
    const next = Math.max(minFont, Math.floor(maxFont * 0.8))
    if (next === maxFont) break
    maxFont = next
  }
  const { boxes, sizes } = best!
  const dropped = words.filter((_, i) => !boxes[i])
  if (dropped.length) c.warn('words_dropped', 'text', `${dropped.length} of ${words.length} words did not fit and are left out: ${fmtList(dropped.map(w => `"${clip(w.text, 30)}"`), 5)}. They stay in the description and the data table.`, 'Make the chart larger, show fewer words with `transform` (`top`), or use a sorted bar chart.')
  const floored = words.filter((w, i) => boxes[i] && sizes[i] === minFont && Math.floor(maxFont * Math.sqrt(w.value / largest)) < minFont).length
  if (floored) c.warn('sizes_floored', 'value', `${floored} small word(s) are drawn at the ${minFont} px minimum, larger than their value implies.`, 'Read exact values in the tooltip or the data table, or keep fewer words.')

  const low = tokenValue(c.theme, 'text')
  const high = tokenValue(c.theme, 'seq-high')
  const n = words.length
  const f = c.format
  const texts: Mark[] = []
  const hits: Mark[] = []
  words.forEach((w, i) => {
    const b = boxes[i]
    if (!b) return
    const key = grouped ? (w.series ?? '') : vKey
    if (c.hidden.has(key)) return
    // One hue: a group's colour, or a ramp from the text colour (small words, always legible) to the hue (large).
    const t = largest === smallest ? 1 : (w.value - smallest) / (largest - smallest)
    const fill = grouped ? series.find(x => x.key === key)!.color : mix(low, high, 0.35 + 0.65 * t)
    const rows = [{ label: clip(vKey, 60), value: f(w.value), color: fill }, { label: c.t('rank'), value: c.t('rankOf', { rank: i + 1, n }) }]
    if (grouped) rows.push({ label: clip(String(s.series), 60), value: clip(key, 60), color: fill })
    const tip = { title: clip(w.text, 60), rows }
    const aria = c.t('wordAria', { word: clip(w.text, 60), value: f(w.value), rank: i + 1, n }) + (grouped && key ? `, ${clip(key, 60)}` : '')
    const datum = { text: w.text, value: w.value, rank: i + 1, ...(grouped ? { series: key } : {}) }
    const cx = area.x + b.x + b.w / 2
    const cy = area.y + b.y + b.h / 2
    texts.push(c.text(cx, cy, w.text, { role: 'data', series: key, size: sizes[i], weight: 500, fill, anchor: 'middle', baseline: 'middle', ...(b.rotate ? { rotate: -90 } : {}), anim: 'fade', tip, aria, datum }))
    hits.push({ type: 'rect', role: 'hit', x: area.x + b.x, y: area.y + b.y, w: b.w, h: b.h, fill: 'transparent', series: key, tip, aria, datum })
  })
  // Words in value order (the keyboard's order on SVG), then their hover boxes on top.
  c.marks.push(...texts, ...hits)
  return { series }
}

function check(spec: Record<string, any>, ctx: ValidateCtx): void {
  const { words, total, skipped } = cloudWords({ ...spec, data: ctx.rows })
  if (!words.length) {
    ctx.issues.push({ severity: 'error', code: 'no_positive_values', path: 'value', message: 'No word has a positive value; a word cloud sizes words by value.', hint: 'Check the value and text columns, or the transform that produced them.' })
    return
  }
  if (spec.patterns === true) ctx.issues.push({ severity: 'warning', code: 'patterns_unsupported', path: 'patterns', message: 'A word cloud draws text, which has no fill to texture; patterns is ignored. Groups stay apart by the legend, the tooltip and the spoken label.' })
  if (skipped) ctx.issues.push({ severity: 'warning', code: 'nonpositive_values', path: 'value', message: `${skipped} row(s) with a value at or below zero are left out; a font size cannot show them.` })
  if (total > CLOUD_LIMITS.maxWords) ctx.issues.push({ severity: 'warning', code: 'too_many_words', path: 'text', message: `${total} distinct words; only the ${CLOUD_LIMITS.maxWords} largest are drawn.`, hint: 'Keep the top words with a `top` transform step, or use a sorted bar chart.' })
}

function describe(spec: Record<string, any>, env: { locale: string }): string {
  const { words, total } = cloudWords(spec)
  const f = formatter(spec, env.locale)
  const v = clip(String(spec.value), 30)
  let t = `${lead(spec, 'Word cloud')} ${total} ${total === 1 ? 'word' : 'words'} sized by ${v} (font size grows with the square root of the value, so a word's area roughly follows it; a long word looks bigger than a short one of the same value).`
  if (total > words.length) t += ` Only the ${words.length} largest are drawn.`
  const top = words.slice(0, 10)
  const list = top.map(w => `${clip(w.text, 30)} ${f(w.value)}`).join(', ')
  t += words.length === 1 ? ` The word: ${list}.` : ` ${top.length < words.length ? `Top ${top.length}` : 'All words'}, largest first: ${list}.`
  if (typeof spec.series === 'string') {
    const col = clip(String(spec.series), 30)
    const groups = distinct(words.map(w => w.series ?? ''))
    t += ` Coloured by ${col}: ${fmtList(groups.map(g => (g ? clip(g, 30) : `no ${col}`)))}.`
  }
  return t
}

export const wordcloud: ChartDef = {
  type: 'wordcloud',
  name: 'Word cloud',
  summary: 'Shows words or short phrases sized by a value (a count, a weight), packed on a spiral with the largest in the middle.',
  useWhen: 'A first impression of which terms dominate a text or a set of tags, when the exact order matters less than the gist. Font size is a weak cue: long words look bigger than short ones of the same value and neighbours are hard to compare. To compare values, or for an audience that must read them, use a sorted horizontal bar chart (`type: "bar"`, `orientation: "horizontal"`, `sort: "desc"`).',
  cartesian: false,
  fields: {
    text: { kind: 'column', role: 'any', required: true, desc: 'Column holding each word or short phrase. Rows with the same text are summed.' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column sizing each word (font size grows with its square root). Values at or below zero are left out. At most the 150 largest words are drawn.' },
    series: { kind: 'column', role: 'any', desc: 'Column naming a group per word (its first row decides): words are coloured by group with a legend. Without it, one hue darkens from small to large words.' },
    rotate: { kind: 'enum', values: ['none', 'some'], default: 'none', desc: '`none` keeps every word horizontal (easiest to read); `some` turns every fourth word in value order a quarter turn, which packs tighter.' }
  },
  example: {
    type: 'wordcloud',
    title: 'What customers mention in reviews',
    subtitle: 'Mentions per term, 1,200 reviews',
    text: 'term', value: 'mentions', format: 'integer',
    data: [
      ['delivery', 214], ['price', 188], ['quality', 161], ['support', 132], ['battery', 118], ['screen', 97], ['size', 84], ['setup', 71],
      ['refund', 63], ['app', 58], ['packaging', 49], ['warranty', 44], ['colour', 38], ['manual', 31], ['noise', 27], ['weight', 24],
      ['charger', 21], ['strap', 17], ['firmware', 15], ['returns', 12], ['sound', 11], ['buttons', 9], ['case', 8], ['gift', 6]
    ].map(([term, mentions]) => ({ term, mentions }))
  },
  check,
  compile,
  describe
}
