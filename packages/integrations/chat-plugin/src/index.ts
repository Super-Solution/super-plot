// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// Every chart type, registered: a chat may show any of them.
import { SuperPlot, type SuperPlotOptions } from '@supersolutions/super-plot-web'
import { LIMITS, formatCardRef, isSafeColor, parseCardRef, resolveRef, validatePlot, type CardRef, type CardRefEvent, type CardRefResult, type Issue } from '@supersolutions/super-plot-core/base'
import { PLOT_CARD_KIND, PLOT_FALLBACK_MESSAGE, isThemeValue, plotCardKind, readHostTheme, validatePlotCardSpec, type CardMount, type CardMountContext, type CardMountHandle, type ChatPlugin, type HostTheme, type PlotCardSpec, type PluginTool } from '@supersolutions/super-protocol'

export { PLOT_CARD_KIND, PLOT_LIMITS, plotCardKind, validatePlotCardSpec, type PlotCardSpec } from '@supersolutions/super-protocol'

/** A card handle that always answers card references (`ref:<card id>?x=...`); `ref` is optional in the protocol's `CardMountHandle`. */
export interface PlotCardHandle extends CardMountHandle {
  ref(ref: CardRef | null, event: CardRefEvent): CardRefResult
}

/** An annotation the agent added: an annotation of the plot spec with a `key`, always `by: "assistant"`. */
export type AgentAnnotation = Record<string, unknown> & { key: string; by: 'assistant' }

export interface PlotChatPluginOptions {
  /** Options for every plot (renderer, toolbar, tooltipFormat, ...). The plugin sets theme, locale and refTarget. */
  plot?: Omit<SuperPlotOptions, 'refTarget' | 'theme' | 'locale'>
  /** After a tool changed the agent's annotations on a card: the card id and what the agent has on it now. */
  onChange?: (card: string, annotations: AgentAnnotation[]) => void
}

/** The plugin, with its mount typed to the handle it returns. */
export interface PlotChatPlugin extends ChatPlugin {
  mounts: { [PLOT_CARD_KIND]: (container: HTMLElement, spec: unknown, context: CardMountContext) => PlotCardHandle }
  tools: PluginTool[]
}

/** At most this many rows from `plot_data`, and this many rows or points listed by `plot_resolve`. */
export const PLOT_DATA_MAX = 500
/** Cards whose agent annotations are kept for a remount. */
const MAX_KEPT = 64
const VERSION = '0.5.0'
const NAME = '@supersolutions/super-plot-chat-plugin'
/** Host theme tokens that are also plot colours (`--sp-<token>`). */
const COLOUR_TOKENS = ['background', 'surface', 'border', 'text', 'text-muted', 'accent', 'positive', 'negative', 'warning', 'info'] as const

interface Card {
  id: string
  spec: PlotCardSpec
  plot: SuperPlot
  figure: HTMLElement
  agent: Map<string, AgentAnnotation>
  /**
   * What is highlighted and who asked. A link the reader hovers (`chat`) goes with `leave`; the agent's draft and a
   * revealed link (`reveal`, after a click) stay until the viewer moves onto the plot or presses Escape.
   */
  lit: { by: 'agent' | 'chat' | 'reveal'; ref: string } | null
  /** `reveal` is moving focus: that is not the viewer moving. */
  revealing: boolean
  /** The entrance animation is off after the first draw: a new annotation must not replay it. */
  still: boolean
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const source = (spec: PlotCardSpec): string => JSON.stringify(spec.spec)
const own = (spec: PlotCardSpec): Record<string, unknown>[] => (Array.isArray(spec.spec.annotations) ? spec.spec.annotations.filter(isObject) : [])
/** The plot spec drawn: the card's, with the agent's annotations after its own. */
const drawn = (card: Pick<Card, 'spec' | 'agent'>): Record<string, unknown> =>
  card.agent.size ? { ...card.spec.spec, annotations: [...own(card.spec), ...card.agent.values()] } : card.spec.spec
const text = (ref: CardRef | string): string => (typeof ref === 'string' ? ref : formatCardRef(ref) ?? '')

/**
 * The chat plugin: the `super.plot` card kind, a mount that draws it with Super Plot and answers card references
 * (`ref` on the handle: `enter` highlights, `leave` clears, `activate` reveals), and tools an agent uses to read a
 * plot, point at part of it and add its own annotations. Every tool takes an optional `card` (a card id; the newest
 * plot on screen by default).
 */
export function createPlotChatPlugin(options: PlotChatPluginOptions = {}): PlotChatPlugin {
  const cards = new Map<string, Card>()
  let counter = 0
  // A host may remount a card at any time (a finished turn does): what the agent put on a plot is kept here and
  // comes back with the same card. A card whose own plot spec changed starts from it.
  const kept = new Map<string, { source: string; annotations: AgentAnnotation[] }>()
  const keyOf = (spec: PlotCardSpec): string => spec.id ?? source(spec)
  const remember = (card: Card): void => {
    const k = keyOf(card.spec)
    kept.delete(k)
    kept.set(k, { source: source(card.spec), annotations: [...card.agent.values()] })
    if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value as string)
  }
  const restored = (spec: PlotCardSpec): Map<string, AgentAnnotation> => {
    const k = kept.get(keyOf(spec))
    return new Map(k && k.source === source(spec) ? k.annotations.map(a => [a.key, a]) : [])
  }

  const onScreen = (): string => (cards.size ? [...cards.keys()].join(', ') : 'none')
  const find = (card: unknown, ref?: unknown): Card => {
    if (card !== undefined && typeof card !== 'string') throw new TypeError('card must be a string: the id of a plot card.')
    let id = card
    // No card named: the card the reference names, if it is on screen, else the newest.
    if (id === undefined && typeof ref === 'string') {
      const p = parseCardRef(ref)
      if (p.ok && cards.has(p.ref.target)) id = p.ref.target
    }
    const found = cards.get(id ?? [...cards.keys()].pop() ?? '')
    if (!found) throw new Error(id === undefined ? 'No plot card is on screen. Show a super.plot card first.' : `No plot card "${id}" is on screen. On screen: ${onScreen()}.`)
    return found
  }
  /** Draw a changed spec on a card already on screen, without its entrance animation again. */
  const redraw = (card: Card): void => {
    if (!card.still) {
      card.still = true
      card.plot.setOptions({ animate: false })
    }
    card.plot.setSpec(drawn(card))
  }
  const draw = (card: Card): void => {
    redraw(card)
    remember(card)
    options.onChange?.(card.id, [...card.agent.values()])
  }

  const mount = (container: HTMLElement, initial: unknown, initialContext: CardMountContext): PlotCardHandle => {
    let card: Card | null = null
    let shown = ''
    const doc = container.ownerDocument

    const teardown = (): void => {
      if (card) {
        remember(card)
        // A newer card may have taken the same id: only release the entry this one still owns.
        if (cards.get(card.id) === card) cards.delete(card.id)
        card.plot.dispose()
        card = null
      }
      container.replaceChildren()
    }
    const note = (message: string, role: 'status' | 'alert'): void => {
      teardown()
      const p = doc.createElement('p')
      p.setAttribute('role', role)
      p.style.cssText = 'margin:0;padding:12px;font:13px/1.4 system-ui,sans-serif'
      p.textContent = message
      container.replaceChildren(p)
    }
    const look = (figure: HTMLElement, theme: HostTheme | null): void => {
      for (const t of COLOUR_TOKENS) {
        const v = theme?.tokens[t]
        if (v !== undefined && isSafeColor(v)) figure.style.setProperty(`--sp-${t}`, v)
        else figure.style.removeProperty(`--sp-${t}`)
      }
      const font = theme?.tokens['font-sans']
      if (font !== undefined && isThemeValue(font)) figure.style.setProperty('--sp-font', font)
      else figure.style.removeProperty('--sp-font')
    }
    const frame = (figure: HTMLElement, spec: PlotCardSpec): HTMLElement => {
      figure.setAttribute('aria-label', spec.alt)
      let title = figure.querySelector<HTMLElement>(':scope > .spc-title')
      if (spec.title) {
        if (!title) {
          title = doc.createElement('div')
          title.className = 'spc-title'
          title.style.cssText = 'font:600 14px/1.4 var(--sp-font,system-ui,sans-serif);color:var(--sp-text,inherit);padding:0 0 6px'
          figure.prepend(title)
        }
        title.textContent = spec.title
      } else title?.remove()
      const host = figure.querySelector<HTMLElement>(':scope > .spc-plot')!
      host.style.height = spec.height === undefined ? '' : `${spec.height}px`
      return host
    }

    const render = (raw: unknown, context: CardMountContext): void => {
      const theme = readHostTheme(context.hostTheme)
      const signature = JSON.stringify([raw, context.theme, context.locale ?? null, theme, context.partial === true])
      if (signature === shown) return
      shown = signature
      if (context.partial === true) return note('The plot is still being written.', 'status')
      const valid = validatePlotCardSpec(raw)
      if (!valid.ok) {
        // The reason is for the developer and the model, never the reader (super-protocol 0.3.0): the reader gets the
        // protocol's plain line and the card's own description of the plot when it has one.
        console.warn(`[super-plot] The ${PLOT_CARD_KIND} card was refused: ${valid.error}${valid.expected ? ` Expected ${valid.expected}.` : ''}`)
        const alt = typeof (raw as { alt?: unknown } | null)?.alt === 'string' ? (raw as { alt: string }).alt.trim() : ''
        return note(alt ? `${PLOT_FALLBACK_MESSAGE} ${alt}` : PLOT_FALLBACK_MESSAGE, 'status')
      }
      const spec = raw as PlotCardSpec
      const plotTheme = theme?.mode ?? context.theme
      if (card && card.id === (spec.id ?? card.id)) {
        // The same card again (a new spec while it is on screen): keep the plot, its zoom and its highlight.
        if (source(spec) !== source(card.spec)) card.agent = new Map()
        card.spec = spec
        frame(card.figure, spec)
        look(card.figure, theme)
        card.plot.setOptions({ theme: plotTheme, locale: context.locale })
        redraw(card)
        remember(card)
        return
      }
      teardown()
      const id = spec.id ?? `plot-${++counter}`
      const figure = doc.createElement('figure')
      figure.className = 'spc'
      figure.style.cssText = 'margin:0'
      const host = doc.createElement('div')
      host.className = 'spc-plot'
      figure.appendChild(host)
      frame(figure, spec)
      look(figure, theme)
      container.replaceChildren(figure)
      const agent = restored(spec)
      const user = options.plot ?? {}
      const self: { card: Card | null } = { card: null }
      const plot = new SuperPlot(host, drawn({ spec, agent }), {
        ...user,
        theme: plotTheme,
        locale: context.locale,
        refTarget: id,
        onHover: e => {
          // The viewer moved onto a mark: the agent's highlight was a draft, and goes.
          const c = self.card
          if (e && c && !c.revealing && (c.lit?.by === 'agent' || c.lit?.by === 'reveal')) {
            c.plot.highlight(null)
            c.lit = null
          }
          user.onHover?.(e)
        }
      })
      card = self.card = { id, spec, plot, figure, agent, lit: null, revealing: false, still: user.animate === false }
      // A card that reuses an id takes it over; the newest card is the default for the tools.
      cards.delete(id)
      cards.set(id, card)
    }

    render(initial, initialContext)
    return {
      update: render,
      destroy: teardown,
      ref(ref, event) {
        const c = card
        if (!c) return { ok: false, code: 'card_not_ready', reason: 'The plot is not on screen yet.' }
        if (ref === null) {
          c.lit = null
          return c.plot.highlight(null)
        }
        // The reader clicked the link, and focus left it for the plot: what it revealed stays.
        if (event === 'leave') {
          if (c.lit?.by === 'reveal') return { ok: true }
          c.lit = null
          return c.plot.highlight(null)
        }
        if (event === 'enter') {
          const r = c.plot.highlight(ref)
          c.lit = r.ok ? { by: 'chat', ref: text(ref) } : null
          return r
        }
        // Set first: moving focus out of the link makes the host send `leave` while reveal runs.
        c.revealing = true
        c.lit = { by: 'reveal', ref: text(ref) }
        try {
          const r = c.plot.reveal(ref)
          if (!r.ok) c.lit = null
          return r
        } finally {
          c.revealing = false
        }
      }
    }
  }

  const card = { type: 'string', description: 'The id of the plot card; omit for the newest plot on screen.' }
  const ref = { type: 'string', description: 'A card reference, ref:<card id>?<name>=<value>&...: x, y, series and key (row ids or annotation keys); ranges as a..b, dates as ISO prefixes (2026-03 is all of March). ref:<card id> alone is the whole plot.' }
  const input = (v: unknown): Record<string, unknown> => {
    if (v === undefined) return {}
    if (!isObject(v)) throw new TypeError('The tool input must be an object.')
    return v
  }
  const int = (v: unknown, name: string, min: number, max: number, dflt: number): number => {
    if (v === undefined) return dflt
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}.`)
    return v
  }
  const refArg = (v: unknown): string => {
    if (typeof v !== 'string' || v === '') throw new TypeError('ref must be a card reference string, such as ref:sales?x=2026-03.')
    return v
  }
  const issuesOf = (list: readonly Issue[]): { severity: string; code: string; path: string; message: string }[] => list.map(i => ({ severity: i.severity, code: i.code, path: i.path, message: i.message }))

  const tools: PluginTool[] = [
    {
      name: 'plot_state',
      authority: 'read',
      description: 'Read a plot card on screen: its chart type, what it shows in words, its columns and row count, the series the viewer hid, the zoom, the issues, the annotations (the plot\'s own and yours) and what is highlighted. Also lists the plot cards on screen.',
      inputSchema: { type: 'object', properties: { card }, additionalProperties: false },
      run: async raw => {
        const c = find(input(raw).card)
        const spec = drawn(c)
        const v = validatePlot(spec)
        const rows = (v.spec?.data ?? []) as Record<string, unknown>[]
        return {
          card: c.id,
          cards: [...cards.keys()],
          title: c.spec.title ?? null,
          alt: c.spec.alt,
          type: typeof spec.type === 'string' ? spec.type : null,
          renderer: c.plot.getRenderer(),
          description: c.plot.getScene()?.description ?? null,
          columns: rows.length ? Object.keys(rows[0]) : [],
          rows: rows.length,
          hidden: c.plot.getHidden(),
          zoom: c.plot.getZoom(),
          issues: issuesOf(c.plot.getIssues()),
          annotations: { plot: own(c.spec), agent: [...c.agent.values()] },
          // Escape in the plot clears it without the plugin hearing of it: report what is on screen.
          highlight: c.lit && c.figure.querySelector('svg.sp-ref') ? c.lit : null
        }
      }
    },
    {
      name: 'plot_data',
      authority: 'read',
      description: `Read the rows a plot card draws (after its transform), each with its index, so you can check a number before you point at it. Narrow them with ref. At most ${PLOT_DATA_MAX} rows per call: page with offset.`,
      inputSchema: {
        type: 'object',
        properties: { card, ref, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: PLOT_DATA_MAX } },
        additionalProperties: false
      },
      run: async raw => {
        const a = input(raw)
        const c = find(a.card, a.ref)
        const limit = int(a.limit, 'limit', 1, PLOT_DATA_MAX, 100)
        const offset = int(a.offset, 'offset', 0, Number.MAX_SAFE_INTEGER, 0)
        const spec = drawn(c)
        const v = validatePlot(spec)
        if (!v.ok || !v.spec) return { card: c.id, ok: false, code: 'ref_spec_invalid', reason: 'The plot spec does not validate; plot_state lists its issues.' }
        const data = v.spec.data as Record<string, unknown>[]
        let index = data.map((_, i) => i)
        if (a.ref !== undefined) {
          const m = resolveRef(spec, refArg(a.ref))
          if (!m.ok) return { card: c.id, ok: false, code: m.code, reason: m.reason }
          index = m.rows
        }
        const page = index.slice(offset, offset + limit)
        return { card: c.id, ok: true, total: index.length, offset, columns: data.length ? Object.keys(data[0]) : [], rows: page.map(i => ({ index: i, row: data[i] })), more: offset + page.length < index.length }
      }
    },
    {
      name: 'plot_resolve',
      authority: 'read',
      description: 'Check what a card reference names in a plot without showing anything: the matched rows, series and annotation keys and a short label, or a code and reason when it names nothing. Use it before you write a ref: link in your reply.',
      inputSchema: { type: 'object', properties: { card, ref }, required: ['ref'], additionalProperties: false },
      run: async raw => {
        const a = input(raw)
        const r = refArg(a.ref)
        const c = find(a.card, r)
        const m = resolveRef(drawn(c), r, { hidden: c.plot.getHidden() })
        if (!m.ok) return { card: c.id, ok: false, code: m.code, reason: m.reason, ...(m.series ? { series: m.series } : {}) }
        return { card: c.id, ok: true, label: m.label, count: m.rows.length, rows: m.rows.slice(0, PLOT_DATA_MAX), points: m.points.slice(0, PLOT_DATA_MAX), series: m.series, keys: m.keys, more: m.rows.length > PLOT_DATA_MAX || m.points.length > PLOT_DATA_MAX }
      }
    },
    {
      name: 'plot_highlight',
      authority: 'draft',
      description: 'Point at part of a plot card: outline what a card reference names and dim the rest, until the viewer moves onto the plot, presses Escape or you call it again. ref null clears it. Answers with a label, or a code and reason when the reference names nothing.',
      inputSchema: { type: 'object', properties: { card, ref: { anyOf: [ref, { type: 'null' }] } }, required: ['ref'], additionalProperties: false },
      run: async raw => {
        const a = input(raw)
        const r = a.ref === null ? null : refArg(a.ref)
        const c = find(a.card, r ?? undefined)
        const result = c.plot.highlight(r)
        c.lit = r !== null && result.ok ? { by: 'agent', ref: r } : null
        return { card: c.id, ...result }
      }
    },
    {
      name: 'plot_annotate',
      authority: 'draft',
      description: `Add your own annotations to a plot card, shown with an assistant mark: a line {axis:"y", value, label} (add to for a band) or a point {x, y, label}, each with a key (a short stable id) and optionally a note (up to ${LIMITS.maxNote} characters, shown as its tooltip) and a tone. A key you used before is replaced; replace: true replaces all of yours. The plot's own annotations cannot be changed. Answers with the keys applied and those rejected, each with a code and reason. At most ${LIMITS.maxAnnotations} annotations on a plot.`,
      inputSchema: {
        type: 'object',
        properties: {
          card,
          annotations: { type: 'array', minItems: 1, maxItems: LIMITS.maxAnnotations, items: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } } },
          replace: { type: 'boolean' }
        },
        required: ['annotations'],
        additionalProperties: false
      },
      run: async raw => {
        const a = input(raw)
        const c = find(a.card)
        if (!Array.isArray(a.annotations) || !a.annotations.length) throw new TypeError('annotations must be a non-empty array of annotations.')
        if (a.replace !== undefined && typeof a.replace !== 'boolean') throw new TypeError('replace must be true or false.')
        if (!validatePlot(c.spec.spec).ok) throw new Error(`The plot on card "${c.id}" does not validate, so nothing can be added to it; plot_state lists its issues.`)
        const mine = own(c.spec)
        const taken = new Set(mine.map(x => x.key).filter(k => typeof k === 'string'))
        const rejected: { key: string | null; index: number; code: string; reason: string }[] = []
        const next = a.replace ? new Map<string, AgentAnnotation>() : new Map(c.agent)
        const offered = new Map<string, number>()
        a.annotations.forEach((x: unknown, index: number) => {
          if (!isObject(x)) return rejected.push({ key: null, index, code: 'bad_type', reason: 'An annotation must be an object.' })
          const key = x.key
          if (typeof key !== 'string' || !key.trim()) return rejected.push({ key: null, index, code: 'key_missing', reason: 'Every annotation you add needs a key (a short stable id), so you can replace or remove it later.' })
          if (taken.has(key)) return rejected.push({ key, index, code: 'key_reserved', reason: `"${key}" is the key of one of the plot's own annotations, which you cannot change. Use another key.` })
          next.delete(key)
          next.set(key, { ...x, key, by: 'assistant' })
          offered.set(key, index)
        })
        // Over the limit: what was offered last is turned away first (what is already on the plot stays).
        const over = [...offered.keys()].filter(k => !c.agent.has(k) || a.replace).reverse()
        while (next.size > LIMITS.maxAnnotations - mine.length && over.length) {
          const k = over.shift()!
          next.delete(k)
          rejected.push({ key: k, index: offered.get(k)!, code: 'too_many', reason: `A plot holds at most ${LIMITS.maxAnnotations} annotations, its own included; remove some of yours first (plot_clear_annotations).` })
          offered.delete(k)
        }
        // Checked as the plot would draw them: an error at an offered annotation's path rejects it, with the plot's
        // code, and so does text the plot would cut (a note over 2,048 characters): the agent hears of it.
        const list = [...next.values()]
        const v = validatePlot({ ...c.spec.spec, annotations: [...mine, ...list] })
        const bad = new Set<string>()
        for (const i of v.issues) {
          const m = /^annotations\[(\d+)\]/.exec(i.path)
          const k = m && (i.severity === 'error' || i.code === 'string_truncated') ? list[Number(m[1]) - mine.length]?.key : undefined
          if (k === undefined || bad.has(k) || !offered.has(k)) continue
          bad.add(k)
          rejected.push({ key: k, index: offered.get(k)!, code: i.code, reason: i.message })
        }
        for (const k of bad) {
          next.delete(k)
          offered.delete(k)
          // A rejected replacement keeps what the key had before.
          const before = c.agent.get(k)
          if (before && !a.replace) next.set(k, before)
        }
        c.agent = next
        draw(c)
        rejected.sort((x, y) => x.index - y.index)
        return { card: c.id, applied: [...offered.keys()], rejected, annotations: c.agent.size }
      }
    },
    {
      name: 'plot_clear_annotations',
      authority: 'act',
      description: 'Remove annotations you added to a plot card: those with the given keys, or all of yours. The plot\'s own annotations stay.',
      inputSchema: { type: 'object', properties: { card, keys: { type: 'array', items: { type: 'string' }, minItems: 1 } }, additionalProperties: false },
      run: async raw => {
        const a = input(raw)
        const c = find(a.card)
        if (a.keys !== undefined && !(Array.isArray(a.keys) && a.keys.length && a.keys.every(k => typeof k === 'string'))) throw new TypeError('keys must be a non-empty array of annotation keys.')
        const keys = (a.keys as string[] | undefined) ?? [...c.agent.keys()]
        const removed = keys.filter(k => c.agent.delete(k))
        const missing = keys.filter(k => !removed.includes(k))
        if (removed.length) draw(c)
        return { card: c.id, removed, missing, annotations: c.agent.size }
      }
    }
  ]

  return {
    manifest: {
      manifestVersion: 0,
      name: NAME,
      version: VERSION,
      license: 'Apache-2.0',
      capabilities: [
        { id: 'plot.card', surface: 'card', cardKind: PLOT_CARD_KIND },
        ...tools.map(t => ({ id: `plot.${t.name.replace(/^plot_/, '').replace(/_/g, '-')}`, surface: 'tool' as const, toolName: t.name, inputSchema: t.inputSchema }))
      ]
    },
    cardKinds: [plotCardKind],
    mounts: { [PLOT_CARD_KIND]: mount } as PlotChatPlugin['mounts'],
    tools
  }
}

// The handle type is the protocol's, structurally: a host that knows only `CardMount` can register this mount.
const _mount: (p: PlotChatPlugin) => CardMount = p => p.mounts[PLOT_CARD_KIND]
void _mount
