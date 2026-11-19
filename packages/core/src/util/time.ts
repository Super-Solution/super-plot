import type { Issue } from '../schema.js'

/**
 * Time scale helpers. All times are epoch milliseconds (instants). They are shown in a time zone, UTC unless the
 * render options name another IANA zone; the same spec, options and engine data give the same output.
 */

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
  // A Date holds at most 8.64e15 ms either side of 1970; beyond that formatting throws, so it is not a time.
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 8.64e15 ? v : null
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

// ---- time zones ------------------------------------------------------------------------------------

/**
 * The canonical name of an IANA time zone (`"america/new_york"` gives `"America/New_York"`), or null when the
 * engine does not know it. `UTC` is always known.
 */
export function timeZoneName(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return null
  if (tz === 'UTC') return 'UTC'
  try {
    return new Intl.DateTimeFormat('en', { timeZone: tz.trim() }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

const partsFmt = new Map<string, Intl.DateTimeFormat | null>()
const offsetCache = new Map<string, Map<number, number>>()
const QUARTER = 15 * MIN

function wallFields(tz: string): Intl.DateTimeFormat | null {
  let f = partsFmt.get(tz)
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', era: 'short' })
    } catch {
      f = null
    }
    partsFmt.set(tz, f)
  }
  return f
}

/** Offset of a zone from UTC at one instant (whole seconds), computed from the engine's zone data. */
function exactOffset(t: number, tz: string): number {
  const f = wallFields(tz)
  if (!f) return 0
  const s = Math.floor(t / SEC) * SEC
  let y = 0
  let mo = 1
  let d = 1
  let h = 0
  let mi = 0
  let se = 0
  let bc = false
  for (const p of f.formatToParts(s)) {
    if (p.type === 'year') y = Number(p.value)
    else if (p.type === 'month') mo = Number(p.value)
    else if (p.type === 'day') d = Number(p.value)
    else if (p.type === 'hour') h = Number(p.value) % 24
    else if (p.type === 'minute') mi = Number(p.value)
    else if (p.type === 'second') se = Number(p.value)
    else if (p.type === 'era') bc = /^B/i.test(p.value)
  }
  const wall = new Date(0)
  wall.setUTCFullYear(bc ? 1 - y : y, mo - 1, d)
  wall.setUTCHours(h, mi, se, 0)
  const o = wall.getTime() - s
  return Number.isFinite(o) ? o : 0
}

/**
 * How far local wall-clock time in `tz` is ahead of UTC at instant `t`, in ms (New York in winter: -5 h).
 * Zone changes fall on quarter hours, so offsets are cached per quarter hour when both ends of it agree.
 */
export function zoneOffset(t: number, tz: string): number {
  if (tz === 'UTC' || !Number.isFinite(t)) return 0
  let m = offsetCache.get(tz)
  if (!m) offsetCache.set(tz, (m = new Map()))
  const q = Math.floor(t / QUARTER)
  const hit = m.get(q)
  if (hit !== undefined) return hit
  const a = exactOffset(q * QUARTER, tz)
  const b = exactOffset(q * QUARTER + QUARTER - SEC, tz)
  if (a !== b) return exactOffset(t, tz)
  if (m.size > 200_000) m.clear()
  m.set(q, a)
  return a
}

/** Local wall-clock time of an instant, as ms "as if UTC" (so `getUTC*` reads the local fields). */
export const toWall = (t: number, tz: string): number => t + zoneOffset(t, tz)

/**
 * The instant that a wall-clock time in `tz` names. A time skipped by a spring-forward change resolves to the
 * instant just after the gap; a time that occurs twice (fall back) resolves to the first.
 */
export function fromWall(wall: number, tz: string): number {
  if (tz === 'UTC') return wall
  const o1 = zoneOffset(wall, tz)
  let t = wall - o1
  const o2 = zoneOffset(t, tz)
  if (o2 !== o1) {
    const t2 = wall - o2
    if (zoneOffset(t2, tz) === o2) t = t2
  }
  return t
}

/** The render time zone, canonicalised; an unknown name warns and falls back to UTC. */
export function renderTimeZone(tz: unknown, issues: Issue[]): string {
  if (tz === undefined) return 'UTC'
  const name = timeZoneName(tz)
  if (name) return name
  issues.push({ severity: 'warning', code: 'bad_time_zone', path: 'timeZone', message: `timeZone ${typeof tz === 'string' ? `"${tz.slice(0, 64)}"` : 'must be a string and'} is not a time zone this engine knows; UTC was used.`, hint: 'Use an IANA name such as "Europe/London" or "America/New_York".' })
  return 'UTC'
}

// ---- ticks -----------------------------------------------------------------------------------------

/**
 * Ticks for a time axis from `t0` to `t1`, about `count` of them, at round boundaries of the time zone: local
 * midnights, Mondays, first days of months and years. Across a daylight-saving change ticks stay on local
 * boundaries, so the gap between two of them can be 23 or 25 hours.
 */
export function timeTicks(t0: number, t1: number, count: number, locale: string, timeZone = 'UTC'): TimeTick[] {
  const tz = timeZone
  const lo = Math.min(t0, t1)
  const hi = Math.max(t0, t1)
  if (lo === hi) return [{ value: lo, label: formatTime(lo, 'day', locale, tz) }]
  const target = (hi - lo) / Math.max(1, count)
  let step = STEPS[STEPS.length - 1]
  for (const s of STEPS) {
    if (s.ms >= target * 0.8) {
      step = s
      break
    }
  }
  const values: number[] = []
  const push = (t: number): void => {
    if (t >= lo && t <= hi && t !== values[values.length - 1]) values.push(t)
  }
  if (step.unit === 'ms') {
    // Below a day, a zone whose offset is a whole number of steps has its boundaries on the UTC grid: stepping in
    // real time keeps a tick in the hour that a fall-back change repeats.
    const real = tz === 'UTC' || (step.ms < DAY && zoneOffset(lo, tz) % step.ms === 0 && zoneOffset(hi, tz) % step.ms === 0)
    const wlo = real ? lo : toWall(lo, tz)
    const whi = real ? hi : toWall(hi, tz)
    // Weeks align to Monday (epoch day 0 is a Thursday).
    const offset = step.ms === 7 * DAY ? 4 * DAY : 0
    let t = Math.ceil((wlo - offset) / step.ms) * step.ms + offset
    for (let i = 0; t <= whi && i < 400; t += step.ms, i++) push(real ? t : fromWall(t, tz))
  } else {
    const d = new Date(toWall(lo, tz))
    let y = d.getUTCFullYear()
    let m = step.unit === 'year' ? 0 : d.getUTCMonth()
    if (step.unit === 'year') y = Math.floor(y / step.n) * step.n
    else m = Math.floor(m / step.n) * step.n
    for (let i = 0; i < 400; i++) {
      const t = fromWall(Date.UTC(y, m, 1), tz)
      if (t > hi) break
      push(t)
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
  return values.map(value => ({ value, label: tickLabel(value, step.level, locale, tz) }))
}

export function tickLabel(t: number, level: Step['level'], locale: string, timeZone = 'UTC'): string {
  const d = new Date(toWall(t, timeZone))
  if (level === 'year') return String(d.getUTCFullYear())
  if (level === 'month') return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : formatTime(t, 'month', locale, timeZone)
  if (level === 'day') return formatTime(t, 'day', locale, timeZone)
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  if (midnight) return formatTime(t, 'day', locale, timeZone)
  return formatTime(t, level === 'sec' ? 'second' : 'minute', locale, timeZone)
}

const cache = new Map<string, Intl.DateTimeFormat>()
function dtf(locale: string, timeZone: string, key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${locale}|${timeZone}|${key}`
  let f = cache.get(k)
  if (!f) {
    for (const [l, z] of [[locale, timeZone], ['en', timeZone], ['en', 'UTC']]) {
      try {
        f = new Intl.DateTimeFormat(l, { timeZone: z, ...opts })
        break
      } catch {
        // Unknown locale or zone: try the next pair.
      }
    }
    cache.set(k, f!)
  }
  return f!
}

export type TimeLevel = 'second' | 'minute' | 'day' | 'month' | 'full' | 'datetime'

/** An instant as text in a locale and time zone (default UTC). */
export function formatTime(t: number, level: TimeLevel, locale: string, timeZone = 'UTC'): string {
  const z = timeZone
  switch (level) {
    case 'second':
      return dtf(locale, z, 's', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(t)
    case 'minute':
      return dtf(locale, z, 'm', { hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
    case 'day':
      return dtf(locale, z, 'd', { month: 'short', day: 'numeric' }).format(t)
    case 'month':
      return dtf(locale, z, 'M', { month: 'short' }).format(t)
    case 'datetime':
      return dtf(locale, z, 'dt', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
    default:
      return dtf(locale, z, 'f', { year: 'numeric', month: 'short', day: 'numeric' }).format(t)
  }
}

/** True when any value carries a time of day in the zone, so tooltips should show it. */
export const hasTimeOfDay = (values: number[], timeZone = 'UTC'): boolean => values.some(v => toWall(v, timeZone) % DAY !== 0)

/** Weekday name of a time in a locale and time zone (`short`: "Mon", `long`: "Monday"). */
export function formatWeekday(t: number, width: 'short' | 'long', locale: string, timeZone = 'UTC'): string {
  return dtf(locale, timeZone, width === 'short' ? 'wd' : 'WD', { weekday: width }).format(t)
}

/**
 * An elapsed time in ms as at most two units, largest first: "3 d 4 h", "2 h 15 min", "45 s", "0.25 s". A day is
 * 24 hours of elapsed time (a day across a daylight-saving change is 23 or 25 h). `units` are the unit words.
 */
export function formatDuration(ms: number, locale: string, units: { day: string; hour: string; minute: string; second: string } = { day: 'd', hour: 'h', minute: 'min', second: 's' }): string {
  const sign = ms < 0 ? '-' : ''
  const a = Math.abs(ms)
  const nf = (n: number, digits = 0): string => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n)
  if (Math.round(a / SEC) < 60) return `${sign}${nf(a / SEC, a < 10 * SEC ? 2 : 0)} ${units.second}`
  const parts: [number, string][] = [[DAY, units.day], [HOUR, units.hour], [MIN, units.minute], [SEC, units.second]]
  // Round to the second unit shown, so 1 d 23 h 59 min reads "2 d", never "1 d 24 h".
  const round = (v: number): [number, number] => {
    const i = parts.findIndex(([u]) => v >= u)
    const u2 = parts[Math.min(i + 1, parts.length - 1)][0]
    return [i, Math.round(v / u2) * u2]
  }
  let [first, rest] = round(a)
  // Rounding can carry into a larger unit (59 min 59.6 s is 1 h).
  const again = round(rest)
  if (again[0] < first) [first, rest] = again
  const out: string[] = []
  for (const [u, w] of parts.slice(first)) {
    if (out.length === 2) break
    const n = Math.floor(rest / u)
    rest -= n * u
    if (n || out.length === 0) out.push(`${nf(n)} ${w}`)
    else if (out.length === 1) break
  }
  return sign + out.join(' ')
}
