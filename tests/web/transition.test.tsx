// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { SuperPlot } from '@supersolutions/super-plot-web'
import { defineSuperPlot } from '@supersolutions/super-plot-web/element'
import { SuperPlot as ReactPlot } from '@supersolutions/super-plot-react'
import { compilePlot, estimateWidth, type Scene } from '@supersolutions/super-plot-core'
import {
  TRANSITION_MAX_MS, datumIdentity, ease, frameScene, markKeys, parsePath, planTransition, samePathShape, shownAt, shownOf, transitionConf
} from '../../packages/bindings/web/src/transition'

// A deterministic clock: frames run only when the test steps time.
let now = 0
let frames = new Map<number, FrameRequestCallback>()
let nextId = 1
const step = (ms: number): void => {
  now += ms
  const due = [...frames.values()]
  frames = new Map()
  for (const cb of due) cb(now)
}
const pending = (): number => frames.size

const bars = (values: Record<string, number>, extra: Record<string, unknown> = {}): unknown => ({
  type: 'bar', x: 'team', y: 'count', data: Object.entries(values).map(([team, count]) => ({ team, count })), ...extra
})
const A = bars({ Payments: 40, Platform: 30, Growth: 10 })
const B = bars({ Payments: 80, Platform: 30, Mobile: 20 })
const C = bars({ Payments: 20, Platform: 60, Mobile: 50 })
const size = { width: 600, height: 400 }

let host: HTMLDivElement
const bar = (h: HTMLElement, label: string): SVGElement => [...h.querySelectorAll<SVGElement>('.sp-data')].find(r => r.getAttribute('aria-label')?.startsWith(label))!
/** A bar's height: bars with rounded top corners are paths (`M x y ... V bottom ...`). */
const height = (h: HTMLElement, label: string): number => {
  const el = bar(h, label)
  if (el.localName === 'rect') return Number(el.getAttribute('height'))
  const d = el.getAttribute('d')!
  return Number(/V(-?[\d.]+)/.exec(d)![1]) - Number(/^M-?[\d.]+ (-?[\d.]+)/.exec(d)![1])
}
/** The chart's SVG with this plot's id prefix taken out, for comparing two plots. */
const svgOf = (h: HTMLElement): string => h.querySelector('svg')!.outerHTML.replace(/\bsp\d+(?=-)/g, 'sp')
const direct = (spec: unknown, o: Record<string, unknown> = {}): string => {
  const h = document.createElement('div')
  document.body.appendChild(h)
  const p = new SuperPlot(h, spec, { ...size, ...o })
  const out = svgOf(h)
  p.dispose()
  h.remove()
  return out
}

beforeEach(() => {
  now = 0
  frames = new Map()
  nextId = 1
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; frames.set(id, cb); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as { matchMedia?: unknown }).matchMedia
  document.body.innerHTML = ''
})

describe('transition option', () => {
  it('is off by default, 300 ms eased when true, clamped to 1,000 ms, off at 0', () => {
    expect(transitionConf(undefined)).toBeNull()
    expect(transitionConf(false)).toBeNull()
    expect(transitionConf(true)).toEqual({ duration: 300, easing: 'cubic' })
    expect(transitionConf({})).toEqual({ duration: 300, easing: 'cubic' })
    expect(transitionConf({ duration: 5000, easing: 'linear' })).toEqual({ duration: TRANSITION_MAX_MS, easing: 'linear' })
    expect(transitionConf({ duration: Infinity })?.duration).toBe(1000)
    expect(transitionConf({ duration: 0 })).toBeNull()
    expect(transitionConf({ duration: -50 })).toBeNull()
    expect(transitionConf({ easing: 'bounce' as 'linear' })?.easing).toBe('cubic')
    expect(transitionConf('yes')).toBeNull()
  })
  it('eases from 0 to 1 without overshoot', () => {
    for (const k of ['linear', 'cubic'] as const) {
      let last = -1
      for (let t = -0.5; t <= 1.5; t += 0.05) {
        const e = ease(k, t)
        expect(e).toBeGreaterThanOrEqual(last)
        expect(e).toBeGreaterThanOrEqual(0)
        expect(e).toBeLessThanOrEqual(1)
        last = e
      }
      expect(ease(k, 0)).toBe(0)
      expect(ease(k, 1)).toBe(1)
    }
    expect(ease('linear', 0.25)).toBe(0.25)
    expect(ease('cubic', 0.25)).toBeLessThan(0.25)
  })
})

describe('matching', () => {
  it('names a mark by its text fields and numeric x; values and a scatter x are not names', () => {
    expect(datumIdentity({ x: 'Jan', series: 'A', value: 3 })).toBe('series=A\u001ex=Jan')
    expect(datumIdentity({ x: 4, series: 'A', value: 3 })).toBe('series=A\u001ex=4')
    expect(datumIdentity({ x: 4, y: 7, series: 'A' })).toBe('series=A')
    expect(datumIdentity({ path: ['Asia', 'Japan'], value: 3 })).toBe('path=Asia\u001fJapan')
    expect(datumIdentity({ y: 'Lane', start: '2026-01-01', end: '2026-02-01' })).toBe('y=Lane')
    expect(datumIdentity(undefined)).toBe('')
    const keys = markKeys([
      { type: 'rect', role: 'data', x: 0, y: 0, w: 1, h: 1, series: 'a', datum: { x: 'Jan', value: 1 } },
      { type: 'circle', role: 'data', cx: 0, cy: 0, r: 1, series: 'a' },
      { type: 'circle', role: 'data', cx: 0, cy: 0, r: 1, series: 'a' },
      { type: 'text', role: 'label', x: 0, y: 0, text: '1', size: 10, fill: '#000' }
    ])
    expect(keys.map(k => k?.key ?? null)).toEqual(['rect|a|x=Jan#0', 'circle|a|#0', 'circle|a|#1', null])
    expect(keys[1]!.byOrder).toBe(true)
    expect(keys[0]!.byOrder).toBe(false)
  })

  it('matches bars by category: kept ones move, a new one grows from the baseline, a gone one fades', () => {
    const a = compilePlot(A, { ...size, measure: estimateWidth })
    const b = compilePlot(B, { ...size, measure: estimateWidth })
    if (!a.ok || !b.ok) throw new Error('compile')
    const plan = planTransition(shownOf(a.scene), b.scene)
    const data = b.scene.marks.map((m, i) => ({ m, i })).filter(t => t.m.role === 'data')
    const item = (team: string) => plan.items.find(it => (it.to.datum as { x: string }).x === team)!
    // Payments is the tallest in both: it stays; Platform shrinks as the axis grows.
    expect(item('Payments').still).toBe(true)
    expect(item('Platform').a0).toBe(1)
    expect(item('Platform').still).toBe(false)
    expect(item('Platform').from).toBe(a.scene.marks.find(m => m.role === 'data' && (m.datum as { x: string }).x === 'Platform'))
    const mobile = item('Mobile')
    expect(mobile.from.type === 'rect' && mobile.from.h).toBe(0)
    // Grown from the zero line: the bottom edge of the final bar.
    expect(mobile.from.type === 'rect' && mobile.to.type === 'rect' && mobile.from.y).toBeCloseTo(mobile.to.type === 'rect' ? mobile.to.y + mobile.to.h : 0, 5)
    expect(plan.leaving.map(s => (s.mark.datum as { x: string }).x)).toEqual(['Growth'])
    expect(plan.items).toHaveLength(data.length)
    expect(plan.moving).toBe(true)
    // At the end, the scene drawn is the new one itself.
    expect(frameScene(plan, 1)).toBe(b.scene)
    const mid = frameScene(plan, 0.5)
    expect(mid.marks.length).toBe(b.scene.marks.length + 1)
  })

  it('interpolates paths with the same commands, cross-fades the rest', () => {
    const p = parsePath('M0 0L10 10L20 0Z')!
    const q = parsePath('M0 10L10 20L20 10Z')!
    expect(samePathShape(p, q)).toBe(true)
    expect(samePathShape(p, parsePath('M0 0L10 10Z')!)).toBe(false)
    expect(samePathShape(parsePath('M0 0A5 5 0 0 1 10 0')!, parsePath('M0 0A5 5 0 1 1 10 0')!)).toBe(false)
    expect(parsePath('M0 0L1')).toBeNull()
    expect(parsePath('nonsense')).toBeNull()
    const line = (d: string): Scene => ({ width: 10, height: 10, background: '#fff', title: '', description: '', type: 'line', series: [], marks: [{ type: 'path', role: 'data', series: 's', d, stroke: '#000' }] })
    const morph = planTransition(shownOf(line('M0 0L10 10')), line('M0 10L10 0'))
    expect(morph.leaving).toHaveLength(0)
    expect((frameScene(morph, 0.5).marks[0] as { d: string }).d).toBe('M0 5L10 5')
    const fade = planTransition(shownOf(line('M0 0L10 10')), line('M0 10L5 5L10 0'))
    expect(fade.leaving).toHaveLength(1)
    expect(fade.items[0].a0).toBe(0)
    // Appended rows: a mark named only by its position cross-fades instead of sliding to another row's value.
    const appended = planTransition(shownOf(line('M0 0L10 10')), line('M0 10L10 0'), { orderFade: true })
    expect(appended.leaving).toHaveLength(1)
    // Nothing changed: nothing moves.
    expect(planTransition(shownOf(line('M0 0L10 10')), line('M0 0L10 10')).moving).toBe(false)
  })

  it('a plan cut short hands over what is on screen, keyed', () => {
    const a = compilePlot(A, { ...size, measure: estimateWidth })
    const b = compilePlot(B, { ...size, measure: estimateWidth })
    if (!a.ok || !b.ok) throw new Error('compile')
    const plan = planTransition(shownOf(a.scene), b.scene)
    const mid = shownAt(plan, 0.5)
    const growth = mid.find(s => (s.mark.datum as { x: string }).x === 'Growth')!
    expect(growth.alpha).toBeCloseTo(0.5)
    const mobile = mid.find(s => (s.mark.datum as { x: string }).x === 'Mobile')!
    expect(mobile.alpha).toBe(1)
    expect(mobile.mark.type === 'rect' && mobile.mark.h).toBeGreaterThan(0)
    // Back to A: Growth returns from its half-faded copy, Mobile shrinks away from where it is.
    const back = planTransition(mid, a.scene)
    expect(back.items.find(it => (it.to.datum as { x: string }).x === 'Growth')!.a0).toBeCloseTo(0.5)
    expect(back.leaving.map(s => (s.mark.datum as { x: string }).x)).toEqual(['Mobile'])
  })
})

describe('SuperPlot with transition (SVG)', async () => {
  it('moves matched bars over the duration and ends exactly as a direct render', async () => {
    const p = new SuperPlot(host, A, { ...size, transition: { duration: 300, easing: 'linear' } })
    await p.ready()
    // First draw: no transition (the entrance covers it).
    expect(pending()).toBe(0)
    const h0 = height(host, 'Platform')
    p.setSpec(B)
    // Tooltips, aria and the scene are the new state at once; only geometry is in between.
    expect(p.getScene()!.marks.some(m => m.aria?.startsWith('Mobile'))).toBe(true)
    expect(bar(host, 'Payments').getAttribute('aria-label')).toContain('80')
    expect(host.querySelector('.sp-root')!.classList.contains('sp-enter')).toBe(false)
    const ghost = host.querySelector('g.sp-ghost')!
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.getAttribute('pointer-events')).toBe('none')
    expect(ghost.querySelectorAll('[data-i],[tabindex],[aria-label]')).toHaveLength(0)
    expect(height(host, 'Platform')).toBeCloseTo(h0, 1)
    expect(height(host, 'Mobile')).toBe(0)
    step(150)
    const h1 = height(host, 'Platform')
    expect(ghost.getAttribute('opacity')).toBe('0.5')
    step(100)
    const h2 = height(host, 'Platform')
    // Platform shrinks as the axis grows for Payments' 80.
    expect(h1).toBeLessThan(h0)
    expect(h2).toBeLessThan(h1)
    step(100)
    expect(pending()).toBe(0)
    expect(host.querySelector('g.sp-ghost')).toBeNull()
    expect(host.querySelector('.sp-moving')).toBeNull()
    expect(svgOf(host)).toBe(direct(B))
  })

  it('is off by default: setSpec draws the new state at once (and replays the entrance, as before)', async () => {
    const p = new SuperPlot(host, A, size)
    p.setSpec(B)
    expect(pending()).toBe(0)
    expect(host.querySelector('g.sp-ghost')).toBeNull()
    expect(host.querySelector('.sp-root')!.classList.contains('sp-enter')).toBe(true)
    expect(svgOf(host)).toBe(direct(B))
  })

  it('never runs under prefers-reduced-motion, checked live', async () => {
    let reduce = true
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduced-motion') && reduce, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    const p = new SuperPlot(host, A, { ...size, transition: true })
    await p.ready()
    p.setSpec(B)
    expect(pending()).toBe(0)
    expect(svgOf(host)).toBe(direct(B))
    // Turned on mid-flight: the next frame jumps to the end.
    reduce = false
    p.setSpec(C)
    expect(host.querySelector('g.sp-ghost')).toBeNull()
    expect(pending()).toBe(1)
    reduce = true
    step(16)
    expect(pending()).toBe(0)
    expect(svgOf(host)).toBe(direct(C))
  })

  it('never runs on a hidden page', async () => {
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const p = new SuperPlot(host, A, { ...size, transition: true })
    await p.ready()
    p.setSpec(B)
    expect(pending()).toBe(0)
    vis.mockRestore()
    p.setSpec(C)
    expect(pending()).toBe(1)
  })

  it('a new update cancels the one in flight and starts from where the marks are', async () => {
    const p = new SuperPlot(host, A, { ...size, transition: { duration: 400, easing: 'linear' } })
    await p.ready()
    p.setSpec(B)
    step(200)
    const mid = height(host, 'Platform')
    const midMobile = height(host, 'Mobile')
    expect(midMobile).toBeGreaterThan(0)
    p.setSpec(C)
    // One transition at a time, starting at the in-between heights.
    expect(pending()).toBe(1)
    expect(host.querySelectorAll('g.sp-ghost')).toHaveLength(1)
    expect(height(host, 'Platform')).toBeCloseTo(mid, 1)
    expect(height(host, 'Mobile')).toBeCloseTo(midMobile, 1)
    step(400)
    expect(pending()).toBe(0)
    expect(svgOf(host)).toBe(direct(C))
  })

  it('is clamped to 1,000 ms', async () => {
    const p = new SuperPlot(host, A, { ...size, transition: { duration: 60000 } })
    await p.ready()
    p.setSpec(B)
    step(999)
    expect(pending()).toBe(1)
    step(2)
    expect(pending()).toBe(0)
    expect(svgOf(host)).toBe(direct(B))
  })

  it('legend toggles move the remaining series; resizes and other redraws snap', async () => {
    const two = { type: 'bar', x: 'q', y: ['a', 'b'], stack: 'stack', data: [{ q: 'Q1', a: 3, b: 4 }, { q: 'Q2', a: 5, b: 2 }] }
    const p = new SuperPlot(host, two, { ...size, transition: true })
    await p.ready()
    host.querySelector<SVGElement>('[data-lk="a"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(p.getHidden()).toEqual(['a'])
    expect(pending()).toBe(1)
    step(400)
    expect(pending()).toBe(0)
    // A theme change is not new data.
    p.setOptions({ theme: 'dark' })
    expect(pending()).toBe(0)
    // Hiding through setOptions is.
    p.setOptions({ hidden: [] })
    expect(pending()).toBe(1)
    step(400)
    expect(svgOf(host)).toBe(direct(two, { theme: 'dark' }))
  })

  it('does not run during a gesture, or for another chart type', async () => {
    const p = new SuperPlot(host, A, { ...size, transition: true })
    await p.ready()
    const axis = (p as unknown as { axis: { dragging: () => boolean } }).axis
    const was = axis.dragging
    axis.dragging = () => true
    p.setSpec(B)
    expect(pending()).toBe(0)
    axis.dragging = was
    p.setSpec({ type: 'pie', label: 'team', value: 'count', data: [{ team: 'a', count: 1 }, { team: 'b', count: 2 }] })
    expect(pending()).toBe(0)
  })

  it('appendRows animates a slow stream, and snaps when rows come faster than the duration', async () => {
    const line = { type: 'bar', x: 't', y: 'v', data: [{ t: 'a', v: 1 }, { t: 'b', v: 2 }] }
    const p = new SuperPlot(host, line, { ...size, transition: { duration: 300 } })
    await p.ready()
    p.appendRows([{ t: 'c', v: 3 }])
    step(16) // the append's own frame draws and starts the transition
    expect(pending()).toBe(1)
    p.appendRows([{ t: 'd', v: 4 }])
    step(50) // too soon after the last one: straight to the end state
    expect(pending()).toBe(0)
    expect(host.querySelector('g.sp-ghost')).toBeNull()
    expect(svgOf(host)).toBe(direct({ ...line, data: [...line.data, { t: 'c', v: 3 }, { t: 'd', v: 4 }] }))
    step(1000)
    p.appendRows([{ t: 'e', v: 5 }])
    step(16)
    expect(pending()).toBe(1)
  })

  it('above 5,000 data marks it snaps', async () => {
    const dots = (n: number, k: number): unknown => ({ type: 'scatter', x: 'x', y: 'y', data: Array.from({ length: n }, (_, i) => ({ x: i, y: (i * k) % 97 })) })
    const p = new SuperPlot(host, dots(5001, 3), { ...size, transition: true, renderer: 'svg' })
    await p.ready()
    p.setSpec(dots(5001, 5))
    expect(pending()).toBe(0)
  })

  it('does not plan for WebGL', async () => {
    const p = new SuperPlot(host, A, { ...size, transition: true })
    await p.ready()
    const planFor = (p as unknown as { planFor: (...a: unknown[]) => unknown }).planFor.bind(p)
    expect(planFor(p.getScene(), p.getScene(), 'data', 'webgl')).toBeNull()
  })
})

describe('SuperPlot with transition (canvas)', async () => {
  const calls: string[] = []
  const GEOM = ['moveTo', 'lineTo', 'arcTo', 'arc', 'fillRect', 'fillText']
  beforeEach(() => {
    calls.length = 0
    HTMLCanvasElement.prototype.getContext = (() => {
      const ctx: Record<string, unknown> = { globalAlpha: 1 }
      for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform', 'measureText']) {
        ctx[k] = k === 'measureText' ? (t: string) => ({ width: t.length * 6 }) : (...a: unknown[]) => calls.push(GEOM.includes(k) ? `${k} ${a.map(v => (typeof v === 'number' ? Math.round(v * 100) / 100 : String(v))).join(' ')}` : k)
      }
      ctx.isPointInPath = () => false
      return ctx
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext
  })

  it('redraws each frame, keeps hit testing and the keyboard on the final scene, and runs afterDraw again at the end', async () => {
    const afterDraw = vi.fn()
    const p = new SuperPlot(host, A, { ...size, renderer: 'canvas', transition: { duration: 300 }, plugins: [{ name: 'spy', afterDraw }] })
    await p.ready()
    expect(afterDraw).toHaveBeenCalledTimes(1)
    p.setSpec(B)
    expect(afterDraw).toHaveBeenCalledTimes(2)
    const layer = (p as unknown as { layer: { scene: Scene } }).layer
    expect(layer.scene).toBe(p.getScene())
    const before = calls.length
    step(100)
    expect(calls.length).toBeGreaterThan(before)
    expect(calls.slice(before)).toContain('clearRect')
    expect(afterDraw).toHaveBeenCalledTimes(2)
    step(300)
    expect(pending()).toBe(0)
    // Frames wiped what the plugin drew: it draws again on the final picture.
    expect(afterDraw).toHaveBeenCalledTimes(3)
    expect(afterDraw.mock.calls[2][0].scene).toBe(p.getScene())
    // The final frame draws the same as drawing B directly.
    const mark = calls.length
    const q = new SuperPlot(document.body.appendChild(document.createElement('div')), B, { ...size, renderer: 'canvas' })
    const directCalls = calls.slice(mark)
    const finalFrame: string[] = []
    calls.length = 0
    ;(p as unknown as { layer: { paintFrame: (s: Scene) => void } }).layer.paintFrame(p.getScene()!)
    finalFrame.push(...calls)
    const geom = (c: string[]): string[] => c.filter(s => GEOM.includes(s.split(' ')[0]))
    expect(geom(finalFrame).length).toBeGreaterThan(10)
    expect(geom(finalFrame)).toEqual(geom(directCalls))
    // And a frame in between draws other bar positions, plus the fading copy of the gone bar.
    calls.length = 0
    ;(p as unknown as { layer: { paintFrame: (s: Scene) => void } }).layer.paintFrame(frameScene(planTransition(shownOf((compilePlot(A, { ...size, measure: estimateWidth }) as { scene: Scene }).scene), p.getScene()!), 0.5))
    expect(geom(calls)).not.toEqual(geom(directCalls))
    q.dispose()
  })
})

describe('bindings pass the option through', () => {
  it('React', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const ref = createRef<SuperPlot | null>()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => root.render(<ReactPlot ref={ref} spec={A} width={600} height={400} transition={{ duration: 200 }} />))
    const opts = (): unknown => (ref.current as unknown as { options: { transition?: unknown } }).options.transition
    expect(opts()).toEqual({ duration: 200 })
    await act(async () => root.render(<ReactPlot ref={ref} spec={A} width={600} height={400} transition={false} />))
    expect(opts()).toBe(false)
    await act(async () => root.unmount())
  })

  it('<super-plot>: the transition attribute and the options property', () => {
    defineSuperPlot()
    const el = document.createElement('super-plot') as HTMLElement & { instance: SuperPlot | null; options: object }
    el.setAttribute('transition', '250')
    el.setAttribute('spec', JSON.stringify(A))
    document.body.appendChild(el)
    const opts = (): unknown => (el.instance as unknown as { options: { transition?: unknown } }).options.transition
    expect(opts()).toEqual({ duration: 250 })
    el.setAttribute('transition', '')
    expect(opts()).toBe(true)
    el.setAttribute('transition', 'false')
    expect(opts()).toBe(false)
    el.removeAttribute('transition')
    el.options = { transition: { easing: 'linear' } }
    expect(opts()).toEqual({ easing: 'linear' })
  })
})
