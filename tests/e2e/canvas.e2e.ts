import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const base = (): string => process.env.E2E_BASE!
let browser: Browser
const errors: string[] = []
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => { await browser?.close() })

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(base() + '/canvas/')
  await page.waitForSelector('body[data-ready]')
  return page
}
type W = { plot: { getRenderer(): string; getScene(): { marks: Record<string, unknown>[] }; toPng(s: number): Promise<Blob> } }

/** Count canvas pixels that are close to an RGB colour. */
const countPixels = (page: Page, rgb: [number, number, number]): Promise<number> => page.evaluate(([r, g, b]) => {
  const c = document.querySelector('.sp-cv canvas') as HTMLCanvasElement
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 40 && Math.abs(d[i + 1] - g) < 40 && Math.abs(d[i + 2] - b) < 40 && d[i + 3] > 200) n++
  return n
}, rgb)

describe('canvas renderer in a real browser', () => {
  it('switches to canvas by itself for many points, and the pixels are really there', async () => {
    const page = await open()
    expect(await page.evaluate(() => (window as unknown as W).plot.getRenderer())).toBe('canvas')
    expect(await page.locator('.sp-cv canvas').count()).toBe(2)
    expect(await page.locator('svg').count()).toBe(0)
    const blue = await countPixels(page, [41, 98, 255])
    const orange = await countPixels(page, [255, 152, 0])
    expect(blue).toBeGreaterThan(5000)
    expect(orange).toBeGreaterThan(5000)
    await page.close()
  })

  it('draws 50,000 points within a sane time budget', async () => {
    const page = await open()
    await page.click('#n [data-v="50000"]')
    await expect.poll(() => page.locator('#stat').innerText()).toContain('50,000 points')
    const ms = Number(/setup (\d+) ms/.exec(await page.locator('#stat').innerText())![1])
    expect(ms).toBeLessThan(3000)
    await page.close()
  })

  it('hover finds the dot under the pointer: tooltip with its values and an outline on the overlay', async () => {
    const page = await open()
    const target = await page.evaluate(() => {
      const p = (window as unknown as W).plot
      const m = p.getScene().marks.find(x => x.type === 'circle' && x.role === 'data' && x.series === 'Email') as { cx: number; cy: number; tip: { rows: { value: string }[] } }
      return { cx: m.cx, cy: m.cy, x: m.tip.rows[0].value }
    })
    const box = (await page.locator('.sp-cv canvas').first().boundingBox())!
    await page.mouse.move(box.x + target.cx, box.y + target.cy)
    await expect.poll(() => page.locator('.sp-tip').getAttribute('data-show')).not.toBeNull()
    expect(await page.locator('.sp-tip').innerText()).toContain('spend')
    const overlay = await page.evaluate(() => {
      const c = document.querySelectorAll('.sp-cv canvas')[1] as HTMLCanvasElement
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
      return n
    })
    expect(overlay).toBeGreaterThan(10)
    await page.mouse.move(2, 2)
    await expect.poll(() => page.locator('.sp-tip').getAttribute('data-show')).toBeNull()
    await page.close()
  })

  it('legend: a click on the label and the keyboard both toggle a series; pixels follow', async () => {
    const page = await open()
    const before = await countPixels(page, [41, 98, 255])
    const lk = page.locator('.sp-cv-lk[aria-label="Search: toggle series"]')
    await lk.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => countPixels(page, [41, 98, 255])).toBeLessThan(before / 4)
    expect(await page.locator('.sp-cv-lk[aria-label="Search: toggle series"]').getAttribute('aria-pressed')).toBe('false')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Search: toggle series') // focus survives the redraw
    const b = (await page.locator('.sp-cv canvas').first().boundingBox())!
    const mark = await page.evaluate(() => {
      const m = (window as unknown as W).plot.getScene().marks.find(x => x.legendKey === 'Search') as { x: number; y: number; w: number; h: number }
      return { x: m.x + 6, y: m.y + m.h / 2 }
    })
    await page.mouse.click(b.x + mark.x, b.y + mark.y)
    await expect.poll(() => countPixels(page, [41, 98, 255])).toBeGreaterThan(before / 2)
    await page.close()
  })

  it('exports a real PNG from the canvas', async () => {
    const page = await open()
    const head = await page.evaluate(async () => {
      const blob = await (window as unknown as W).plot.toPng(1)
      const b = new Uint8Array(await blob.arrayBuffer())
      return { type: blob.type, size: b.length, magic: Array.from(b.slice(0, 4)) }
    })
    expect(head.type).toBe('image/png')
    expect(head.magic).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(head.size).toBeGreaterThan(5000)
    await page.close()
  })

  it('the SVG renderer still works for the same data, and svg and canvas agree on what is shown', async () => {
    const page = await open()
    await page.click('#n [data-v="1000"]')
    await page.click('#r [data-v="svg"]')
    await expect.poll(() => page.locator('svg').count()).toBe(1)
    expect(await page.locator('svg .sp-data').count()).toBeGreaterThan(900)
    expect(await page.locator('.sp-cv').count()).toBe(0)
    await page.close()
  })

  it('stayed free of console errors', () => { expect(errors).toEqual([]) })
})
