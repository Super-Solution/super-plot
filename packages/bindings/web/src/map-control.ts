// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { camera3dOf, clampCamera, clampCamera3d, type Camera, type Camera3d, type Scene, type Theme, type UiStringKey, type View3d, type ViewParams } from '@supersolutions/super-plot-core/base'
import { dragCamera, dragCamera3d, makeView, makeView3d, zoomCamera, zoomCamera3d } from '@supersolutions/super-plot-core/view'

// Loaded on demand (its own chunk) the first time a plot draws a map or a 3D chart: pages without them do not pay for it.

/** The view on screen: a map's, or a 3D chart's box. */
type Live = { kind: 'geo'; v: ViewParams } | { kind: '3d'; v: View3d }

/** What the map control needs from the plot that owns it. */
export interface MapOwner {
  readonly root: HTMLDivElement
  scene(): Scene | null
  /** The viewer's camera, once they moved it. */
  camera(): Camera | Camera3d | null
  /** Move the camera (redraws, or moves it on the GPU). */
  apply(c: Camera | Camera3d): void
  /** 3D charts: show data mark `i` as the keyboard's (focus it on SVG; outline, tooltip and read-out on canvas); -1 clears. */
  focusMark(i: number): void
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
 * A 3D chart (`scene.view3d`) uses the same hands: drag turns and tilts the box, the arrow keys turn it, and
 * Tab steps through its data in x order.
 */
export class MapControl {
  /** The zoom buttons, while the chart is an interactive map. */
  controls: HTMLDivElement | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private drag: { moved: boolean; turn: boolean } | null = null
  private justDragged = false
  /** 3D charts: where Tab is in `scene.view3d.order` (-1: on the chart itself). */
  private cursor = -1

  constructor(private owner: MapOwner) {
    // Coming back to the chart from outside starts the Tab walk again from the first point.
    owner.root.addEventListener('focusin', e => {
      if (e.target === owner.root && !owner.root.contains(e.relatedTarget as Node | null)) this.cursor = -1
    })
  }

  private get root(): HTMLDivElement { return this.owner.root }

  /** A drag is moving the camera, or has just ended (its click must not select). */
  dragging(): boolean { return this.drag?.moved === true || this.justDragged }

  /** Pressed and not released yet. */
  pressed(): boolean { return this.drag !== null }

  /**
   * Zoom buttons, keyboard focus and touch handling for an interactive map or 3D chart (`on`). A 3D chart without
   * camera controls still gets the keyboard focus and Tab steps through its data. Removed for anything else.
   */
  setup(scene: Scene, theme: Theme, on: boolean): void {
    const root = this.root
    const steps = !on && !!scene.view3d
    if (!on) {
      this.controls?.remove()
      this.controls = null
      root.removeAttribute('data-map')
      for (const a of ['role', 'aria-roledescription', 'aria-label', 'aria-keyshortcuts']) root.removeAttribute(a)
      if (!steps && root.getAttribute('tabindex') === '0' && root.dataset.spMapTab) {
        root.removeAttribute('tabindex')
        delete root.dataset.spMapTab
      }
      if (!steps) return
    }
    if (!root.hasAttribute('tabindex')) {
      root.tabIndex = 0
      root.dataset.spMapTab = '1'
    }
    if (steps) {
      root.setAttribute('role', 'group')
      root.setAttribute('aria-keyshortcuts', 'Tab')
      root.setAttribute('aria-label', this.owner.text('chart3dSteps', { title: scene.title }))
      return
    }
    root.setAttribute('data-map', '')
    const box = !!scene.view3d
    root.setAttribute('aria-keyshortcuts', box ? 'ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 Tab' : 'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown + - 0')
    root.setAttribute('role', 'group')
    root.setAttribute('aria-roledescription', this.owner.text(box ? 'chart3dRole' : 'mapRole'))
    root.setAttribute('aria-label', this.owner.text(box ? 'chart3dKeys' : 'mapKeys', { title: scene.title }))
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
  private live(): Live | null {
    const scene = this.owner.scene()
    const cam = this.owner.camera()
    if (scene?.view3d) return { kind: '3d', v: cam ? makeView3d({ ...scene.view3d.input, camera: camera3dOf(cam) }) : scene.view3d.view }
    const geo = scene?.geo
    if (!geo) return null
    return { kind: 'geo', v: cam ? makeView({ ...geo.input, camera: cam as Camera }) : geo.view }
  }

  private dragged(l: Live, dx: number, dy: number, turn: boolean): Camera | Camera3d {
    return l.kind === '3d' ? dragCamera3d(l.v, dx, dy) : dragCamera(l.v, dx, dy, turn)
  }

  private zoomed(l: Live, factor: number): Camera | Camera3d {
    return l.kind === '3d' ? zoomCamera3d(l.v, factor) : zoomCamera(l.v, factor)
  }

  private zoomBy(factor: number): void {
    const l = this.live()
    if (!l) return
    this.owner.apply(this.zoomed(l, factor))
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
        const l = this.live()
        if (l) this.owner.apply(this.zoomed(l, after / before))
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
    const l = this.live()
    if (l) this.owner.apply(this.dragged(l, dx, dy, this.drag.turn || e.shiftKey))
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
    const l = this.live()
    if (!l) return
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0025
    this.owner.apply(this.zoomed(l, Math.exp(-e.deltaY * unit)))
    this.owner.gestureSoon()
  }

  /**
   * Arrow keys pan (Shift: turn and tilt), + and - zoom, 0 resets; on a 3D chart the arrows turn and tilt the box
   * and Tab steps through its data. With `camera` false only Tab works. True when the key was used.
   */
  key(e: KeyboardEvent, camera = true): boolean {
    if (e.altKey || e.ctrlKey || e.metaKey) return false
    const t = e.target as Element | null
    if (t && t !== this.root && t.closest?.('button, input, select, textarea, [data-lk]')) return false
    const l = this.live()
    if (!l) return false
    if (l.kind === '3d' && e.key === 'Tab') return this.tab(e)
    if (!camera) return false
    let c: Camera | Camera3d | null = null
    if (l.kind === '3d') {
      const v = l.v.camera
      switch (e.key) {
        case 'ArrowLeft': c = clampCamera3d({ ...v, bearing: v.bearing - 15 }); break
        case 'ArrowRight': c = clampCamera3d({ ...v, bearing: v.bearing + 15 }); break
        case 'ArrowUp': c = clampCamera3d({ ...v, pitch: v.pitch + 10 }); break
        case 'ArrowDown': c = clampCamera3d({ ...v, pitch: v.pitch - 10 }); break
      }
    } else {
      const v = l.v
      const step = 60
      switch (e.key) {
        case 'ArrowLeft': c = e.shiftKey ? clampCamera({ ...v.camera, bearing: v.camera.bearing - 15 }) : dragCamera(v, step, 0); break
        case 'ArrowRight': c = e.shiftKey ? clampCamera({ ...v.camera, bearing: v.camera.bearing + 15 }) : dragCamera(v, -step, 0); break
        case 'ArrowUp': c = e.shiftKey ? clampCamera({ ...v.camera, pitch: v.camera.pitch + 5 }) : dragCamera(v, 0, step); break
        case 'ArrowDown': c = e.shiftKey ? clampCamera({ ...v.camera, pitch: v.camera.pitch - 5 }) : dragCamera(v, 0, -step); break
      }
    }
    if (!c) {
      switch (e.key) {
        case '+': case '=': c = this.zoomed(l, 1.25); break
        case '-': case '_': c = this.zoomed(l, 1 / 1.25); break
        case '0': e.preventDefault(); this.owner.reset(); return true
        default: return false
      }
    }
    e.preventDefault()
    // In SVG the redraw replaces the focused region: keep keyboard focus on the map itself.
    const doc = this.root.ownerDocument
    if (doc.activeElement !== this.root && this.root.contains(doc.activeElement)) this.root.focus({ preventScroll: true })
    this.owner.apply(c)
    this.owner.gestureSoon()
    return true
  }

  /**
   * Tab on a 3D chart: the next data mark in `scene.view3d.order` (by x, then y), whatever the drawing order;
   * Shift+Tab the one before. Past the last one focus moves on to the legend, then out; before the first, back to
   * the chart itself.
   */
  private tab(e: KeyboardEvent): boolean {
    const order = this.owner.scene()?.view3d?.order ?? []
    if (!order.length) return false
    const el = (e.target as Element | null)?.closest?.('[data-i]')
    const at = el && this.root.contains(el) ? order.indexOf(Number(el.getAttribute('data-i'))) : -1
    const pos = at >= 0 ? at : this.cursor
    if (pos < 0 && e.shiftKey) return false
    const next = pos + (e.shiftKey ? -1 : 1)
    if (next < 0) {
      e.preventDefault()
      this.cursor = -1
      this.owner.focusMark(-1)
      this.root.focus({ preventScroll: true })
      return true
    }
    if (next >= order.length) {
      this.cursor = -1
      this.owner.focusMark(-1)
      // SVG draws the legend before the data, so the browser's own next stop would skip it.
      const legend = this.root.querySelector<HTMLElement | SVGElement>('svg [data-lk]')
      if (!legend) return false
      e.preventDefault()
      legend.focus({ preventScroll: true })
      return true
    }
    e.preventDefault()
    this.cursor = next
    this.owner.focusMark(order[next])
    return true
  }
}
