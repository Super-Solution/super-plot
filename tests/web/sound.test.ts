// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot, sonifyNotes } from '@supersolutions/super-plot-web'
import { chartCatalog, compilePlot, type Issue } from '@supersolutions/super-plot-core'

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

/** A Web Audio stand-in that records what was scheduled. */
class FakeAudio {
  static made: FakeAudio[] = []
  currentTime = 0
  destination = {}
  closed = false
  oscs: { freq: number; started: number; stopped: number[]; type: string }[] = []
  gains: { value: number; ramps: [string, number, number][] }[] = []
  constructor() { FakeAudio.made.push(this) }
  resume(): Promise<void> { return Promise.resolve() }
  close(): Promise<void> { this.closed = true; return Promise.resolve() }
  createGain(): unknown {
    const g = { value: 1, ramps: [] as [string, number, number][] }
    this.gains.push(g)
    return {
      gain: {
        set value(v: number) { g.value = v },
        get value() { return g.value },
        setValueAtTime: (v: number, t: number) => g.ramps.push(['set', v, t]),
        linearRampToValueAtTime: (v: number, t: number) => g.ramps.push(['lin', v, t]),
        exponentialRampToValueAtTime: (v: number, t: number) => g.ramps.push(['exp', v, t])
      },
      connect() {}, disconnect() {}
    }
  }
  createOscillator(): unknown {
    const o = { freq: 0, started: -1, stopped: [] as number[], type: '' }
    this.oscs.push(o)
    return {
      set type(v: string) { o.type = v },
      frequency: { setValueAtTime: (f: number) => { o.freq = f } },
      connect() {}, disconnect() {},
      start: (t: number) => { o.started = t },
      stop: (t?: number) => { o.stopped.push(t ?? -1) }
    }
  }
}

const line = { type: 'line', title: 'Visits', x: 'x', y: 'y', data: [{ x: 3, y: 30 }, { x: 1, y: 10 }, { x: 2, y: 50 }, { x: 4, y: 20 }] }
const bar = chartCatalog().find(c => c.type === 'bar')!.example
const pie = chartCatalog().find(c => c.type === 'pie')!.example
let host: HTMLDivElement
beforeEach(() => {
  FakeAudio.made = []
  host = document.createElement('div')
  host.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
  document.body.appendChild(host)
})
afterEach(() => {
  document.body.innerHTML = ''
  delete (window as { AudioContext?: unknown }).AudioContext
  vi.useRealTimers()
})

const scene = (spec: unknown) => {
  const r = compilePlot(spec, { width: 600, height: 400 })
  if (!r.ok) throw new Error('bad spec')
  return r.scene
}

describe('sonifyNotes (pure)', () => {
  it('plays a line in x order, higher values higher, from minFrequency to maxFrequency', () => {
    const plan = sonifyNotes(scene(line))
    expect(plan.notes.map(n => n.label)).toEqual(['1: y 10', '2: y 50', '3: y 30', '4: y 20'])
    const f = plan.notes.map(n => n.frequency)
    expect(f[0]).toBe(220)
    expect(f[1]).toBe(880)
    expect(f[2]).toBeGreaterThan(f[3])
    expect(f[3]).toBeGreaterThan(f[0])
    expect(plan.notes.map(n => n.time)).toEqual([0, 0.375, 0.75, 1.125])
    expect(plan.duration).toBe(1.5)
    expect(plan.notes.every(n => n.duration > 0 && n.duration <= 0.3)).toBe(true)
  })

  it('reads the first visible series of a bar chart by its values', () => {
    const plan = sonifyNotes(scene(bar))
    expect(plan.series).toBe('Q1')
    expect(plan.notes[0].label).toBe('APAC: Q1 120')
    const values = plan.notes.map(n => n.value)
    const q1 = (bar as { data: Record<string, number | string>[] }).data.map(r => r.Q1)
    expect(values).toEqual(q1)
    const hidden = compilePlot(bar, { width: 600, height: 400, hidden: ['Q1'] })
    if (!hidden.ok) throw new Error('bad spec')
    expect(sonifyNotes(hidden.scene).series).toBe('Q2')
  })

  it('a pie plays its slices; options set the range, the length and the number of notes', () => {
    const plan = sonifyNotes(scene(pie))
    expect(plan.series).toBeUndefined()
    expect(plan.notes.length).toBe((pie as { data: unknown[] }).data.length)
    const long = { type: 'line', x: 'x', y: 'y', data: Array.from({ length: 500 }, (_, i) => ({ x: i, y: Math.sin(i / 20) })) }
    const p = sonifyNotes(scene(long), { maxNotes: 50, duration: 5, minFrequency: 300, maxFrequency: 600 })
    expect(p.notes).toHaveLength(50)
    expect(p.duration).toBe(5)
    expect(Math.min(...p.notes.map(n => n.frequency))).toBeGreaterThanOrEqual(300)
    expect(Math.max(...p.notes.map(n => n.frequency))).toBeLessThanOrEqual(600)
    expect(sonifyNotes(scene(long))).toEqual(sonifyNotes(scene(long)))
  })
})

describe('plot.sonify()', () => {
  it('without Web Audio: a controller that did nothing and a warning, no throw', () => {
    const issues: Issue[][] = []
    const p = new SuperPlot(host, line, { width: 600, height: 400, onIssues: i => issues.push(i) })
    const c = p.sonify()
    expect(c.playing).toBe(false)
    expect(c.notes).toEqual([])
    expect(() => c.stop()).not.toThrow()
    expect(issues.at(-1)!.find(i => i.code === 'sonify_unavailable')!.severity).toBe('warning')
  })

  it('schedules one gentle note per value, announces start and end', async () => {
    vi.useFakeTimers()
    ;(window as { AudioContext?: unknown }).AudioContext = FakeAudio
    const p = new SuperPlot(host, line, { width: 600, height: 400 })
    const c = p.sonify({ volume: 0.5 })
    const ac = FakeAudio.made[0]
    expect(c.playing).toBe(true)
    expect(ac.oscs.map(o => o.freq)).toEqual(c.notes.map(n => n.frequency))
    expect(ac.oscs.every(o => o.type === 'sine' && o.started >= 0.05)).toBe(true)
    expect(ac.gains[0].value).toBe(0.5)
    // Envelope: silent, quick attack, exponential release.
    expect(ac.gains[1].ramps.map(r => r[0])).toEqual(['set', 'lin', 'exp'])
    const live = host.querySelector<HTMLElement>('.sp-root > .sp-live')!
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toMatch(/^Playing Visits, y: 4 notes, left to right/)
    vi.advanceTimersByTime(2000)
    await c.done
    expect(c.playing).toBe(false)
    expect(ac.closed).toBe(true)
    expect(live.textContent).toBe('Finished playing Visits.')
  })

  it('a second call stops the first; dispose stops it', () => {
    ;(window as { AudioContext?: unknown }).AudioContext = FakeAudio
    const p = new SuperPlot(host, line, { width: 600, height: 400 })
    const a = p.sonify()
    const b = p.sonify()
    expect(a.playing).toBe(false)
    expect(FakeAudio.made[0].closed).toBe(true)
    expect(b.playing).toBe(true)
    p.dispose()
    expect(b.playing).toBe(false)
    expect(FakeAudio.made[1].closed).toBe(true)
  })

  it('the toolbar sound button starts and stops it', () => {
    ;(window as { AudioContext?: unknown }).AudioContext = FakeAudio
    const p = new SuperPlot(host, line, { width: 600, height: 400, toolbar: ['sound'] })
    const btn = host.querySelector<HTMLButtonElement>('[data-tool="sound"]')!
    expect(btn.getAttribute('aria-label')).toBe('Play as sound')
    btn.click()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(FakeAudio.made).toHaveLength(1)
    btn.click()
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(FakeAudio.made[0].closed).toBe(true)
    expect(host.querySelector('.sp-root > .sp-live')!.textContent).toBe('Stopped playing.')
    p.dispose()
  })

  it('on canvas it announces through the canvas view: one live region per chart', () => {
    ;(window as { AudioContext?: unknown }).AudioContext = FakeAudio
    const prev = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = (() => {
      const c: Record<string, unknown> = { globalAlpha: 1, isPointInPath: () => false, measureText: (t: string) => ({ width: t.length * 6 }) }
      for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform']) c[k] = () => {}
      return c
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext
    try {
      const p = new SuperPlot(host, line, { width: 600, height: 400, renderer: 'canvas' })
      expect(p.getRenderer()).toBe('canvas')
      p.sonify()
      const live = host.querySelectorAll('.sp-live')
      expect(live).toHaveLength(1)
      expect(live[0].textContent).toMatch(/^Playing Visits/)
      p.dispose()
    } finally {
      HTMLCanvasElement.prototype.getContext = prev
    }
  })

  it('an invalid spec warns instead of playing', () => {
    ;(window as { AudioContext?: unknown }).AudioContext = FakeAudio
    const issues: Issue[][] = []
    const p = new SuperPlot(host, { type: 'line', x: 'nope', y: 'y', data: [{ y: 1 }] }, { width: 600, height: 400, onIssues: i => issues.push(i) })
    expect(p.sonify().playing).toBe(false)
    expect(FakeAudio.made).toHaveLength(0)
    expect(issues.at(-1)!.some(i => i.code === 'sonify_empty')).toBe(true)
  })
})
