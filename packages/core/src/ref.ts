// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * COPY of the card reference shell of super-protocol (PR #6, `implementations/typescript/src/ref.ts`, protocol
 * 0.3.0, not published yet). Replace this file with an import from `@supersolutions/super-protocol` once 0.3.0 is
 * on npm. Keep it identical until then: the types, names, limits and every message are the protocol's, and
 * `conformance/card-ref.v1.json` holds the protocol's own cases (`card_ref_parse`, `card_ref_format`), which this
 * copy and the Go and Python copies must pass. Only the envelope is copied: what the params mean for a plot is
 * Super Plot's own vocabulary (`resolveRef` in `resolve.ts`); the chart vocabulary stays in the protocol.
 *
 * A reference is a link in a message's Markdown, `[support](ref:btc?key=support)`: `ref:<target>?<name>=<value>&...`,
 * where `target` is the `id` of the card on screen.
 */

export const CARD_REF_SCHEME = 'ref'

export const CARD_REF_LIMITS = Object.freeze({
  /** The whole link, in UTF-16 code units. */
  length: 512,
  target: 128,
  /** Distinct param names. */
  names: 16,
  /** Values of one param name (`key=a&key=b`). */
  values: 32,
  name: 32,
  /** One decoded value, in UTF-16 code units. */
  value: 256
})

/**
 * A parsed reference. A param repeated in the link is a list in order (`key=a&key=b`); values are decoded once and
 * never split on commas, so a value may contain one.
 */
export interface CardRef {
  /** The `id` of the card this points into. */
  target: string
  params: Record<string, string[]>
}

/** What the reader did with the link: pointed at it, left it, or chose it (click, Enter, tap). */
export type CardRefEvent = 'enter' | 'leave' | 'activate'

/**
 * What a card answers. `ok: false` lets the host show a stale or unmatched reference as plain text with the reason
 * instead of a dead link. `code` is the card's own, for example `ref_no_match`; `label` is a short description a
 * host may show or announce.
 */
export type CardRefResult = { ok: true; label?: string } | { ok: false; code: string; reason: string }

export type CardRefParse = { ok: true; ref: CardRef } | { ok: false; error: string }

const TARGET = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const NAME = /^[a-z][A-Za-z0-9_-]{0,31}$/
const RAW_VALUE = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

function decodeValue(raw: string): string | null {
  const bytes: number[] = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '%') {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(raw.charCodeAt(i))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes))
  } catch {
    return null
  }
}

function encodeValue(value: string): string {
  let out = ''
  for (const byte of new TextEncoder().encode(value)) {
    const c = String.fromCharCode(byte)
    out += byte < 128 && /[A-Za-z0-9._~-]/.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/** Reads a `ref:` link. The error text is part of the conformance data. */
export function parseCardRef(href: unknown): CardRefParse {
  const fail = (error: string): CardRefParse => ({ ok: false, error })
  if (typeof href !== 'string') return fail('a ref must be a string.')
  if (href.length > CARD_REF_LIMITS.length) return fail(`a ref is at most ${CARD_REF_LIMITS.length} characters.`)
  if (!href.startsWith(`${CARD_REF_SCHEME}:`)) return fail(`a ref starts with "${CARD_REF_SCHEME}:".`)
  const rest = href.slice(CARD_REF_SCHEME.length + 1)
  if (rest.includes('#')) return fail('a ref has no fragment.')
  const q = rest.indexOf('?')
  const target = q < 0 ? rest : rest.slice(0, q)
  if (!TARGET.test(target)) return fail('a ref target is 1 to 128 letters, digits, dot, underscore, colon or dash, starting with a letter or digit.')
  const params: Record<string, string[]> = {}
  if (q >= 0) {
    const query = rest.slice(q + 1)
    if (query === '') return fail('a ref query is empty.')
    for (const part of query.split('&')) {
      const eq = part.indexOf('=')
      if (eq < 0) return fail('each ref param is name=value.')
      const name = part.slice(0, eq)
      const raw = part.slice(eq + 1)
      if (!NAME.test(name)) return fail('a ref param name is 1 to 32 letters, digits, dash or underscore, starting with a lowercase letter.')
      if (!RAW_VALUE.test(raw)) return fail('a ref param value is not empty and uses letters, digits, dot, dash, underscore, tilde or %XX only.')
      const value = decodeValue(raw)
      if (value === null) return fail('a ref param value must be valid UTF-8.')
      if (value.length > CARD_REF_LIMITS.value) return fail(`a ref param value is at most ${CARD_REF_LIMITS.value} characters.`)
      if (!hasOwn(params, name)) {
        if (Object.keys(params).length >= CARD_REF_LIMITS.names) return fail(`a ref has at most ${CARD_REF_LIMITS.names} param names.`)
        params[name] = []
      }
      if (params[name]!.length >= CARD_REF_LIMITS.values) return fail(`a ref param has at most ${CARD_REF_LIMITS.values} values.`)
      params[name]!.push(value)
    }
  }
  return { ok: true, ref: { target, params } }
}

/** Writes a reference as a `ref:` link, names in alphabetical order, or null when it breaks a limit. */
export function formatCardRef(ref: CardRef): string | null {
  if (typeof ref !== 'object' || ref === null || typeof ref.target !== 'string' || !TARGET.test(ref.target)) return null
  const params = ref.params
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null
  const names = Object.keys(params).sort()
  if (names.length > CARD_REF_LIMITS.names) return null
  const parts: string[] = []
  for (const name of names) {
    const values = params[name]
    if (!NAME.test(name) || !Array.isArray(values) || values.length === 0 || values.length > CARD_REF_LIMITS.values) return null
    for (const value of values) {
      if (typeof value !== 'string' || value === '' || value.length > CARD_REF_LIMITS.value) return null
      parts.push(`${name}=${encodeValue(value)}`)
    }
  }
  const href = `${CARD_REF_SCHEME}:${ref.target}${parts.length > 0 ? `?${parts.join('&')}` : ''}`
  return href.length > CARD_REF_LIMITS.length ? null : href
}
