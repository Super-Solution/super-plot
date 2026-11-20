// A stand-in for a chat host (clearly labelled on the page): it mounts the plugin's cards, turns `ref:` links in the
// messages into hover, focus and click targets, routes them to the card whose id they name, and runs the tools.
import { createPlotChatPlugin, PLOT_CARD_KIND, type PlotCardHandle } from '@supersolutions/super-plot-chat-plugin'
import { formatCardRef, parseCardRef, type CardRef } from '@supersolutions/super-plot-core'

type Row = Record<string, unknown>
let seed = 3
const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())

// Sample data, generated in the page.
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
const sales = MONTHS.map((month, i) => ({ month, sales: [40, 55, 90, 60, 45, 70][i] }))
const weekly: Row[] = []
for (let w = 1; w <= 12; w++) {
  weekly.push({ week: w, channel: 'Web', users: Math.round(100 + w * 2 - (w >= 3 && w <= 5 ? 25 : 0)) })
  weekly.push({ week: w, channel: 'Mobile', users: Math.round(70 + w * 6) })
}
const CHANNELS = [{ name: 'Search', cx: 30, cy: 40 }, { name: 'Social', cx: 50, cy: 62 }, { name: 'Email', cx: 78, cy: 30 }]
const campaigns = Array.from({ length: 6000 }, (_, i) => {
  const c = CHANNELS[i % 3]
  return { spend: Math.round((c.cx + gauss() * 8) * 10) / 10, signups: Math.round((c.cy + gauss() * 9) * 10) / 10, channel: c.name }
})

const cards: Record<string, Row> = {
  sales: {
    kind: PLOT_CARD_KIND, id: 'sales', height: 300, alt: 'Monthly sales, January to June 2026: highest in March at 90; the goal is 50.',
    spec: { type: 'bar', title: 'Monthly sales', subtitle: 'Units, sample data', x: 'month', y: 'sales', data: sales, annotations: [{ axis: 'y', value: 50, label: 'Goal', key: 'goal' }] }
  },
  weekly: {
    kind: PLOT_CARD_KIND, id: 'weekly', height: 300, alt: 'Weekly active users by channel over 12 weeks: mobile grows faster and passes web in week 8.',
    spec: { type: 'line', title: 'Weekly active users', subtitle: 'Thousands, sample data', x: 'week', y: 'users', series: 'channel', points: true, zoom: 'x', data: weekly }
  },
  campaigns: {
    kind: PLOT_CARD_KIND, id: 'campaigns', height: 340, alt: '6,000 campaigns, spend against signups: three clusters, email apart with the highest spend.',
    spec: { type: 'scatter', title: '6,000 campaigns', subtitle: 'Spend against signups, sample data', x: 'spend', y: 'signups', series: 'channel', xLabel: 'Spend (USD k)', yLabel: 'Signups (k)', data: campaigns }
  }
}

// The reverse direction: hovering a mark lights the words that name it.
const lit = (ref: CardRef | null): void => {
  const text = ref ? formatCardRef(ref) : null
  for (const a of document.querySelectorAll<HTMLElement>('a.ref')) a.classList.toggle('lit', text !== null && a.dataset.ref === text)
}
const plugin = createPlotChatPlugin({ plot: { toolbar: true, onRefChange: lit } })
const handles = new Map<string, PlotCardHandle>()
const mountAll = (): void => {
  for (const el of document.querySelectorAll<HTMLElement>('[data-card]')) {
    const id = el.dataset.card!
    handles.set(id, plugin.mounts[PLOT_CARD_KIND](el, cards[id], { theme: 'light', locale: 'en' }))
  }
}
mountAll()

// ---- links in the messages ---------------------------------------------------------------------
/** What the host does with a `ref:` link: route it by its target to that card's handle. */
const route = (text: string, event: 'enter' | 'leave' | 'activate') => {
  const p = parseCardRef(text)
  if (!p.ok) return { ok: false as const, code: 'ref_invalid', reason: p.error }
  const h = handles.get(p.ref.target)
  return h ? h.ref(p.ref, event) : { ok: false as const, code: 'card_not_found', reason: `No card "${p.ref.target}" in this conversation.` }
}
/** A link that names nothing becomes plain text, with the reason where a screen reader finds it. */
const plain = (a: HTMLElement, reason: string): void => {
  const span = document.createElement('span')
  span.className = 'plain-ref'
  span.textContent = a.textContent
  const why = document.createElement('span')
  why.className = 'sr'
  why.textContent = ` (${reason})`
  span.appendChild(why)
  a.replaceWith(span)
}
for (const p of document.querySelectorAll<HTMLElement>('[data-md]')) {
  const md = p.dataset.md!
  const re = /\[([^\]]+)\]\((ref:[^)\s]+)\)/g
  let at = 0
  for (let m = re.exec(md); m; m = re.exec(md)) {
    p.append(md.slice(at, m.index))
    const a = document.createElement('a')
    a.className = 'ref'
    a.href = '#'
    a.dataset.ref = m[2]
    a.textContent = m[1]
    p.append(a)
    at = m.index + m[0].length
  }
  p.append(md.slice(at))
}
const linkOf = (e: Event): HTMLElement | null => (e.target as Element | null)?.closest?.<HTMLElement>('a.ref') ?? null
const enter = (e: Event): void => {
  const a = linkOf(e)
  if (!a) return
  const r = route(a.dataset.ref!, 'enter')
  if (!r.ok) plain(a, r.reason)
}
const leave = (e: Event): void => {
  const a = linkOf(e)
  if (a) route(a.dataset.ref!, 'leave')
}
const thread = document.getElementById('thread')!
thread.addEventListener('mouseover', enter)
thread.addEventListener('focusin', enter)
thread.addEventListener('mouseout', leave)
thread.addEventListener('focusout', leave)
thread.addEventListener('click', e => {
  const a = linkOf(e)
  if (!a) return
  e.preventDefault()
  const r = route(a.dataset.ref!, 'activate')
  if (!r.ok) plain(a, r.reason)
})

// ---- the agent's tools ------------------------------------------------------------------------
const tool = (name: string, input?: unknown): Promise<unknown> => plugin.tools.find(t => t.name === name)!.run(input, {})

// Check every link once the cards are drawn (read only, nothing lights up), so a link that names nothing is plain
// text from the start instead of turning into text when the reader reaches it.
for (const a of document.querySelectorAll<HTMLElement>('a.ref')) {
  const p = parseCardRef(a.dataset.ref!)
  if (!p.ok) { plain(a, p.error); continue }
  if (!handles.has(p.ref.target)) { plain(a, `No card "${p.ref.target}" in this conversation.`); continue }
  void tool('plot_resolve', { card: p.ref.target, ref: a.dataset.ref }).then(r => {
    const res = r as { ok: boolean, reason?: string }
    if (!res.ok && a.isConnected) plain(a, res.reason ?? 'It names nothing in the plot.')
  }, () => {})
}
const out = document.getElementById('tool-out')!
const calls: Record<string, () => Promise<unknown>> = {
  annotate: () => tool('plot_annotate', { card: 'sales', annotations: [{ key: 'peak', x: '2026-03', y: 90, label: 'Peak', note: 'March: the spring campaign launched on the 2nd.' }, { key: 'mean', axis: 'y', value: 60, label: 'Mean', tone: 'info' }] }),
  highlight: () => tool('plot_highlight', { ref: 'ref:sales?x=2026-04..2026-06' }),
  state: () => tool('plot_state', { card: 'sales' }),
  data: () => tool('plot_data', { ref: 'ref:sales?x=2026-01..2026-03' }),
  clear: () => tool('plot_clear_annotations', { card: 'sales' }),
  remount: async () => {
    for (const h of handles.values()) h.destroy()
    mountAll()
    return { remounted: [...handles.keys()] }
  }
}
document.querySelector('.agent')!.addEventListener('click', async e => {
  const k = (e.target as HTMLElement).dataset.tool
  if (!k) return
  try {
    out.textContent = JSON.stringify(await calls[k](), null, 2)
  } catch (err) {
    out.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`
  }
})

;(window as unknown as { demo: unknown }).demo = { plugin, handles, tool, route }
document.body.dataset.ready = '1'
