// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { clampCamera, dragCamera, makeView, zoomCamera, type Camera, type Scene, type Theme, type UiStringKey, type ViewParams } from '@supersolutions/super-plot-core/base'

// Loaded on demand (its own chunk) the first time a plot draws a map: pages without maps do not pay for it.

/** What the map control needs from the plot that owns it. */
export interface MapOwner {
  readonly root: HTMLDivElement
  scene(): Scene | null
  /** The viewer's camera, once they moved it. */
  camera(): Camera | null
  /** Move the camera (redraws, or moves it on the GPU). */
  apply(c: Camera): void
  /** A gesture goes on: report it when it has rested a moment. */
  gestureSoon(): void
  /** A gesture ended: catch the scene up and report the camera. */
  endGesture(): void
  /** Back to the spec's camera (reported). */
  reset(): void
  /** A UI string from the `strings` option, placeholders filled. */
  text(key: UiStringKey, vars?: Record<string, string | number>): string
  hideTip(): void
  clearHighlight(): void
}

/**
 * The viewer's hands on an interactive map: drag to pan (or turn the globe), Shift-drag to tilt and rotate,
 * Ctrl/⌘-scroll or pinch to zoom, the keyboard, and the zoom buttons. The plot forwards its root's events.
 */
export class MapControl {
  /** The zoom buttons, while the chart is an interactive map. */
  controls: HTMLDivElement | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private drag: { moved: boolean; turn: boolean } | null = null
  private justDragged = false

  constructor(private owner: MapOwner) {}

  private get root(): HTMLDivElement { return this.owner.root }

  /** A drag is moving the camera, or has just ended (its click must not select). */
  dragging(): boolean { return this.drag?.moved === true || this.justDragged }

  /** Pressed and not released yet. */
  pressed(): boolean { return this.drag !== null }

  /** Zoom buttons, keyboard focus and touch handling for an interactive map (`on`); removed for anything else. */
  setup(scene: Scene, theme: Theme, on: boolean): void {
    const root = this.root
    if (!on) {
      this.controls?.remove()
      this.controls = null
      root.removeAttribute('data-map')
      for (const a of ['role', 'aria-roledescription', 'aria-label', 'aria-keyshortcuts']) root.removeAttribute(a)
      if (root.getAttribute('tabindex') === '0' && root.dataset.spMapTab) {
        root.removeAttribute('tabindex')
        delete root.dataset.spMapTab
      }
      return
    }
    root.setAttribute('data-map', '')
    if (!root.hasAttribute('tabindex')) {
      root.tabIndex = 0
      root.dataset.spMapTab = '1'
    }
    root.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown + - 0')
    root.setAttribute('role', 'group')
    root.setAttribute('aria-roledescription', this.owner.text('mapRole'))
    root.setAttribute('aria-label', this.owner.text('mapKeys', { title: scene.title }))
    if (!this.controls) {
      const doc = root.ownerDocument
      const box = doc.createElement('div')
      box.className = 'sp-ctl'
      const add = (label: UiStringKey, text: string, act: () => void): void => {
        const b = doc.createElement('button')
        b.type = 'button'
        b.textContent = text
        b.dataset.label = label
        b.addEventListener('click', e => { e.stopPropagation(); act() })
        box.appendChild(b)
      }
      add('mapZoomIn', '+', () => this.zoomBy(1.5))
      add('mapZoomOut', '−', () => this.zoomBy(1 / 1.5))
      add('mapReset', '⟲', () => this.owner.reset())
      this.controls = box
    }
    for (const b of this.controls.querySelectorAll<HTMLButtonElement>('button')) {
      const label = this.owner.text(b.dataset.label as UiStringKey)
      b.setAttribute('aria-label', label)
      b.title = label
      b.style.background = `var(--sp-surface, ${theme.colors.surface})`
      b.style.color = `var(--sp-text, ${theme.colors.text})`
      b.style.borderColor = `var(--sp-border, ${theme.colors.border})`
    }
  }

  /** The view as it is on screen now (it may be ahead of the compiled scene during a gesture). */
  private liveView(): ViewParams | null {
    const geo = this.owner.scene()?.geo
    if (!geo) return null
    const cam = this.owner.camera()
    return cam ? makeView({ ...geo.input, camera: cam }) : geo.view
  }

  private zoomBy(factor: number): void {
    const v = this.liveView()
    if (!v) return
    this.owner.apply(zoomCamera(v, factor))
    this.owner.gestureSoon()
  }

  /** Screen pixels to scene pixels. */
  private sceneScale(): number {
    const w = this.root.getBoundingClientRect().width
    const scene = this.owner.scene()
    return scene && w > 0 ? scene.width / w : 1
  }

  down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as Element | null)?.closest?.('.sp-ctl, .sp-bar, .sp-cv-lk, [data-lk]')) return
    // No pointer capture yet: a click that never becomes a drag must still reach the mark under it.
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 1) this.drag = { moved: false, turn: e.shiftKey }
  }

  move(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId)
    if (!prev || !this.drag) return
    const now = { x: e.clientX, y: e.clientY }
    if (this.pointers.size >= 2) {
      // Pinch: the change in distance between the first two fingers.
      const [a, b] = [...this.pointers.entries()]
      const other = a[0] === e.pointerId ? b[1] : a[1]
      const before = Math.hypot(prev.x - other.x, prev.y - other.y)
      const after = Math.hypot(now.x - other.x, now.y - other.y)
      this.pointers.set(e.pointerId, now)
      if (before > 4 && after > 4) {
        this.drag.moved = true
        const v = this.liveView()
        if (v) this.owner.apply(zoomCamera(v, after / before))
      }
      return
    }
    const k = this.sceneScale()
    const dx = (now.x - prev.x) * k, dy = (now.y - prev.y) * k
    if (!this.drag.moved && Math.hypot(now.x - prev.x, now.y - prev.y) < 3) return
    this.pointers.set(e.pointerId, now)
    if (!this.drag.moved) {
      this.drag.moved = true
      try { this.root.setPointerCapture?.(e.pointerId) } catch { /* not capturable (synthetic event) */ }
      this.root.setAttribute('data-drag', '')
      this.owner.hideTip()
      this.owner.clearHighlight()
    }
    const v = this.liveView()
    if (v) this.owner.apply(dragCamera(v, dx, dy, this.drag.turn || e.shiftKey))
  }

  up(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return
    if (this.pointers.size) return
    const moved = this.drag?.moved
    this.drag = null
    this.root.removeAttribute('data-drag')
    if (moved) {
      // The click that follows a drag must not select what is under the pointer.
      this.justDragged = true
      setTimeout(() => { this.justDragged = false }, 0)
      this.owner.endGesture()
    }
  }

  wheel(e: WheelEvent): void {
    // Plain scrolling scrolls the page; zoom needs Ctrl/⌘ (a trackpad pinch sends Ctrl too).
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const v = this.liveView()
    if (!v) return
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0025
    this.owner.apply(zoomCamera(v, Math.exp(-e.deltaY * unit)))
    this.owner.gestureSoon()
  }

  /** Arrow keys pan (Shift: turn and tilt), + and - zoom, 0 resets. True when the key was used. */
  key(e: KeyboardEvent): boolean {
    if (e.altKey || e.ctrlKey || e.metaKey) return false
    const t = e.target as Element | null
    if (t && t !== this.root && t.closest?.('button, input, select, textarea, [data-lk]')) return false
    const v = this.liveView()
    if (!v) return false
    const step = 60
    let c: Camera | null = null
    switch (e.key) {
      case 'ArrowLeft': c = e.shiftKey ? clampCamera({ ...v.camera, bearing: v.camera.bearing - 15 }) : dragCamera(v, step, 0); break
      case 'ArrowRight': c = e.shiftKey ? clampCamera({ ...v.camera, bearing: v.camera.bearing + 15 }) : dragCamera(v, -step, 0); break
      case 'ArrowUp': c = e.shiftKey ? clampCamera({ ...v.camera, pitch: v.camera.pitch + 5 }) : dragCamera(v, 0, step); break
      case 'ArrowDown': c = e.shiftKey ? clampCamera({ ...v.camera, pitch: v.camera.pitch - 5 }) : dragCamera(v, 0, -step); break
      case '+': case '=': c = zoomCamera(v, 1.25); break
      case '-': case '_': c = zoomCamera(v, 1 / 1.25); break
      case '0': e.preventDefault(); this.owner.reset(); return true
      default: return false
    }
    e.preventDefault()
    // In SVG the redraw replaces the focused region: keep keyboard focus on the map itself.
    const doc = this.root.ownerDocument
    if (doc.activeElement !== this.root && this.root.contains(doc.activeElement)) this.root.focus({ preventScroll: true })
    this.owner.apply(c)
    this.owner.gestureSoon()
    return true
  }
}
