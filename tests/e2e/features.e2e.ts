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
