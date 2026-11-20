// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLOT_FALLBACK_MESSAGE, validateChatPlugin } from '@supersolutions/super-protocol'
import { createPlotChatPlugin, PLOT_CARD_KIND, PLOT_LIMITS, validatePlotCardSpec, type PlotCardHandle, type PlotChatPlugin } from '@supersolutions/super-plot-chat-plugin'
import { parseCardRef, validatePlot, type CardRef } from '@supersolutions/super-plot-core'
import cases from './plot-card.cases.json'

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
const plotSpec = (): Record<string, any> => ({
  type: 'bar',
  title: 'Sales',
  x: 'month',
  y: 'sales',
  annotations: [{ axis: 'y', value: 50, label: 'Goal', key: 'goal' }],
  data: MONTHS.map((month, i) => ({ month, sales: [40, 55, 90, 60, 45, 70][i] }))
})
const cardOf = (id: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ kind: PLOT_CARD_KIND, ...(id ? { id } : {}), spec: plotSpec(), alt: 'Monthly sales, highest in March.', ...extra })
const ctx = { theme: 'light' as const }
/** The host hands the handle a parsed reference. */
const R = (text: string): CardRef => {
  const p = parseCardRef(text)
  if (!p.ok) throw new Error(p.error)
  return p.ref
}

let plugin: PlotChatPlugin
let box: HTMLDivElement
const mounted: PlotCardHandle[] = []
const show = (card: unknown, context: Record<string, unknown> = ctx, into?: HTMLElement): PlotCardHandle => {
  const el = into ?? document.createElement('div')
  if (!into) box.appendChild(el)
  el.getBoundingClientRect = () => ({ width: 600, height: 0, top: 0, left: 0, right: 600, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect
  const h = plugin.mounts[PLOT_CARD_KIND](el, card, context as never)
  mounted.push(h)
  return h
}
const tool = (name: string) => (input?: unknown): Promise<any> => plugin.tools.find(t => t.name === name)!.run(input, {})
const outlined = (root: ParentNode = document): number => root.querySelector('svg.sp-ref')?.querySelectorAll('.sp-ref-o > *').length ?? 0

beforeEach(() => {
  plugin = createPlotChatPlugin({ plot: { animate: false } })
  box = document.createElement('div')
  document.body.appendChild(box)
})
afterEach(() => {
  for (const h of mounted.splice(0)) h.destroy()
  document.body.innerHTML = ''
})

describe('the plugin', () => {
  it('is a valid chat plugin: manifest, card kind, mount and one capability per tool', () => {
    expect(validateChatPlugin(plugin)).toEqual([])
    expect(plugin.manifest.name).toBe('@supersolutions/super-plot-chat-plugin')
    expect(plugin.cardKinds!.map(k => k.kind)).toEqual(['super.plot'])
    expect(plugin.tools.map(t => [t.name, t.authority])).toEqual([
      ['plot_state', 'read'], ['plot_data', 'read'], ['plot_resolve', 'read'],
      ['plot_highlight', 'draft'], ['plot_annotate', 'draft'], ['plot_clear_annotations', 'act']
    ])
    for (const t of plugin.tools) expect(t.inputSchema.properties).toHaveProperty('card')
  })

  it('validates cards exactly as the protocol does (its conformance cases)', () => {
    expect(cases.plot_card).toHaveLength(64)
    for (const c of cases.plot_card) expect(validatePlotCardSpec(c.value)).toEqual(c.expect)
    expect(PLOT_LIMITS).toEqual({ alt: 2048, idLength: 128, height: [160, 1200] })
  })
})

describe('the card', () => {
  it('draws the plot with its title, its alt as the figure name and its height', () => {
    show(cardOf('sales', { title: 'Monthly sales', height: 300 }))
    const fig = box.querySelector('figure')!
    expect(fig.getAttribute('aria-label')).toBe('Monthly sales, highest in March.')
    expect(fig.querySelector('.spc-title')!.textContent).toBe('Monthly sales')
    expect(fig.querySelector<HTMLElement>('.spc-plot')!.style.height).toBe('300px')
    expect(fig.querySelector('svg [data-i]')).not.toBeNull()
  })

  it('says so while the card streams in and when it is not a valid card', () => {
    const h = show(cardOf('s'), { ...ctx, partial: true })
    expect(box.querySelector('[role="status"]')!.textContent).toMatch(/still being written/)
    expect(h.ref(R('ref:s'), 'enter')).toMatchObject({ ok: false, code: 'card_not_ready' })
    // A card it cannot show: the reader gets the protocol's plain line (and the card's alt when it has one); the
    // validator's reason goes to the console, never the screen.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.update({ kind: PLOT_CARD_KIND, spec: plotSpec() }, ctx)
    expect(box.querySelector('[role="status"]')!.textContent).toBe(PLOT_FALLBACK_MESSAGE)
    h.update({ kind: PLOT_CARD_KIND, spec: { type: 'bar' }, alt: 'Revenue rose each month.', height: -1 }, ctx)
    expect(box.querySelector('[role="status"]')!.textContent).toBe(`${PLOT_FALLBACK_MESSAGE} Revenue rose each month.`)
    expect(box.textContent).not.toMatch(/alt must|height|super\.plot|Expected/)
    expect(String(warn.mock.calls[0]![0])).toMatch(/alt must be a non-empty string/)
    warn.mockRestore()
    h.update(cardOf('s'), ctx)
    expect(box.querySelector('svg')).not.toBeNull()
  })

  it('follows the host theme with safe values only', () => {
    show(cardOf('t'), { theme: 'dark', hostTheme: { mode: 'dark', tokens: { background: '#101010', text: 'url(javascript:x)', 'font-sans': 'Inter, sans-serif' } } })
    const fig = box.querySelector<HTMLElement>('figure')!
    expect(fig.style.getPropertyValue('--sp-background')).toBe('#101010')
    expect(fig.style.getPropertyValue('--sp-text')).toBe('')
    expect(fig.style.getPropertyValue('--sp-font')).toBe('Inter, sans-serif')
  })

  it('answers references: enter highlights, leave clears, activate reveals', () => {
    const h = show(cardOf('sales'))
    expect(h.ref(R('ref:sales?x=2026-03'), 'enter')).toEqual({ ok: true, label: expect.stringContaining('2026-03') })
    expect(outlined(box)).toBe(1)
    expect(h.ref(R('ref:sales?x=2026-03'), 'leave')).toEqual({ ok: true })
    expect(outlined(box)).toBe(0)
    expect(h.ref({ target: 'sales', params: { x: ['2026-05'] } }, 'activate').ok).toBe(true)
    expect(box.contains(document.activeElement)).toBe(true)
    expect(outlined(box)).toBe(1)
    // Focus left the link for the plot: what the click revealed stays until the viewer moves or it is cleared.
    expect(h.ref(R('ref:sales?x=2026-05'), 'leave')).toEqual({ ok: true })
    expect(outlined(box)).toBe(1)
    expect(h.ref(null, 'leave')).toEqual({ ok: true })
    expect(outlined(box)).toBe(0)
    expect(h.ref(R('ref:sales?x=1999'), 'enter')).toMatchObject({ ok: false, code: 'ref_no_match' })
    expect(h.ref(R('ref:sales?colour=red'), 'activate')).toMatchObject({ ok: false, code: 'ref_param_unknown' })
  })

  it('keeps what a click revealed when the host sends leave as focus moves into the plot', () => {
    const h = show(cardOf('sales'))
    const link = document.createElement('a')
    link.href = '#'
    document.body.appendChild(link)
    const ref = R('ref:sales?x=2026-01..2026-03')
    link.addEventListener('focusin', () => h.ref(ref, 'enter'))
    link.addEventListener('focusout', () => h.ref(ref, 'leave'))
    link.focus()
    expect(outlined(box)).toBe(3)
    expect(h.ref(ref, 'activate').ok).toBe(true)
    expect(box.contains(document.activeElement)).toBe(true)
    expect(outlined(box)).toBe(3)
  })

  it('keeps the plot when the same card is updated', () => {
    const h = show(cardOf('sales'))
    const root = box.querySelector('.sp-root')
    h.ref(R('ref:sales?x=2026-02'), 'enter')
    h.update(cardOf('sales', { title: 'New title' }), ctx)
    expect(box.querySelector('.sp-root')).toBe(root)
    expect(box.querySelector('.spc-title')!.textContent).toBe('New title')
    expect(outlined(box)).toBe(1)
  })
})

describe('finding the card', () => {
  it('uses the newest card, the one named, or the one the reference names; else lists what is on screen', async () => {
    const state = tool('plot_state')
    await expect(state()).rejects.toThrow('No plot card is on screen')
    show(cardOf('a'))
    show(cardOf('b'))
    expect((await state()).card).toBe('b')
    expect((await state({ card: 'a' })).cards).toEqual(['a', 'b'])
    await expect(state({ card: 'zz' })).rejects.toThrow('No plot card "zz" is on screen. On screen: a, b.')
    await expect(state({ card: 3 })).rejects.toThrow(TypeError)
    await expect(state('x')).rejects.toThrow(TypeError)
    expect((await tool('plot_resolve')({ ref: 'ref:a?x=2026-01' })).card).toBe('a')
    expect((await tool('plot_resolve')({ ref: 'ref:other?x=2026-01' })).card).toBe('b')
    // A card without an id gets one; destroyed cards are gone.
    const h = show(cardOf(undefined))
    expect((await state()).card).toMatch(/^plot-\d+$/)
    h.destroy()
    expect((await state()).card).toBe('b')
  })
})

describe('tools', () => {
  it('plot_state reads the card', async () => {
    show(cardOf('sales'))
    const s = await tool('plot_state')()
    expect(s).toMatchObject({ card: 'sales', type: 'bar', renderer: 'svg', rows: 6, columns: ['month', 'sales'], hidden: [], zoom: null, issues: [], highlight: null, alt: 'Monthly sales, highest in March.' })
    expect(s.description).toMatch(/bar/i)
    expect(s.annotations.plot).toHaveLength(1)
    expect(s.annotations.agent).toEqual([])
  })

  it('plot_data pages the rows, narrows them by reference and checks its arguments', async () => {
    show(cardOf('sales'))
    const data = tool('plot_data')
    const all = await data()
    expect(all).toMatchObject({ ok: true, total: 6, offset: 0, more: false, columns: ['month', 'sales'] })
    expect(all.rows[2]).toEqual({ index: 2, row: { month: '2026-03', sales: 90 } })
    const page = await data({ offset: 4, limit: 1 })
    expect(page.rows).toEqual([{ index: 4, row: { month: '2026-05', sales: 45 } }])
    expect(page.more).toBe(true)
    const q1 = await data({ ref: 'ref:sales?x=2026-01..2026-03' })
    expect(q1.rows.map((r: { index: number }) => r.index)).toEqual([0, 1, 2])
    expect(await data({ ref: 'ref:sales?y=lots' })).toMatchObject({ ok: false, code: 'ref_bad_value' })
    for (const limit of [0, 501, 1.5, '10']) await expect(data({ limit })).rejects.toThrow(RangeError)
    await expect(data({ offset: -1 })).rejects.toThrow(RangeError)
    await expect(data({ ref: 5 })).rejects.toThrow(TypeError)
    show(cardOf('broken', { spec: { type: 'bar', x: 'nope' } }))
    expect(await data({ card: 'broken' })).toMatchObject({ ok: false, code: 'ref_spec_invalid' })
  })

  it('plot_data returns at most 500 rows', async () => {
    const big = { type: 'scatter', x: 'x', y: 'y', data: Array.from({ length: 700 }, (_, i) => ({ x: i, y: i % 13 })) }
    show(cardOf('big', { spec: big }))
    const r = await tool('plot_data')({ limit: 500 })
    expect(r.rows).toHaveLength(500)
    expect(r.more).toBe(true)
    expect((await tool('plot_data')({ offset: 500, limit: 500 })).rows).toHaveLength(200)
  })

  it('plot_resolve says what a reference names without showing it', async () => {
    show(cardOf('sales'))
    const r = await tool('plot_resolve')({ ref: 'ref:sales?x=2026-03' })
    expect(r).toMatchObject({ card: 'sales', ok: true, count: 1, rows: [2], keys: [], more: false })
    expect(outlined(box)).toBe(0)
    expect(await tool('plot_resolve')({ ref: 'ref:sales?key=goal' })).toMatchObject({ ok: true, keys: ['goal'] })
    expect(await tool('plot_resolve')({ ref: 'ref:sales?series=x' })).toMatchObject({ ok: false, code: 'ref_param_unsupported' })
    expect(await tool('plot_resolve')({ ref: 'nope' })).toMatchObject({ ok: false, code: 'ref_invalid' })
    await expect(tool('plot_resolve')({})).rejects.toThrow(TypeError)
  })

  it('plot_highlight points until the viewer moves onto the plot', async () => {
    show(cardOf('sales'))
    const hl = tool('plot_highlight')
    expect(await hl({ ref: 'ref:sales?x=2026-04' })).toMatchObject({ card: 'sales', ok: true })
    expect(outlined(box)).toBe(1)
    expect((await tool('plot_state')()).highlight).toEqual({ by: 'agent', ref: 'ref:sales?x=2026-04' })
    box.querySelector('.sp-data[tabindex]')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(outlined(box)).toBe(0)
    expect((await tool('plot_state')()).highlight).toBeNull()
    await hl({ ref: 'ref:sales?x=2026-04' })
    expect(await hl({ ref: null })).toEqual({ card: 'sales', ok: true })
    expect(outlined(box)).toBe(0)
    expect(await hl({ ref: 'ref:sales?x=2030' })).toMatchObject({ ok: false, code: 'ref_no_match' })
    await expect(hl({})).rejects.toThrow(TypeError)
  })

  it('a highlight from the chat stays when the viewer moves', async () => {
    const h = show(cardOf('sales'))
    h.ref(R('ref:sales?x=2026-04'), 'enter')
    box.querySelector('.sp-data[tabindex]')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(outlined(box)).toBe(1)
  })

  it('plot_annotate merges by key, marks them as the assistant\'s and reports what it rejected', async () => {
    const changes: [string, unknown[]][] = []
    plugin = createPlotChatPlugin({ plot: { animate: false }, onChange: (c, a) => changes.push([c, a]) })
    show(cardOf('sales'))
    const annotate = tool('plot_annotate')
    const r = await annotate({ annotations: [{ key: 'peak', x: '2026-03', y: 90, label: 'Peak', note: 'Launch month.' }, { key: 'avg', axis: 'y', value: 60, label: 'Mean', by: 'author' }] })
    expect(r).toEqual({ card: 'sales', applied: ['peak', 'avg'], rejected: [], annotations: 2 })
    expect(changes.at(-1)![1]).toHaveLength(2)
    const scene = (await tool('plot_state')()).annotations.agent
    expect(scene.every((a: { by: string }) => a.by === 'assistant')).toBe(true)
    expect(box.querySelector('svg')!.textContent).toContain('✦ Peak')
    // Merge: a key again replaces it; the others stay.
    await annotate({ annotations: [{ key: 'avg', axis: 'y', value: 62, label: 'Mean' }] })
    expect((await tool('plot_state')()).annotations.agent.map((a: { key: string; value?: number }) => [a.key, a.value])).toEqual([['peak', undefined], ['avg', 62]])
    // A reference can name an agent annotation.
    expect(await tool('plot_resolve')({ ref: 'ref:sales?key=peak' })).toMatchObject({ ok: true, keys: ['peak'] })
    const bad = { key: 'oops', axis: 'y', label: 'No value' }
    const code = validatePlot({ ...plotSpec(), annotations: [...plotSpec().annotations, { ...bad, by: 'assistant' }] }).issues.find(i => i.path.startsWith('annotations[1]'))!.code
    const r2 = await annotate({ annotations: [7, { label: 'no key' }, { key: 'goal', axis: 'y', value: 1, label: 'Mine' }, bad, { key: 'long', axis: 'y', value: 3, label: 'L', note: 'n'.repeat(2049) }, { key: 'ok2', axis: 'y', value: 70, label: 'Fine' }] })
    expect(r2.applied).toEqual(['ok2'])
    expect(r2.rejected.map((x: { index: number; code: string }) => [x.index, x.code])).toEqual([[0, 'bad_type'], [1, 'key_missing'], [2, 'key_reserved'], [3, code], [4, 'string_truncated']])
    expect(r2.rejected.every((x: { reason: string }) => x.reason.length > 0)).toBe(true)
    expect(r2.annotations).toBe(3)
    // A rejected replacement keeps the annotation it would have replaced.
    await annotate({ annotations: [{ key: 'avg', axis: 'y', label: 'broken' }] })
    expect((await tool('plot_state')()).annotations.agent.find((a: { key: string }) => a.key === 'avg').value).toBe(62)
    // replace: only these.
    expect(await annotate({ annotations: [{ key: 'only', axis: 'y', value: 10, label: 'Only' }], replace: true })).toMatchObject({ applied: ['only'], annotations: 1 })
    // The plot's own annotation was never touched.
    expect((await tool('plot_state')()).annotations.plot).toEqual([{ axis: 'y', value: 50, label: 'Goal', key: 'goal' }])
  })

  it('plot_annotate holds the plot to 256 annotations, its own included', async () => {
    const spec = plotSpec()
    spec.annotations = Array.from({ length: 250 }, (_, i) => ({ axis: 'y', value: i, label: `o${i}`, key: `o${i}` }))
    show(cardOf('full', { spec }))
    const r = await tool('plot_annotate')({ annotations: Array.from({ length: 10 }, (_, i) => ({ key: `a${i}`, axis: 'y', value: i, label: `a${i}` })) })
    expect(r.applied).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'])
    expect(r.rejected.map((x: { key: string; code: string }) => [x.key, x.code])).toEqual(['a6', 'a7', 'a8', 'a9'].map(k => [k, 'too_many']))
    // Replacing one already there still works at the limit.
    expect((await tool('plot_annotate')({ annotations: [{ key: 'a0', axis: 'y', value: 99, label: 'a0' }] })).applied).toEqual(['a0'])
  })

  it('plot_annotate checks its arguments and the plot', async () => {
    show(cardOf('sales'))
    const annotate = tool('plot_annotate')
    await expect(annotate({})).rejects.toThrow(TypeError)
    await expect(annotate({ annotations: [] })).rejects.toThrow(TypeError)
    await expect(annotate({ annotations: [{ key: 'k' }], replace: 'yes' })).rejects.toThrow(TypeError)
    show(cardOf('broken', { spec: { type: 'bar', x: 'nope' } }))
    await expect(annotate({ card: 'broken', annotations: [{ key: 'k', axis: 'y', value: 1, label: 'x' }] })).rejects.toThrow(/does not validate/)
  })

  it('agent annotations come back when the host remounts the card, not when its plot changed', async () => {
    const h = show(cardOf('sales'))
    await tool('plot_annotate')({ annotations: [{ key: 'peak', x: '2026-03', y: 90, label: 'Peak' }] })
    h.destroy()
    expect(box.querySelector('svg')).toBeNull()
    show(cardOf('sales'))
    expect((await tool('plot_state')()).annotations.agent.map((a: { key: string }) => a.key)).toEqual(['peak'])
    expect(box.querySelector('svg')!.textContent).toContain('✦ Peak')
    // The same id with other data: a new plot, nothing kept.
    const spec = plotSpec()
    spec.data[0].sales = 41
    show(cardOf('sales', { spec }))
    expect((await tool('plot_state')()).annotations.agent).toEqual([])
  })

  it('plot_clear_annotations removes only the agent\'s, by key or all', async () => {
    show(cardOf('sales'))
    await tool('plot_annotate')({ annotations: ['a', 'b', 'c'].map((key, i) => ({ key, axis: 'y', value: 10 * (i + 1), label: key })) })
    const clear = tool('plot_clear_annotations')
    expect(await clear({ keys: ['b', 'zz', 'goal'] })).toEqual({ card: 'sales', removed: ['b'], missing: ['zz', 'goal'], annotations: 2 })
    expect(await clear()).toEqual({ card: 'sales', removed: ['a', 'c'], missing: [], annotations: 0 })
    expect((await tool('plot_state')()).annotations.plot).toHaveLength(1)
    await expect(clear({ keys: [] })).rejects.toThrow(TypeError)
    await expect(clear({ keys: [1] })).rejects.toThrow(TypeError)
  })

  it('every tool fails with the cards on screen when the card is unknown', async () => {
    show(cardOf('only'))
    for (const t of plugin.tools) await expect(t.run({ card: 'missing', ref: 'ref:missing', annotations: [{ key: 'k' }] }, {})).rejects.toThrow('On screen: only.')
  })
})

describe('options', () => {
  it('passes plot options through and still calls the host onHover', () => {
    const onHover = vi.fn()
    plugin = createPlotChatPlugin({ plot: { animate: false, toolbar: ['csv'], onHover } })
    show(cardOf('sales'))
    box.querySelector('.sp-data[tabindex]')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(onHover).toHaveBeenCalled()
  })
})
