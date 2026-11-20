import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

// Card references in a real browser: the chat plugin's demo host (links that highlight and reveal part of a plot),
// and plot.highlight / plot.reveal on SVG, canvas and WebGL.
const base = (): string => process.env.E2E_BASE!
let browser: Browser
const errors: string[] = []
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => {
  await browser?.close()
  expect(errors).toEqual([])
})

async function open(path: string, viewport = { width: 1000, height: 900 }): Promise<Page> {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(base() + path)
  await page.waitForSelector('body[data-ready]')
  return page
}
type Box = { x: number; y: number; width: number; height: number }
const outlines = (page: Page, card: string): Promise<number> => page.locator(`[data-card="${card}"] svg.sp-ref .sp-ref-o > *`).count()
const near = (a: Box, b: Box, tol = 3): boolean => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol

describe('chat plugin demo host', () => {
  it('hovering a link outlines the matching bar exactly over it, with its tooltip; leaving clears it', async () => {
    const page = await open('/chat/')
    // After the entrance animation, so the bars are where the scene says.
    await page.waitForFunction(() => !document.querySelector('[data-card="sales"] .sp-enter'))
    await page.hover('a.ref >> text=March was highest')
    expect(await outlines(page, 'sales')).toBe(1)
    // The outline sits on the bar it names (scene coordinates mapped like the chart's own).
    const outline = (await page.locator('[data-card="sales"] svg.sp-ref .sp-ref-o > rect').boundingBox())!
    const i = await page.evaluate(() => {
      const svg = document.querySelector('[data-card="sales"] svg:not(.sp-ref)')!
      return [...svg.querySelectorAll('.sp-data')].findIndex(e => e.getAttribute('aria-label')?.includes('2026-03'))
    })
    expect(i).toBeGreaterThanOrEqual(0)
    const bar = (await page.locator('[data-card="sales"] svg:not(.sp-ref) .sp-data').nth(i).boundingBox())!
    expect(near(outline, bar)).toBe(true)
    await expect.poll(() => page.locator('[data-card="sales"] .sp-tip[data-show]').innerText()).toContain('2026-03')
    // Not by colour alone: the outline is a dark stroke over a light halo.
    const strokes = await page.evaluate(() => [...document.querySelectorAll('[data-card="sales"] svg.sp-ref g')].map(g => getComputedStyle(g).stroke))
    expect(strokes.filter(s => s && s !== 'none').length).toBeGreaterThanOrEqual(2)
    await page.mouse.move(5, 5)
    expect(await outlines(page, 'sales')).toBe(0)
    await page.close()
  })

  it('from the keyboard: focus highlights, Enter reveals and moves focus into the card, Escape clears', async () => {
    const page = await open('/chat/')
    await page.focus('a.ref >> text=The first quarter')
    expect(await outlines(page, 'sales')).toBe(3)
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-card]')?.getAttribute('data-card'))).toBe('sales')
    expect(await page.locator('[data-card="sales"] .sp-live').innerText()).toMatch(/^Showing /)
    expect(await outlines(page, 'sales')).toBe(3)
    await page.keyboard.press('Escape')
    expect(await outlines(page, 'sales')).toBe(0)
    await page.close()
  })

  it('a link that names nothing is plain text from the start, with its reason for screen readers', async () => {
    const page = await open('/chat/')
    await expect.poll(() => page.locator('.plain-ref').count()).toBe(1)
    expect(await page.locator('a.ref >> text=week 40').count()).toBe(0)
    expect(await page.locator('.plain-ref').innerText()).toContain('week 40')
    expect(await page.locator('.plain-ref .sr').innerText()).toMatch(/nothing|no row|match/i)
    await page.close()
  })

  it('works over the canvas renderer: outlines over the canvas, and reveal focuses it', async () => {
    const page = await open('/chat/')
    expect(await page.locator('[data-card="campaigns"] .sp-cv canvas').count()).toBeGreaterThan(0)
    await page.hover('a.ref >> text=Email')
    expect(await outlines(page, 'campaigns')).toBe(2000)
    const overlay = (await page.locator('[data-card="campaigns"] svg.sp-ref').boundingBox())!
    const canvas = (await page.locator('[data-card="campaigns"] .sp-cv').boundingBox())!
    expect(near(overlay, canvas, 1)).toBe(true)
    await page.click('a.ref >> text=the big spenders')
    await expect.poll(() => page.evaluate(() => document.activeElement?.localName)).toBe('canvas')
    expect(await page.evaluate(() => document.activeElement?.closest('[data-card]')?.getAttribute('data-card'))).toBe('campaigns')
    await page.close()
  })

  it('hovering a mark lights the words that name it (onRefChange)', async () => {
    const page = await open('/chat/')
    const i = await page.evaluate(() => [...document.querySelectorAll('[data-card="sales"] svg .sp-data')].findIndex(e => e.getAttribute('aria-label')?.includes('2026-03')))
    await page.locator('[data-card="sales"] svg .sp-data').nth(i).hover()
    await expect.poll(() => page.locator('a.ref.lit').allInnerTexts()).toEqual(['March was highest'])
    await page.mouse.move(5, 5)
    await expect.poll(() => page.locator('a.ref.lit').count()).toBe(0)
    await page.close()
  })

  it('agent tools: annotations drawn with the assistant mark survive a remount; the highlight goes when the viewer moves', async () => {
    const page = await open('/chat/')
    await page.click('[data-tool="annotate"]')
    await expect.poll(() => page.locator('#tool-out').innerText()).toContain('"applied"')
    expect(await page.locator('[data-card="sales"] svg:not(.sp-ref)').textContent()).toContain('✦ Peak')
    await page.click('[data-tool="remount"]')
    await expect.poll(() => page.locator('[data-card="sales"] svg:not(.sp-ref)').textContent()).toContain('✦ Peak')
    await page.click('[data-tool="highlight"]')
    expect(await outlines(page, 'sales')).toBe(3)
    const bar = page.locator('[data-card="sales"] svg:not(.sp-ref) .sp-data').first()
    await bar.hover()
    expect(await outlines(page, 'sales')).toBe(0)
    await page.close()
  })

  it('forced colours draw the outline in Highlight; reduced motion animates nothing', async () => {
    const page = await open('/chat/')
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
    await page.hover('a.ref >> text=March was highest')
    const [stroke, highlight] = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'Highlight'
      document.body.appendChild(probe)
      const h = getComputedStyle(probe).color
      probe.remove()
      return [getComputedStyle(document.querySelector('[data-card="sales"] svg.sp-ref .sp-ref-o > *')!).stroke, h]
    })
    expect(stroke).toBe(highlight)
    expect(await page.evaluate(() => document.querySelector('[data-card="sales"] svg.sp-ref')!.getAnimations({ subtree: true }).length)).toBe(0)
    await page.close()
  })
})

describe('highlight and reveal on other renderers', () => {
  it('WebGL: the overlay lines up with the GPU-drawn dots', async () => {
    const page = await open('/canvas/', { width: 1200, height: 800 })
    await page.click('#r [data-v="webgl"]')
    const renderer = await page.evaluate(() => (window as unknown as { plot: { getRenderer(): string } }).plot.getRenderer())
    expect(['webgl', 'canvas']).toContain(renderer)
    const r = await page.evaluate(() => (window as unknown as { plot: { highlight(r: string): unknown } }).plot.highlight('ref:p?series=Email&x=80..'))
    expect(r).toMatchObject({ ok: true })
    const n = await page.locator('svg.sp-ref .sp-ref-o > *').count()
    expect(n).toBeGreaterThan(10)
    const overlay = (await page.locator('svg.sp-ref').boundingBox())!
    const cv = (await page.locator('.sp-cv').boundingBox())!
    expect(near(overlay, cv, 1)).toBe(true)
    const rv = await page.evaluate(() => (window as unknown as { plot: { reveal(r: string): unknown } }).plot.reveal('ref:p?series=Search&x=..5'))
    expect(rv).toMatchObject({ ok: true })
    expect(await page.evaluate(() => document.activeElement?.localName)).toBe('canvas')
    await page.close()
  })

  it('reveal zooms a zoomed line chart back out to show the point', async () => {
    const page = await open('/features/', { width: 1200, height: 900 })
    type P = { setZoom(z: unknown): void; getZoom(): unknown; reveal(r: string): { ok: boolean } }
    await page.evaluate(() => (window as unknown as { plots: Record<string, P> }).plots.daily.setZoom({ x: ['2026-03-01', '2026-03-31'] }))
    await expect.poll(() => page.evaluate(() => (window as unknown as { plots: Record<string, P> }).plots.daily.getZoom())).not.toBeNull()
    const r = await page.evaluate(() => (window as unknown as { plots: Record<string, P> }).plots.daily.reveal('ref:daily?x=2026-06-10&series=EMEA'))
    expect(r.ok).toBe(true)
    expect(await page.evaluate(() => (window as unknown as { plots: Record<string, P> }).plots.daily.getZoom())).toBeNull()
    expect(await page.locator('#daily svg.sp-ref .sp-ref-o > *').count()).toBe(1)
    await expect.poll(() => page.locator('#daily-out').innerText()).toBe('Full range')
    await page.close()
  })
})
