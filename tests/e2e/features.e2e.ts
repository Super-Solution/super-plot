import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const base = (): string => process.env.E2E_BASE!
let browser: Browser
const errors: string[] = []
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => { await browser?.close() })

type P = { getScene(): { title: string; axes?: { plot: { x: number; y: number; w: number; h: number } }; marks: { role: string }[] }; getZoom(): unknown; getBrush(): unknown; getRenderer(): string; setOptions(o: object): void }
type W = { plots: Record<string, P> }

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(base() + '/features/')
  await page.waitForSelector('body[data-ready]')
  return page
}
const plotRect = async (page: Page, id: string): Promise<{ x: number; y: number; w: number; h: number }> => {
  const box = (await page.locator(`#${id} .sp-root`).boundingBox())!
  const p = await page.evaluate(k => (window as unknown as W).plots[k].getScene().axes!.plot, id)
  return { x: box.x + p.x, y: box.y + p.y, w: p.w, h: p.h }
}

describe('features page in a real browser', () => {
  it('brushing the line chart filters the linked bars; a click clears it', async () => {
    const page = await open()
    const r = await plotRect(page, 'daily')
    await page.mouse.move(r.x + r.w * 0.2, r.y + 30)
    await page.mouse.down()
    await page.mouse.move(r.x + r.w * 0.5, r.y + 60, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => (window as unknown as W).plots.linked.getScene().title)).toBe('Revenue in the brushed days')
    expect(await page.locator('#daily .sp-brush').count()).toBe(1)
    expect(await page.locator('#daily-out').innerText()).toMatch(/^Brushed 2026-\d\d-\d\d to 2026-/)
    // No text got selected by the drag.
    expect(await page.evaluate(() => String(getSelection()))).toBe('')
    await page.mouse.click(r.x + r.w * 0.8, r.y + 30)
    await expect.poll(() => page.evaluate(() => (window as unknown as W).plots.linked.getScene().title)).toBe('Revenue, all days')
    await page.close()
  })

  it('Ctrl-wheel zooms the time axis, double-click resets, on SVG and on canvas', async () => {
    const page = await open()
    for (const renderer of ['svg', 'canvas']) {
      await page.evaluate(r => (window as unknown as W).plots.daily.setOptions({ renderer: r }), renderer)
      const r = await plotRect(page, 'daily')
      await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2)
      await page.keyboard.down('Control')
      for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200)
      await page.keyboard.up('Control')
      await expect.poll(() => page.locator('#daily-out').innerText()).toMatch(/^Zoomed to/)
      expect(await page.evaluate(() => (window as unknown as W).plots.daily.getRenderer())).toBe(renderer)
      await page.mouse.dblclick(r.x + r.w / 2, r.y + r.h / 2)
      await expect.poll(() => page.locator('#daily-out').innerText()).toBe('Full range')
    }
    await page.close()
  })

  it('canvas keyboard: arrows move a highlighted point with its tooltip and a spoken label', async () => {
    const page = await open()
    await page.evaluate(() => (window as unknown as W).plots.facet.setOptions({ renderer: 'canvas' }))
    const canvas = page.locator('#facet .sp-cv canvas').first()
    await canvas.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => page.locator('#facet .sp-tip').getAttribute('data-show')).not.toBeNull()
    expect(await page.locator('#facet .sp-live').innerText()).toMatch(/tenure/)
    await page.close()
  })

  it('transition: bars move between data states on SVG and canvas, end as drawn directly, and snap under reduced motion', async () => {
    const page = await open()
    // The bar heights in the SVG chart, by team (bars with rounded corners are paths: their bounding boxes).
    const heights = (): Promise<Record<string, number>> => page.evaluate(() => Object.fromEntries([...document.querySelectorAll<SVGGraphicsElement>('#trans .sp-data')].map(e => [e.getAttribute('aria-label')!.split(',')[0], Math.round(e.getBBox().height * 10) / 10])))
    const before = await heights()
    const sample: Record<string, number>[] = []
    await page.click('#trans-next')
    // The labels are the new ones at once; the geometry goes through in-between values.
    const after = await page.evaluate(() => (window as unknown as W).plots.trans.getScene().marks.filter(m => m.role === 'data').length)
    for (let i = 0; i < 4; i++) { sample.push(await heights()); await page.waitForTimeout(60) }
    await page.waitForTimeout(400)
    const end = await heights()
    expect(Object.keys(end).length).toBe(after)
    const shared = Object.keys(before).filter(k => k in end && before[k] !== end[k])
    expect(shared.length).toBeGreaterThan(0)
    const k = shared[0]
    expect(sample.some(s => s[k] !== undefined && Math.abs(s[k] - before[k]) > 0.5 && Math.abs(s[k] - end[k]) > 0.5)).toBe(true)
    expect(await page.locator('#trans g.sp-ghost').count()).toBe(0)
    // The end state is exactly what a fresh chart of the same spec draws.
    const same = await page.evaluate(() => {
      const p = (window as unknown as W & { plots: Record<string, { toSvg(): string; getScene(): unknown }> }).plots.trans
      const host = document.createElement('div')
      host.style.width = `${document.getElementById('trans')!.clientWidth}px`
      host.style.height = `${document.getElementById('trans')!.clientHeight}px`
      document.body.appendChild(host)
      const Ctor = (p as unknown as { constructor: new (h: HTMLElement, s: unknown, o: object) => { toSvg(): string; dispose(): void } }).constructor
      const q = new Ctor(host, (p as unknown as { spec: unknown }).spec, { animate: false })
      const ok = q.toSvg() === p.toSvg() && host.querySelector('svg')!.innerHTML.replace(/sp\d+-/g, '') === document.querySelector('#trans svg')!.innerHTML.replace(/sp\d+-/g, '')
      q.dispose()
      host.remove()
      return ok
    })
    expect(same).toBe(true)
    expect(await page.evaluate(() => (window as unknown as W).plots.transCv.getRenderer())).toBe('canvas')
    // Reduced motion: the next update is drawn at once.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.click('#trans-next')
    const now = await heights()
    await page.waitForTimeout(400)
    expect(await heights()).toEqual(now)
    expect(errors).toEqual([])
    await page.close()
  })

  it('live data keeps appending without errors; the data table is in the page', async () => {
    const page = await open()
    const n = (): Promise<number> => page.evaluate(() => (window as unknown as W).plots.live.getScene().marks.length)
    const before = await n()
    await page.waitForTimeout(800)
    expect(await page.locator('#live-out').innerText()).toMatch(/Drawn in [\d.]+ ms/)
    expect(await n()).toBeGreaterThanOrEqual(before)
    expect(await page.locator('#plugin table.sp-table th').allInnerTexts()).toEqual(['month', 'plan', 'forecast'])
    await page.check('#table-toggle')
    expect(await page.locator('#plugin table.sp-table').isVisible()).toBe(true)
    expect(errors).toEqual([])
    await page.close()
  })
})
