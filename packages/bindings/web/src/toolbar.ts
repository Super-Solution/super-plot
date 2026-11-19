import type { Theme, UiStringKey } from '@supersolutions/super-plot-core/base'
import type { ToolbarItem } from './plot.js'

// Loaded on demand (its own chunk) by a plot with the `toolbar` option. Which buttons a chart gets is decided
// in plot.ts, before this code is here; what they do (`run`) stays there too.

/** Each button's visible text and accessible name, as keys of the `strings` option. */
const LABELS: Record<ToolbarItem, [text: UiStringKey, name: UiStringKey]> = {
  png: ['toolPng', 'toolPngName'],
  svg: ['toolSvg', 'toolSvgName'],
  csv: ['toolCsv', 'toolCsvName'],
  table: ['toolTable', 'toolTableName'],
  reset: ['toolReset', 'toolResetName'],
  sound: ['toolSound', 'toolSoundName']
}

/** The toolbar: real buttons, rebuilt only when the list changes (so keyboard focus stays on them). */
export class Toolbar {
  readonly el: HTMLDivElement
  private key = ''

  constructor(doc: Document, private run: (k: ToolbarItem) => void) {
    this.el = doc.createElement('div')
    this.el.className = 'sp-bar'
    this.el.setAttribute('role', 'toolbar')
  }

  /** Show `items`; labels and colours on every call, so a change of `strings` or theme reaches buttons that stay. */
  update(items: readonly ToolbarItem[], t: (key: UiStringKey) => string, theme: Theme | null): void {
    const key = items.join(',')
    if (this.key !== key) {
      const doc = this.el.ownerDocument
      this.el.replaceChildren(...items.map(k => {
        const b = doc.createElement('button')
        b.type = 'button'
        b.dataset.tool = k
        b.addEventListener('click', e => { e.stopPropagation(); this.run(k) })
        return b
      }))
      this.key = key
    }
    this.el.setAttribute('aria-label', t('toolbar'))
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button')) {
      const [text, name] = LABELS[b.dataset.tool as ToolbarItem]
      const label = t(name)
      if (b.textContent !== t(text)) b.textContent = t(text)
      b.setAttribute('aria-label', label)
      b.title = label
      if (!theme) continue
      b.style.background = `var(--sp-surface, ${theme.colors.surface})`
      b.style.color = `var(--sp-text, ${theme.colors.text})`
      b.style.borderColor = `var(--sp-border, ${theme.colors.border})`
    }
  }

  /** Button states: pressed table and sound, reset only active while zoomed. */
  state(table: boolean, sound: boolean, zoomed: boolean): void {
    this.el.querySelector('[data-tool="table"]')?.setAttribute('aria-pressed', String(table))
    this.el.querySelector('[data-tool="sound"]')?.setAttribute('aria-pressed', String(sound))
    // aria-disabled, not disabled: a disabled button would drop the keyboard focus the viewer just put on it.
    this.el.querySelector('[data-tool="reset"]')?.setAttribute('aria-disabled', String(!zoomed))
  }
}

/** Save `blob` as `name` through a temporary link. */
export function download(doc: Document, name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  doc.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
