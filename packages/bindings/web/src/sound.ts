import type { Mark, Scene } from '@supersolutions/super-plot-core/base'
import { markCenter } from './canvas.js'

export interface SonifyOptions {
  /** Seconds for the whole series. Default: 0.18 s per note, between 1.5 and 10 s. */
  duration?: number
  /** 0 to 1. Default 0.25. */
  volume?: number
  /** Pitch of the lowest value, in Hz. Default 220 (A3). */
  minFrequency?: number
  /** Pitch of the highest value, in Hz. Default 880 (A5). */
  maxFrequency?: number
  /** Notes at most; longer series are sampled evenly (first and last kept). Default 120, at most 1,000. */
  maxNotes?: number
}

/** One note: when it starts (seconds from the start), how long it lasts, its pitch, and what it stands for. */
export interface Note {
  time: number
  duration: number
  frequency: number
  /** The number that set the pitch: the datum's value, or the mark's height on screen when it has none. */
  value: number
  /** Plain text of what the note stands for (the tooltip), e.g. `"Feb: 120"`. */
  label: string
}

export interface SonifyPlan {
  /** The series played, by label (absent when the chart has one unnamed series). */
  series?: string
  notes: Note[]
  /** Total seconds. */
  duration: number
}

/** A running (or finished) sonification. */
export interface SonifyController {
  /** Stop now; safe to call twice. */
  stop(): void
  readonly playing: boolean
  readonly notes: readonly Note[]
  /** Settles when playback ends or is stopped. */
  readonly done: Promise<void>
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The number a data mark carries, when its datum has one. */
function datumValue(m: Mark): number | null {
  const d = (m.datum ?? null) as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return null
  return num(d.value) ?? num(d.y) ?? num(d.count) ?? num(d.median)
}

/** The middle of a straight-edged path's bounding box (hexagons, bars drawn as paths); null for arcs and curves. */
function pathCenter(m: Mark): { x: number; y: number } | null {
  if (m.type !== 'path' || /[AaCcQqSsTtHhVv]/.test(m.d)) return null
  const n = m.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
  if (n.length < 2 || /[a-z]/.test(m.d.replace(/[eE][-+]?\d/g, ''))) return null
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (let i = 0; i + 1 < n.length; i += 2) {
    x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i])
    y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1])
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
}

const label = (m: Mark, series?: string): string => {
  const t = m.tip
  if (!t) return m.aria ?? ''
  const rows = series !== undefined ? t.rows.filter(r => r.label === series) : t.rows
  const r = rows[0] ?? t.rows[0]
  return [t.title, r ? `${r.label === t.title ? '' : `${r.label} `}${r.value}` : ''].filter(Boolean).join(': ')
}

/**
 * What `sonify()` plays, worked out from the scene alone (pure, no audio). The first visible series is read in
 * x order (top to bottom for horizontal bars, drawing order for charts without axes) and each value becomes a
 * short note: the lowest value at `minFrequency`, the highest at `maxFrequency`, evenly spaced in pitch
 * (logarithmic in Hz). Line and area charts read their per-x columns; other charts their data marks.
 */
export function sonifyNotes(scene: Scene, options: SonifyOptions = {}): SonifyPlan {
  const first = scene.series.find(s => !s.hidden)
  type Pt = { x: number; y: number; value: number | null; label: string }
  const pts: Pt[] = []
  let series = first?.label
  const columns = scene.marks.filter(m => m.role === 'hit' && m.guide && m.focus?.length)
  if (columns.length) {
    for (const m of columns) {
      // One focus point per visible series at this x, coloured like its series.
      const f = first ? m.focus!.find(p => p.color === first.color) : m.focus![0]
      if (f) pts.push({ x: f.x, y: f.y, value: null, label: label(m, first?.label) })
    }
  } else {
    const data = scene.marks.filter(m => m.role === 'data' && m.tip && m.legendKey === undefined)
    const keys = new Set(data.map(m => m.series))
    // One mark per series (pie slices, treemap tiles): the series are the values of one variable.
    const perMark = keys.size === data.length
    const mine = !perMark && first && data.some(m => m.series === first.key) ? data.filter(m => m.series === first.key) : data
    if (perMark) series = undefined
    mine.forEach((m, i) => {
      // Shapes without a centre (pie slices) keep their drawing order.
      const c = markCenter(m) ?? pathCenter(m) ?? { x: i, y: 0 }
      pts.push({ x: c.x, y: c.y, value: datumValue(m), label: label(m, perMark ? undefined : first?.label) })
    })
  }
  const a = scene.axes
  if (a && !scene.panels) {
    const horizontal = a.y.kind === 'band' && a.x.kind !== 'band'
    pts.sort((p, q) => (horizontal ? p.y - q.y || p.x - q.x : p.x - q.x || p.y - q.y))
  }
  // Values when every point has one; otherwise height on screen (higher is more).
  const byValue = pts.length > 0 && pts.every(p => p.value !== null)
  const values = pts.map(p => (byValue ? p.value! : -p.y))
  const max = Math.max(1, Math.min(1000, Math.floor(options.maxNotes ?? 120)))
  let keep = pts.map((_, i) => i)
  if (keep.length > max) keep = Array.from({ length: max }, (_, k) => Math.round((k * (pts.length - 1)) / (max - 1)))
  const n = keep.length
  const total = options.duration !== undefined && options.duration > 0 ? Math.min(600, options.duration) : Math.min(10, Math.max(1.5, n * 0.18))
  const step = n ? total / n : 0
  const lo = Math.max(20, options.minFrequency ?? 220)
  const hi = Math.max(lo, options.maxFrequency ?? 880)
  const picked = keep.map(i => values[i])
  const vMin = Math.min(...picked), vMax = Math.max(...picked)
  const notes: Note[] = keep.map((i, k) => {
    const t = vMax > vMin ? (values[i] - vMin) / (vMax - vMin) : 0.5
    return {
      time: Math.round(k * step * 1000) / 1000,
      duration: Math.round(Math.max(0.05, Math.min(0.3, step * 0.85)) * 1000) / 1000,
      frequency: Math.round(lo * Math.pow(hi / lo, t) * 100) / 100,
      value: values[i],
      label: pts[i].label
    }
  })
  return { ...(series !== undefined ? { series } : {}), notes, duration: n ? total : 0 }
}

/** A controller that never played (no audio, nothing to play). */
export function idleController(): SonifyController {
  return { stop() {}, playing: false, notes: [], done: Promise.resolve() }
}

type AudioCtor = new () => AudioContext

/** The page's AudioContext constructor, or null. */
export function audioContextOf(win: Window | null): AudioCtor | null {
  const w = win as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor } | null
  return w?.AudioContext ?? w?.webkitAudioContext ?? null
}

/**
 * Play a plan with Web Audio: one sine oscillator per note, a 10 ms attack and an exponential release, all
 * through one gain at `volume`. `onEnd` gets `true` when it played to the end, `false` when stopped.
 */
export function playNotes(Ctor: AudioCtor, plan: SonifyPlan, volume: number, onEnd: (finished: boolean) => void): SonifyController {
  const ctx = new Ctor()
  void ctx.resume?.()?.catch?.(() => {})
  const master = ctx.createGain()
  master.gain.value = Math.min(1, Math.max(0, volume))
  master.connect(ctx.destination)
  const t0 = ctx.currentTime + 0.05
  const oscs: OscillatorNode[] = []
  for (const n of plan.notes) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    const t = t0 + n.time
    o.type = 'sine'
    o.frequency.setValueAtTime(n.frequency, t)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(1, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.duration)
    o.connect(g)
    g.connect(master)
    o.start(t)
    o.stop(t + n.duration + 0.02)
    oscs.push(o)
  }
  let playing = true
  let resolve!: () => void
  const done = new Promise<void>(r => (resolve = r))
  const end = (finished: boolean): void => {
    if (!playing) return
    playing = false
    clearTimeout(timer)
    for (const o of oscs) {
      try { o.stop() } catch { /* already stopped */ }
      try { o.disconnect() } catch { /* already disconnected */ }
    }
    try { master.disconnect() } catch { /* already disconnected */ }
    void ctx.close?.()?.catch?.(() => {})
    onEnd(finished)
    resolve()
  }
  const timer = setTimeout(() => end(true), (plan.duration + 0.15) * 1000)
  return { stop: () => end(false), get playing() { return playing }, notes: plan.notes, done }
}
