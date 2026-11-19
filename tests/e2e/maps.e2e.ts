import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const base = (): string => process.env.E2E_BASE!
let browser: Browser
const errors: string[] = []
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => {
  await browser?.close()
  expect(errors).toEqual([])
})

type P = {
  getRenderer(): string
  getCamera(): { lng: number; lat: number; zoom: number; pitch: number; bearing: number } | null
  getScene(): { geo?: { view: { camera: { lng: number } } }; marks: { tip?: unknown }[] } | null
}
const plot = <T>(page: Page, f: (p: P) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.plot)`) as Promise<T>

async function open(path = '/maps/'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(base() + path)
  await page.waitForSelector('body[data-ready]')
  return page
}
async function pick(page: Page, chart: string, view: string, renderer: string): Promise<void> {
  await page.click(`#chart [data-v="${chart}"]`)
  await page.click(`#view [data-v="${view}"]`)
  await page.click(`#r [data-v="${renderer}"]`)
  await expect.poll(() => plot(page, p => p.getRenderer()), { timeout: 5000 }).toBe(renderer === 'auto' ? expect.any(String) : renderer)
}
const shot = async (page: Page): Promise<PNG> => PNG.sync.read(await page.locator('#plot').screenshot())

describe('maps and WebGL in a real browser', () => {
  it('WebGL draws the same map as SVG (flat and raised)', async () => {
    const page = await open()
    for (const [chart, view, limit] of [['choropleth', 'flat', 0.01], ['raised', 'tilted', 0.04]] as const) {
      await pick(page, chart, view, 'svg')
      const svg = await shot(page)
      await pick(page, chart, view, 'webgl')
      expect(await page.locator('.sp-cv canvas').count()).toBe(4) // 2D below, GPU, 2D above, hover
      const gl = await shot(page)
      const diff = pixelmatch(svg.data, gl.data, undefined, svg.width, svg.height, { threshold: 0.2 })
      expect(diff / (svg.width * svg.height)).toBeLessThan(limit)
    }
    await page.close()
  })

  it('the GPU picks the region under the pointer for the tooltip', async () => {
    const page = await open()
    await pick(page, 'raised', 'globe', 'webgl')
    const box = (await page.locator('#plot').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20)
    await expect.poll(() => page.locator('.sp-tip').getAttribute('data-show')).not.toBeNull()
    expect(await page.locator('.sp-tip').innerText()).toContain('rain')
    await page.close()
  })

  it('a click on a region selects it on every renderer (a drag does not)', async () => {
    const page = await open()
    for (const r of ['svg', 'canvas', 'webgl']) {
      await pick(page, 'choropleth', 'flat', r)
      await page.evaluate(() => {
        const w = window as unknown as { plot: { setOptions(o: unknown): void }; picked: unknown[] }
        w.picked = []
        w.plot.setOptions({ onSelect: (e: unknown) => w.picked.push(e) })
      })
      const box = (await page.locator('#plot').boundingBox())!
      const x = box.x + box.width / 2, y = box.y + box.height / 2
      await page.mouse.click(x, y)
      expect(await page.evaluate(() => (window as unknown as { picked: unknown[] }).picked.length)).toBe(1)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 60, y, { steps: 5 })
      await page.mouse.up()
      expect(await page.evaluate(() => (window as unknown as { picked: unknown[] }).picked.length)).toBe(1)
    }
    await page.close()
  })

  it('dragging turns the globe on the GPU without recompiling, then the scene catches up', async () => {
    const page = await open()
    await pick(page, 'columns', 'globe', 'webgl')
    const before = (await plot(page, p => p.getCamera()))!
    const box = (await page.locator('#plot').boundingBox())!
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 120, y + 30, { steps: 8 })
    // Mid-gesture: the camera moved, the compiled scene has not (no rebuild per frame).
    const mid = await page.evaluate(() => {
      const w = window as unknown as { plot: P & { scene: { geo: { view: { camera: { lng: number } } } } } }
      return { cam: w.plot.getCamera()!.lng, compiled: w.plot.scene.geo.view.camera.lng }
    })
    expect(mid.cam).toBeLessThan(before.lng)
    expect(mid.compiled).toBe(before.lng)
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => (window as unknown as { plot: P }).plot.getScene()!.geo!.view.camera.lng)).toBeCloseTo(mid.cam, 6)
    await page.close()
  })

  it('a lost WebGL context falls back to canvas and keeps working', async () => {
    const page = await open()
    await pick(page, 'flows', 'globe', 'webgl')
    await page.evaluate(() => {
      const c = document.querySelectorAll('.sp-cv canvas')[1] as HTMLCanvasElement
      ;(c.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!.loseContext()
    })
    await expect.poll(() => plot(page, p => p.getRenderer())).toBe('canvas')
    expect(await page.locator('.sp-cv canvas').count()).toBe(2)
    await page.close()
  })

  it('imports a GeoJSON file and maps it', async () => {
    const page = await open()
    const sq = (x: number, y: number): number[][] => [[x, y], [x + 5, y], [x + 5, y + 5], [x, y + 5], [x, y]]
    const fc = { type: 'FeatureCollection', features: ['P', 'Q', 'R'].map((id, i) => ({ type: 'Feature', id, properties: { name: `Land ${id}` }, geometry: { type: 'Polygon', coordinates: [sq(i * 6, 0)] } })) }
    await page.setInputFiles('#file', { name: 'lands.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fc)) })
    await expect.poll(() => page.locator('#issues').innerText()).toContain('Loaded 3 regions')
    expect(await page.locator('#plot .sp-error').count()).toBe(0)
    expect(await page.locator('#plot').innerText().catch(() => '')).not.toContain('error')
    await page.close()
  })

  it('50,000 dots on WebGL: drawn, hoverable', async () => {
    const page = await open('/canvas/')
    await page.click('#n [data-v="50000"]')
    await page.click('#r [data-v="webgl"]')
    await expect.poll(() => page.locator('#stat').innerText()).toContain('Renderer webgl')
    const img = await shot(page)
    let blue = 0
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 2] > 200 && img.data[i] < 140 && img.data[i + 1] < 170) blue++
    expect(blue).toBeGreaterThan(3000)
    const target = await page.evaluate(() => {
      const s = (window as unknown as { plot: { getScene(): { marks: { type: string; role: string; cx: number; cy: number }[] } } }).plot.getScene()
      const m = s.marks.find(x => x.type === 'circle' && x.role === 'data')!
      return { x: m.cx, y: m.cy }
    })
    const box = (await page.locator('.sp-cv canvas').first().boundingBox())!
    await page.mouse.move(box.x + target.x, box.y + target.y)
    await expect.poll(() => page.locator('.sp-tip').getAttribute('data-show')).not.toBeNull()
    await page.close()
  })
})
