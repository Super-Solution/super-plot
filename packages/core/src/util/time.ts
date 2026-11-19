/** Time scale helpers. All times are epoch milliseconds, rendered in UTC so output is deterministic. */

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Step = { ms: number; unit: 'ms' | 'month' | 'year'; n: number; level: 'sec' | 'min' | 'hour' | 'day' | 'month' | 'year' }

const STEPS: Step[] = [
  { ms: SEC, unit: 'ms', n: 1, level: 'sec' },
  { ms: 5 * SEC, unit: 'ms', n: 5, level: 'sec' },
  { ms: 15 * SEC, unit: 'ms', n: 15, level: 'sec' },
  { ms: 30 * SEC, unit: 'ms', n: 30, level: 'sec' },
  { ms: MIN, unit: 'ms', n: 1, level: 'min' },
  { ms: 5 * MIN, unit: 'ms', n: 5, level: 'min' },
  { ms: 15 * MIN, unit: 'ms', n: 15, level: 'min' },
  { ms: 30 * MIN, unit: 'ms', n: 30, level: 'min' },
  { ms: HOUR, unit: 'ms', n: 1, level: 'hour' },
  { ms: 3 * HOUR, unit: 'ms', n: 3, level: 'hour' },
  { ms: 6 * HOUR, unit: 'ms', n: 6, level: 'hour' },
  { ms: 12 * HOUR, unit: 'ms', n: 12, level: 'hour' },
  { ms: DAY, unit: 'ms', n: 1, level: 'day' },
  { ms: 2 * DAY, unit: 'ms', n: 2, level: 'day' },
  { ms: 7 * DAY, unit: 'ms', n: 7, level: 'day' },
  { ms: 30 * DAY, unit: 'month', n: 1, level: 'month' },
  { ms: 91 * DAY, unit: 'month', n: 3, level: 'month' },
  { ms: 182 * DAY, unit: 'month', n: 6, level: 'month' },
  { ms: 365 * DAY, unit: 'year', n: 1, level: 'year' },
  { ms: 2 * 365 * DAY, unit: 'year', n: 2, level: 'year' },
  { ms: 5 * 365 * DAY, unit: 'year', n: 5, level: 'year' },
  { ms: 10 * 365 * DAY, unit: 'year', n: 10, level: 'year' },
  { ms: 25 * 365 * DAY, unit: 'year', n: 25, level: 'year' },
  { ms: 50 * 365 * DAY, unit: 'year', n: 50, level: 'year' }
]

export interface TimeTick { value: number; label: string }

const ISO = /^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?)?$/

const daysIn = (year: number, month: number): number => (month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31)

/**
 * Parse a spec value to epoch ms. Date-only strings are UTC midnight; a time without a zone is UTC.
 * Parsing is strict and does not depend on the engine: 2026-02-30 and 25:00 are not times, in every language.
 */
export function toTime(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime()
    return Number.isFinite(t) ? t : null
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = ISO.exec(v.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = m[3] === undefined ? 1 : Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null
  const h = m[4] === undefined ? 0 : Number(m[4])
  const mi = m[5] === undefined ? 0 : Number(m[5])
  const sec = m[6] === undefined ? 0 : Number(m[6])
  if (h > 23 || mi > 59 || sec > 59) return null
  let offset = 0
  if (m[8] && m[8] !== 'Z') {
    const z = m[8].replace(':', '')
    const oh = Number(z.slice(1, 3))
    const om = Number(z.slice(3, 5))
    if (oh > 23 || om > 59) return null
    offset = (z[0] === '-' ? -1 : 1) * (oh * 60 + om) * MIN
  }
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  d.setUTCHours(h, mi, sec, m[7] === undefined ? 0 : Number(m[7].slice(0, 3).padEnd(3, '0')))
  return d.getTime() - offset
}

export function timeTicks(t0: number, t1: number, count: number, locale: string): TimeTick[] {
  const lo = Math.min(t0, t1)
  const hi = Math.max(t0, t1)
  if (lo === hi) return [{ value: lo, label: formatTime(lo, 'day', locale) }]
  const target = (hi - lo) / Math.max(1, count)
  let step = STEPS[STEPS.length - 1]
  for (const s of STEPS) {
    if (s.ms >= target * 0.8) {
      step = s
      break
    }
  }
  const values: number[] = []
  if (step.unit === 'ms') {
    // Weeks align to Monday (epoch day 0 is a Thursday).
    const offset = step.ms === 7 * DAY ? 4 * DAY : 0
    let t = Math.ceil((lo - offset) / step.ms) * step.ms + offset
    for (; t <= hi && values.length < 400; t += step.ms) values.push(t)
  } else {
    const d = new Date(lo)
    let y = d.getUTCFullYear()
    let m = step.unit === 'year' ? 0 : d.getUTCMonth()
    if (step.unit === 'year') y = Math.floor(y / step.n) * step.n
    else m = Math.floor(m / step.n) * step.n
    for (let i = 0; i < 400; i++) {
      const t = Date.UTC(y, m, 1)
      if (t > hi) break
      if (t >= lo) values.push(t)
      if (step.unit === 'year') y += step.n
      else {
        m += step.n
        while (m >= 12) {
          m -= 12
          y += 1
        }
      }
    }
  }
  return values.map(value => ({ value, label: tickLabel(value, step.level, locale) }))
}

function tickLabel(t: number, level: Step['level'], locale: string): string {
  const d = new Date(t)
  if (level === 'year') return String(d.getUTCFullYear())
  if (level === 'month') return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : formatTime(t, 'month', locale)
  if (level === 'day') return formatTime(t, 'day', locale)
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  if (midnight) return formatTime(t, 'day', locale)
  return formatTime(t, level === 'sec' ? 'second' : 'minute', locale)
}

const cache = new Map<string, Intl.DateTimeFormat>()
function dtf(locale: string, key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${locale}|${key}`
  let f = cache.get(k)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts })
    } catch {
      f = new Intl.DateTimeFormat('en', { timeZone: 'UTC', ...opts })
    }
    cache.set(k, f)
  }
  return f
}

export type TimeLevel = 'second' | 'minute' | 'day' | 'month' | 'full' | 'datetime'

export function formatTime(t: number, level: TimeLevel, locale: string): string {
  switch (level) {
    case 'second':
      return dtf(locale, 's', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(t)
    case 'minute':
      return dtf(locale, 'm', { hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
    case 'day':
      return dtf(locale, 'd', { month: 'short', day: 'numeric' }).format(t)
    case 'month':
      return dtf(locale, 'M', { month: 'short' }).format(t)
    case 'datetime':
      return dtf(locale, 'dt', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
    default:
      return dtf(locale, 'f', { year: 'numeric', month: 'short', day: 'numeric' }).format(t)
  }
}

/** True when any value carries a time of day, so tooltips should show it. */
export const hasTimeOfDay = (values: number[]): boolean => values.some(v => v % DAY !== 0)
