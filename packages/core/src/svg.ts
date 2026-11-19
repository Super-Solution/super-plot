// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { resolveVars } from './theme.js'
import type { Mark, Scene } from './scene.js'
import { roundedRectPath } from './scene.js'
import { PATTERN_OPACITY, PATTERN_SIZE, patternAt } from './patterns.js'

export interface SvgOptions {
  /** Add classes and `data-*` hooks so a binding can attach hover, focus and legend toggling. */
  interactive?: boolean
  /** Replace `var(--sp-*, fallback)` with the fallback, for renderers without CSS variables (PNG, PDF, email). */
  resolveVars?: boolean
  /** Prefix for element ids, so several charts can share a page. */
  idPrefix?: string
  /** Font stack for the root element. */
  font?: string
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeXml = (s: string): string => s.replace(/[&<>"']/g, c => ESC[c])

/** FNV-1a, base 36: a short deterministic id for a string (also the hydration key of server-rendered SVG). */
export function svgKey(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

const n = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0')

/** Serialise a scene to a standalone SVG string. Deterministic: same scene, same bytes. */
export function renderSvg(scene: Scene, options: SvgOptions = {}): string {
  const rv = options.resolveVars ? resolveVars : (s: string): string => s
  const id = options.idPrefix ?? 'sp'
  const interactive = options.interactive === true
  const font = rv(options.font ?? 'system-ui, sans-serif')
  // Clip ids hash their own path, so several standalone SVGs on one page never borrow each other's clip.
  const clipIds = scene.clips ? Object.keys(scene.clips) : []
  const clipRef = new Map(clipIds.map(k => [k, `${id}-c${svgKey(scene.clips![k])}`]))
  const used = [...new Set(scene.marks.flatMap(m => (m.pattern === undefined ? [] : [m.pattern])))]
  const ink = escapeXml(rv(scene.background))
  const patterns = used.map(p => {
    const t = patternAt(p)
    const body = (t.lines ? `<path d="${t.lines}" stroke="${ink}" stroke-width="${t.width ?? 1}" fill="none"/>` : '') + (t.dots ?? []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${t.r ?? 1}" fill="${ink}"/>`).join('')
    return `<pattern id="${escapeXml(id)}-p${p}" width="${PATTERN_SIZE}" height="${PATTERN_SIZE}" patternUnits="userSpaceOnUse">${body}</pattern>`
  })
  const defsBody = clipIds.map(k => `<clipPath id="${escapeXml(clipRef.get(k)!)}"><path d="${escapeXml(scene.clips![k])}"/></clipPath>`).join('') + patterns.join('')
  const defs = defsBody ? `<defs>${defsBody}</defs>` : ''
  const body: string[] = []
  scene.marks.forEach((m, i) => {
    if (m.role === 'hit' && !interactive) return
    const clip = m.clip !== undefined && clipRef.has(m.clip) ? ` clip-path="url(#${escapeXml(clipRef.get(m.clip)!)})"` : ''
    body.push(renderMark(m, i, interactive, rv, clip))
    if (m.pattern !== undefined && (m.type === 'rect' || m.type === 'path')) {
      // The texture is a second shape on top: no events, no focus, and it grows with the mark's entrance.
      const over = { ...m, fill: `url(#${id}-p${m.pattern})`, stroke: undefined, strokeWidth: undefined, opacity: (m.opacity ?? 1) * PATTERN_OPACITY } as Mark
      body.push(renderMark(over, -1, false, s => s, clip).replace(/\/>$/, `${interactive ? ` class="sp-pat${m.anim ? ` sp-a-${m.anim}` : ''}"${m.series !== undefined ? ` data-s="${escapeXml(m.series)}"` : ''}` : ''} pointer-events="none" aria-hidden="true"/>`))
    }
  })
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(scene.width)} ${n(scene.height)}" width="${n(scene.width)}" height="${n(scene.height)}"` +
    ` role="img" aria-labelledby="${id}-t ${id}-d" style="font-family:${escapeXml(font)}">` +
    `<title id="${id}-t">${escapeXml(scene.title)}</title><desc id="${id}-d">${escapeXml(scene.description)}</desc>` +
    `<rect width="${n(scene.width)}" height="${n(scene.height)}" fill="${escapeXml(rv(scene.background))}"/>` + defs
  return head + body.join('') + '</svg>'
}

function paint(attr: string, v: string | undefined, rv: (s: string) => string): string {
  return v === undefined ? '' : ` ${attr}="${escapeXml(rv(v))}"`
}

/** A breadcrumb item (drill-down): a button in interactive SVG. */
const crumb = (m: Mark): boolean => m.drill !== undefined && m.role === 'label' && m.type === 'rect' && m.tip === undefined

function renderMark(m: Mark, i: number, interactive: boolean, rv: (s: string) => string, clip: string): string {
  const hooks = clip + (interactive
    ? ` class="sp-m sp-${m.role}${m.anim ? ` sp-a-${m.anim}` : ''}" data-i="${i}"${m.series !== undefined ? ` data-s="${escapeXml(m.series)}"` : ''}${m.legendKey !== undefined ? ` data-lk="${escapeXml(m.legendKey)}"` : ''}${m.tip && m.role !== 'hit' && m.legendKey === undefined ? ' tabindex="0"' : ''}${m.legendKey !== undefined ? ` role="button" tabindex="0" aria-label="${escapeXml(m.aria ?? m.legendKey)}"` : crumb(m) ? ` role="button" tabindex="0" aria-label="${escapeXml(m.aria ?? m.drill!.join(' > '))}"` : m.aria ? ` role="img" aria-label="${escapeXml(m.aria)}"` : ''}`
    : '')
  const op = m.opacity !== undefined && m.opacity !== 1 ? ` opacity="${n(m.opacity)}"` : ''
  switch (m.type) {
    case 'rect': {
      const radius = m.r
      if (Array.isArray(radius)) {
        return `<path d="${roundedRectPath(m.x, m.y, m.w, m.h, radius)}"${paint('fill', m.fill, rv)}${paint('stroke', m.stroke, rv)}${m.strokeWidth ? ` stroke-width="${n(m.strokeWidth)}"` : ''}${op}${hooks}/>`
      }
      return `<rect x="${n(m.x)}" y="${n(m.y)}" width="${n(Math.max(0, m.w))}" height="${n(Math.max(0, m.h))}"${radius ? ` rx="${n(radius)}"` : ''}${paint('fill', m.fill ?? 'none', rv)}${paint('stroke', m.stroke, rv)}${m.strokeWidth ? ` stroke-width="${n(m.strokeWidth)}"` : ''}${op}${hooks}/>`
    }
    case 'path':
      return `<path d="${escapeXml(m.d)}"${m.rule ? ` fill-rule="${m.rule}"` : ''}${paint('fill', m.fill ?? 'none', rv)}${paint('stroke', m.stroke, rv)}${m.strokeWidth ? ` stroke-width="${n(m.strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"` : ''}${m.dash ? ` stroke-dasharray="${escapeXml(m.dash)}"` : ''}${m.anim === 'draw' && interactive ? ' pathLength="1"' : ''}${op}${hooks}/>`
    case 'circle':
      return `<circle cx="${n(m.cx)}" cy="${n(m.cy)}" r="${n(m.r)}"${paint('fill', m.fill ?? 'none', rv)}${paint('stroke', m.stroke, rv)}${m.strokeWidth ? ` stroke-width="${n(m.strokeWidth)}"` : ''}${op}${hooks}/>`
    case 'line':
      return `<line x1="${n(m.x1)}" y1="${n(m.y1)}" x2="${n(m.x2)}" y2="${n(m.y2)}"${paint('stroke', m.stroke, rv)} stroke-width="${n(m.strokeWidth ?? 1)}"${m.dash ? ` stroke-dasharray="${escapeXml(m.dash)}"` : ''}${op}${hooks}/>`
    case 'text': {
      const dy = m.baseline === 'middle' ? ' dy="0.35em"' : m.baseline === 'hanging' ? ' dy="0.8em"' : ''
      const rot = m.rotate ? ` transform="rotate(${n(m.rotate)} ${n(m.x)} ${n(m.y)})"` : ''
      return `<text x="${n(m.x)}" y="${n(m.y)}"${dy} font-size="${n(m.size)}"${m.weight && m.weight !== 400 ? ` font-weight="${m.weight}"` : ''}${paint('fill', m.fill, rv)}${m.anchor && m.anchor !== 'start' ? ` text-anchor="${m.anchor}"` : ''}${rot}${op}${hooks}>${escapeXml(m.text)}</text>`
    }
  }
}
