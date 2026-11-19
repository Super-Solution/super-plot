// Visual regression: every gallery chart, light and dark, against stored PNGs.
//   E2E_VISUAL=1 npm run test:e2e        compare (fails above 0.3% changed pixels)
//   E2E_VISUAL=update npm run test:e2e   write new baselines after an intended visual change
// Off by default: pixels depend on the fonts of the machine. Baselines here were made with the Chromium and
// system sans-serif font of the dev container; regenerate them when you change machines.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const mode = process.env.E2E_VISUAL
const dir = join(dirname(fileURLToPath(import.meta.url)), '__baselines__')
let browser: Browser
beforeAll(async () => { if (mode) browser = await chromium.launch() })
afterAll(async () => { await browser?.close() })

describe.skipIf(!mode)('visual regression', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`gallery in ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1340, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      await page.goto(process.env.E2E_BASE + '/gallery/?theme=' + theme)
      await page.waitForSelector('figure svg')
      await page.evaluate(() => document.fonts.ready)
      const ids = await page.locator('figure').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id!))
      const failures: string[] = []
      for (const id of ids) {
        const shot = await page.locator(`figure[data-id="${id}"] .card`).screenshot()
        const file = join(dir, `${id}.${theme}.png`)
        if (mode === 'update' || !existsSync(file)) {
          mkdirSync(dir, { recursive: true })
          writeFileSync(file, shot)
          continue
        }
        const a = PNG.sync.read(readFileSync(file))
        const b = PNG.sync.read(shot)
        if (a.width !== b.width || a.height !== b.height) { failures.push(`${id}: size ${a.width}x${a.height} became ${b.width}x${b.height}`); continue }
        const diff = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.12 })
        if (diff / (a.width * a.height) > 0.003) {
          writeFileSync(join(dir, `${id}.${theme}.actual.png`), shot)
          failures.push(`${id}: ${diff} pixels differ (${((diff / (a.width * a.height)) * 100).toFixed(2)}%); see ${id}.${theme}.actual.png`)
        }
      }
      await page.close()
      expect(failures).toEqual([])
    })
  }
})
