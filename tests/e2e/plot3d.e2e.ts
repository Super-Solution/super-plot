// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { chartCatalog } from '@supersolutions/super-plot-core'

const base = (): string => process.env.E2E_BASE!
let browser: Browser
const errors: string[] = []
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => {
  await browser?.close()
  expect(errors).toEqual([])
})
const ex = (t: string): unknown => chartCatalog().find(c => c.type === t)!.example

/** The maps page has a plot on `window.plot`; give it a 3D spec and a renderer. */
async function open(type: string, renderer: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(base() + '/maps/')
  await page.waitForSelector('body[data-ready]')
  await page.evaluate(async ([spec, r]) => {
    const p = (window as unknown as { plot: { setSpec(s: unknown): void; setOptions(o: unknown): void; ready(): Promise<void> } }).plot
    p.setOptions({ renderer: r, onIssues: undefined })
    p.setSpec(spec)
    await p.ready()
  }, [ex(type), renderer] as const)
  return page
}
const renderer = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { plot: { getRenderer(): string } }).plot.getRenderer())
const camera = (page: Page): Promise<{ zoom: number; pitch: number; bearing: number }> => page.evaluate(() => (window as unknown as { plot: { getCamera(): { zoom: number; pitch: number; bearing: number } } }).plot.getCamera())
const shot = async (page: Page): Promise<PNG> => PNG.sync.read(await page.locator('#plot').screenshot())

describe('3D charts in a real browser', () => {
  it('WebGL draws the 3D scatter like canvas does', async () => {
    const page = await open('scatter3d', 'canvas')
    expect(await renderer(page)).toBe('canvas')
    const cv = await shot(page)
    await page.evaluate(async () => {
      const p = (window as unknown as { plot: { setOptions(o: unknown): void; ready(): Promise<void> } }).plot
      p.setOptions({ renderer: 'webgl' })
      await p.ready()
    })
    expect(await renderer(page)).toBe('webgl')
    const gl = await shot(page)
    const diff = pixelmatch(cv.data, gl.data, undefined, cv.width, cv.height, { threshold: 0.2 })
    expect(diff / (cv.width * cv.height)).toBeLessThan(0.01)
    await page.close()
  })

  it('a drag turns the box, the arrow keys too, and the tooltip finds a point', async () => {
    const page = await open('scatter3d', 'svg')
    const before = await camera(page)
    const box = (await page.locator('#plot .sp-root').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    const after = await camera(page)
    expect(after.bearing).not.toBe(before.bearing)
    await page.locator('#plot .sp-root').focus()
    await page.keyboard.press('ArrowUp')
    expect((await camera(page)).pitch).toBe(Math.min(90, after.pitch + 10))
    await page.keyboard.press('Tab')
    await expect.poll(() => page.locator('#plot .sp-tip').getAttribute('data-show')).not.toBeNull()
    expect(await page.locator('#plot .sp-tip').innerText()).toMatch(/height/)
    await page.close()
  })

  it('the surface draws with every renderer', async () => {
    for (const r of ['svg', 'canvas', 'webgl']) {
      const page = await open('surface', r)
      const img = await shot(page)
      // Coloured tiles cover a good part of the plot (not a blank or failed frame).
      let coloured = 0
      for (let i = 0; i < img.data.length; i += 4) if (Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) - Math.min(img.data[i], img.data[i + 1], img.data[i + 2]) > 60) coloured++
      expect(coloured / (img.width * img.height)).toBeGreaterThan(0.03)
      await page.close()
    }
  })
})
