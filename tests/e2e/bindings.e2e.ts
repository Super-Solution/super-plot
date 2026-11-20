import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const base = (): string => process.env.E2E_BASE!
let browser: Browser
const errors: string[] = []
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => { await browser?.close() })

async function open(path: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('pageerror', e => errors.push(`${path}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${path}: ${m.text()}`) })
  await page.goto(base() + path)
  await page.waitForSelector('svg')
  return page
}

describe('<super-plot> element (no bundler)', () => {
  it('renders from the attribute, applies CSS variables, and emits plot-select', async () => {
    const page = await open('/element/')
    expect(await page.locator('super-plot svg').count()).toBe(1)
    const first = await page.locator('super-plot .sp-data').first().evaluate(el => getComputedStyle(el).fill)
    expect(first).toBe('rgb(232, 68, 90)') // --sp-series-1 set on the element
    const got = page.evaluate(() => new Promise(r => document.getElementById('p')!.addEventListener('plot-select', e => r((e as CustomEvent).detail.datum), { once: true })))
    // The slice's bounding box centre is the donut's hole: aim for the right edge of the ring.
    const slice = page.locator('super-plot .sp-data').first()
    const b = (await slice.boundingBox())!
    await slice.click({ position: { x: b.width - 8, y: b.height / 2 } })
    expect(await got).toMatchObject({ label: 'Organic', value: 48200 })
    await page.close()
  })

  it('updates when the spec property changes and cleans up when removed', async () => {
    const page = await open('/element/')
    await page.evaluate(() => { (document.getElementById('p') as unknown as { spec: unknown }).spec = { type: 'bar', x: 'a', y: 'b', data: [{ a: 'x', b: 3 }] } })
    await expect.poll(() => page.locator('super-plot svg title').textContent()).toBe('Bar chart')
    await page.evaluate(() => document.getElementById('p')!.remove())
    expect(await page.locator('.sp-tip').count()).toBe(0)
    await page.close()
  })
})

describe('React example', () => {
  it('renders, switches chart type without remounting wrongly, and reports the clicked mark', async () => {
    const page = await open('/react/')
    expect(await page.locator('svg').count()).toBe(1)
    await page.getByRole('button', { name: 'line' }).click()
    await expect.poll(() => page.locator('svg title').textContent()).toBe('Revenue vs cost')
    expect(await page.locator('svg .sp-data circle, svg circle.sp-data').count()).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'bar' }).click()
    await page.locator('.sp-data').first().click()
    await expect.poll(() => page.locator('pre').innerText()).toContain('Jul')
    await page.getByRole('button', { name: 'dark' }).click()
    await expect.poll(() => page.locator('svg > rect').first().evaluate(e => getComputedStyle(e).fill)).toBe('rgb(23, 23, 26)')
    expect(await page.locator('svg').count()).toBe(1) // still one chart: no duplicate mounts
    await page.close()
  })
})

describe('console', () => {
  it('stayed clean', () => { expect(errors).toEqual([]) })
})
