/**
 * Colour-vision deficiency maths, pure and dependency free.
 *
 * Simulation: Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for Simulation of Color
 * Vision Deficiency", the severity 1.0 matrices for protanopia, deuteranopia and tritanopia, applied to linear
 * sRGB (decode the sRGB transfer curve first, clamp the result to [0, 1]). Distance: Euclidean in OKLab
 * (Ottosson 2020) times 100, so 1 unit is about one just-noticeable step and 8 is "clearly two colours at
 * chart-mark sizes".
 */
import { parseHex, type RGB } from './color.js'

export type Vision = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia'
export const VISIONS: readonly Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia']

type M3 = readonly [number, number, number, number, number, number, number, number, number]

/** Machado 2009, severity 1.0, row-major, for linear RGB. */
export const MACHADO: Readonly<Record<Exclude<Vision, 'normal'>, M3>> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039]
}

/** Below this OKLab x 100 distance, two adjacent series colours count as indistinct. */
export const CVD_MIN_DISTANCE = 8

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const toLinear = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** CSS colour names this module can resolve (CSS Level 2 plus a few common ones); other names are skipped. */
const NAMES: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
  magenta: '#ff00ff', fuchsia: '#ff00ff', silver: '#c0c0c0', gray: '#808080', grey: '#808080', maroon: '#800000', olive: '#808000',
  green: '#008000', purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a'
}

const num = (s: string, scale: number): number | null => {
  const t = s.trim()
  if (!/^-?\d*\.?\d+%?$/.test(t)) return null
  const n = parseFloat(t)
  return t.endsWith('%') ? (n / 100) * scale : n
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 }
}

/**
 * sRGB (0..255) of a plain CSS colour: hex (3, 4, 6 or 8 digits; alpha ignored), `rgb()`/`rgba()`,
 * `hsl()`/`hsla()` (comma or space syntax), or one of a small set of names. `null` for anything else,
 * including `var(--x)`: a variable's real value is only known to the page.
 */
export function parseColor(css: string): RGB | null {
  const v = css.trim().toLowerCase()
  if (v.startsWith('#')) {
    if (v.length === 5 || v.length === 9) return parseHex(v.slice(0, v.length === 5 ? 4 : 7))
    return parseHex(v)
  }
  if (NAMES[v]) return parseHex(NAMES[v])
  const m = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(v)
  if (!m) return null
  const parts = m[2].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  if (m[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map(p => num(p, 255))
    if (r === null || g === null || b === null) return null
    return { r: clamp01(r / 255) * 255, g: clamp01(g / 255) * 255, b: clamp01(b / 255) * 255 }
  }
  const h = num(parts[0].replace(/deg$/, ''), 360)
  const s = num(parts[1], 1)
  const l = num(parts[2], 1)
  if (h === null || s === null || l === null || !parts[1].endsWith('%') || !parts[2].endsWith('%')) return null
  return hslToRgb(((h % 360) + 360) % 360, clamp01(s), clamp01(l))
}

/** Linear-light RGB (0..1) as seen with the given vision. */
export function simulate(rgb: RGB, vision: Vision): [number, number, number] {
  const lin: [number, number, number] = [toLinear(rgb.r), toLinear(rgb.g), toLinear(rgb.b)]
  if (vision === 'normal') return lin
  const m = MACHADO[vision]
  return [
    clamp01(m[0] * lin[0] + m[1] * lin[1] + m[2] * lin[2]),
    clamp01(m[3] * lin[0] + m[4] * lin[1] + m[5] * lin[2]),
    clamp01(m[6] * lin[0] + m[7] * lin[1] + m[8] * lin[2])
  ]
}

/** OKLab [L, a, b] of a linear-light RGB triple. */
export function oklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

/** OKLab distance x 100 between two colours as seen with `vision`. */
export function cvdDistance(a: RGB, b: RGB, vision: Vision = 'normal'): number {
  const p = oklab(simulate(a, vision))
  const q = oklab(simulate(b, vision))
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100
}

/** Distances under every vision, rounded to 0.1. */
export function cvdDistances(a: RGB, b: RGB): Record<Vision, number> {
  return Object.fromEntries(VISIONS.map(v => [v, Math.round(cvdDistance(a, b, v) * 10) / 10])) as Record<Vision, number>
}

export interface IndistinctPair {
  /** Index of the first colour of the pair; the second is `index + 1`. */
  index: number
  /** Distances under every vision. */
  distances: Record<Vision, number>
  /** The vision with the smallest distance, and that distance. */
  worst: Vision
  min: number
}

/**
 * Adjacent pairs (0-1, 1-2, ...) of `colors` closer than `threshold` under any vision. Colours that cannot be
 * parsed (`null` or unparseable strings) are skipped together with both pairs they belong to. `only`, when
 * given, limits the check to pairs where at least one side is listed.
 */
export function indistinctPairs(colors: readonly (string | null)[], threshold = CVD_MIN_DISTANCE, only?: ReadonlySet<number>): IndistinctPair[] {
  const rgb = colors.map(c => (c ? parseColor(c) : null))
  const out: IndistinctPair[] = []
  for (let i = 0; i + 1 < rgb.length; i++) {
    const a = rgb[i]
    const b = rgb[i + 1]
    if (!a || !b) continue
    if (only && !only.has(i) && !only.has(i + 1)) continue
    const distances = cvdDistances(a, b)
    let worst: Vision = 'normal'
    for (const v of VISIONS) if (distances[v] < distances[worst]) worst = v
    if (distances[worst] < threshold) out.push({ index: i, distances, worst, min: distances[worst] })
  }
  return out
}
