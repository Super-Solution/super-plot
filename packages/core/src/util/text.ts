// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/** Text measurement without a DOM. An estimate, good to within a few percent for UI fonts. */

export type Measure = (text: string, size: number, weight?: number) => number

const NARROW = new Set("iljI.,:;'|!`".split(''))
const WIDE = new Set('mwMW@%'.split(''))

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  )
}

export const estimateWidth: Measure = (text, size, weight = 400) => {
  let w = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (isWide(code)) w += 1
    else if (ch === ' ') w += 0.28
    else if (NARROW.has(ch)) w += 0.27
    else if (WIDE.has(ch)) w += 0.86
    else if (ch >= 'A' && ch <= 'Z') w += 0.66
    else if (ch >= '0' && ch <= '9') w += 0.58
    else w += 0.54
  }
  return w * size * (weight >= 600 ? 1.06 : 1)
}

/** Shorten `text` with an ellipsis so it fits `maxWidth`. */
export function fit(text: string, maxWidth: number, size: number, measure: Measure, weight = 400): string {
  if (measure(text, size, weight) <= maxWidth) return text
  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(chars.slice(0, mid).join('') + '…', size, weight) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo <= 0 ? '…' : chars.slice(0, lo).join('').trimEnd() + '…'
}

/** Cap spec-supplied strings so one runaway label cannot blow up a layout or an SVG. */
export const clip = (s: unknown, max = 160): string => {
  const t = typeof s === 'string' ? s : s === null || s === undefined ? '' : String(s)
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
