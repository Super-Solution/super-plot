// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/** Colour helpers. Only hex colours are interpolated; CSS-variable paints pass through untouched. */

export interface RGB { r: number; g: number; b: number }

export function parseHex(hex: string): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

const hex2 = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
export const toHex = ({ r, g, b }: RGB): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`

/** Linear mix of two hex colours, `t` in [0, 1]. Falls back to `a` for non-hex input. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return a
  return toHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t })
}

/** WCAG relative luminance, 0..1. */
export function luminance(hex: string): number {
  const c = parseHex(hex)
  if (!c) return 0.5
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Dark or light ink, whichever reads better on `fill`. */
export function inkOn(fill: string, dark = '#131722', light = '#FFFFFF'): string {
  return contrast(fill, dark) >= contrast(fill, light) ? dark : light
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNC = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/-]+\)$/i
const NAMED = /^[a-z]{3,24}$/i
const VAR = /^var\(\s*--[a-z0-9_-]+\s*(?:,\s*(?:#[0-9a-f]{3,8}|[a-z]{3,24})\s*)?\)$/i

/**
 * Colours that arrive in a spec may come from an agent or a user. Only plain colour syntax is
 * accepted: no `url()`, no `;`, no quotes, nothing that could break out of an attribute.
 */
export function isSafeColor(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false
  const v = value.trim()
  return HEX.test(v) || FUNC.test(v) || VAR.test(v) || NAMED.test(v)
}
