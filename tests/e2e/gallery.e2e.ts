import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const base = (): string => process.env.E2E_BASE!
let browser: Browser
const errors: string[] = []

beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => { await browser?.close() })

async function open(path: string, o: Parameters<Browser['newPage']>[0] = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1340, height: 900 }, ...o })
  page.on('pageerror', e => errors.push(`${path}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${path}: ${m.text()}`) })
  await page.goto(base() + path)
  await page.waitForSelector('svg, canvas')
  return page
}
const fig = (page: Page, id: string) => page.locator(`figure[data-id="${id}"]`)

describe('gallery', () => {
  it('draws every chart as an accessible svg, without console errors', async () => {
    const page = await open('/gallery/')
    const figs = page.locator('figure')
    expect(await figs.count()).toBeGreaterThanOrEqual(17)
    for (const f of await figs.all()) {
      const svg = f.locator('svg').first()
      expect(await svg.getAttribute('role')).toBe('img')
      expect((await svg.locator('title').textContent())?.length).toBeGreaterThan(2)
      expect((await svg.locator('desc').textContent())?.length).toBeGreaterThan(20)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1340)
    await page.close()
  })

  it('shows a tooltip over a bar, with the right numbers, and hides it on leave', async () => {
    const page = await open('/gallery/')
    const bar = fig(page, 'bar').locator('.sp-data[data-s="Q1"]').first()
    await bar.scrollIntoViewIfNeeded()
    await bar.hover()
    const tip = fig(page, 'bar').locator('.sp-tip')
    await expect.poll(() => tip.getAttribute('data-show')).not.toBeNull()
    const text = await tip.innerText()
    expect(text).toContain('APAC')
    expect(text).toContain('120')
    const box = (await tip.boundingBox())!
    const host = (await fig(page, 'bar').locator('.sp-root').boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(host.x + host.width + 1)
    await page.mouse.move(2, 2)
    await expect.poll(() => tip.getAttribute('data-show')).toBeNull()
    await page.close()
  })

  it('toggles a series by clicking the legend label (not just its edge), and keeps the last one', async () => {
    const page = await open('/gallery/')
    const f = fig(page, 'bar')
    await f.scrollIntoViewIfNeeded()
    const marks = (s: string): Promise<number> => f.locator(`.sp-data[data-s="${s}"]`).count()
    expect(await marks('Q1')).toBeGreaterThan(0)
    await f.locator('text.sp-legend', { hasText: 'Q1' }).click({ force: true }) // a real mouse click at the label: the row's hit area sits on top
    await expect.poll(() => marks('Q1')).toBe(0)
    expect(await marks('Q2')).toBeGreaterThan(0)
    await f.locator('text.sp-legend', { hasText: 'Q2' }).click({ force: true })
    await f.locator('text.sp-legend', { hasText: 'Q3' }).click({ force: true }) // would hide the last one: refused
    expect(await marks('Q3')).toBeGreaterThan(0)
    await f.locator('text.sp-legend', { hasText: 'Q1' }).click({ force: true }) // a real mouse click at the label: the row's hit area sits on top
    await expect.poll(() => marks('Q1')).toBeGreaterThan(0)
    await page.close()
  })

  it('works from the keyboard: legend with Enter, bars with Tab', async () => {
    const page = await open('/gallery/')
    const f = fig(page, 'bar')
    await f.scrollIntoViewIfNeeded()
    await f.locator('[data-lk="Q2"]').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => f.locator('.sp-data[data-s="Q2"]').count()).toBe(0)
    await f.locator('[data-lk="Q2"]').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => f.locator('.sp-data[data-s="Q2"]').count()).toBeGreaterThan(0)
    await f.locator('.sp-data[tabindex]').first().focus()
    await expect.poll(() => f.locator('.sp-tip').getAttribute('data-show')).not.toBeNull()
    await page.close()
  })

  it('line chart: crosshair and one tooltip row per series', async () => {
    const page = await open('/gallery/')
    const f = fig(page, 'line-dense')
    await f.scrollIntoViewIfNeeded()
    const box = (await f.locator('svg').boundingBox())!
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55)
    await expect.poll(() => f.locator('.sp-tip').getAttribute('data-show')).not.toBeNull()
    expect(await f.locator('svg g[pointer-events="none"] line').count()).toBe(1)
    expect(await f.locator('svg g[pointer-events="none"] circle').count()).toBeGreaterThanOrEqual(1)
    await page.close()
  })

  it('follows the theme switch and CSS-variable overrides without a re-render', async () => {
    const page = await open('/gallery/')
    const f = fig(page, 'bar')
    const fill = (sel: string): Promise<string> => f.locator(sel).first().evaluate(el => getComputedStyle(el).fill)
    expect(await fill('svg > rect')).toBe('rgb(255, 255, 255)')
    expect(await fill('.sp-data[data-s="Q1"]')).toBe('rgb(108, 74, 242)')
    await page.click('#theme [data-v="dark"]')
    await expect.poll(() => fill('svg > rect')).toBe('rgb(23, 23, 26)')
    await page.click('#theme [data-v="light"]')
    await page.check('#brand')
    expect(await fill('.sp-data[data-s="Q1"]')).toBe('rgb(232, 68, 90)')
    await page.close()
  })

  it('playground: an invalid spec shows code, path and hint; fixing it draws the chart', async () => {
    const page = await open('/gallery/')
    await page.fill('#spec', '{"type":"bar","data":[{"a":"x","b":1}],"x":"a","y":"c"}')
    await expect.poll(() => page.locator('#issues').innerText()).toContain('no_such_column')
    expect(await page.locator('#play-plot [role="alert"]').innerText()).toContain('Column "c" does not exist')
    await page.fill('#spec', '{"type":"bar","data":[{"a":"x","b":1}],"x":"a","y":"b"}')
    await expect.poll(() => page.locator('#play-plot svg').count()).toBe(1)
    expect(await page.locator('#issues li').count()).toBe(0)
    await page.close()
  })

  it('is responsive: no horizontal scroll on a phone, and charts follow a resize', async () => {
    const page = await open('/gallery/', { viewport: { width: 390, height: 800 } })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // The chart is as wide as its host at every viewport width, and re-flows when the window changes.
    const sizes = (): Promise<{ host: number; svg: number; vb: string }> => fig(page, 'bar').evaluate(f => {
      const svg = f.querySelector('svg')!
      return { host: Math.round(f.querySelector('.plot')!.getBoundingClientRect().width), svg: Math.round(svg.getBoundingClientRect().width), vb: svg.getAttribute('viewBox')!.split(' ')[2] }
    })
    const seen = new Set<number>()
    for (const w of [1340, 800, 600, 1000]) {
      await page.setViewportSize({ width: w, height: 900 })
      await expect.poll(async () => { const s = await sizes(); return s.vb === String(s.host) && s.svg === s.host }).toBe(true)
      seen.add((await sizes()).host)
    }
    expect(seen.size).toBeGreaterThan(2)
    await page.close()
  })

  it('respects prefers-reduced-motion', async () => {
    for (const [mode, animated] of [['reduce', false], ['no-preference', true]] as const) {
      const page = await open('/gallery/', { reducedMotion: mode })
      const name = await page.evaluate(() => {
        const root = document.querySelector('figure .sp-root')!
        root.classList.add('sp-enter')
        return getComputedStyle(root.querySelector('.sp-a-y, .sp-a-fade')!).animationName
      })
      expect(name !== 'none').toBe(animated)
      await page.close()
    }
  })

  it('mounts into a host that was detached and unsized, then picks up its height when attached', async () => {
    const page = await open('/canvas/')
    const h = await page.evaluate(async () => {
      const Plot = (window as unknown as { plot: { constructor: new (h: HTMLElement, s: unknown) => unknown } }).plot.constructor
      const host = document.createElement('div')
      host.id = 'late'
      host.style.cssText = 'height:300px;width:500px'
      new Plot(host, { type: 'bar', x: 'a', y: 'b', data: [{ a: 'x', b: 1 }, { a: 'y', b: 2 }] })
      document.body.appendChild(host)
      await new Promise(r => setTimeout(r, 300))
      return host.querySelector('svg')!.getAttribute('viewBox')
    })
    expect(h).toBe('0 0 500 300')
    await page.close()
  })

  it('has no console errors', () => {
    expect(errors).toEqual([])
  })
})
