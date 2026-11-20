// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// `/base` on its own: nothing registered until the page asks. This file never imports the package root, so the
// registries start empty (vitest gives each file its own modules).
import { describe, expect, it } from 'vitest'
import { applyTransform, chartTypes, getChart, registerChart, registerCharts, registerTransform, registerTransforms, renderToSvg, transformTypes, validatePlot, type Issue } from '@supersolutions/super-plot-core/base'
import { allCharts, chartGroups } from '@supersolutions/super-plot-core/charts'
import { basicCharts, bar, line } from '@supersolutions/super-plot-core/charts/basic'
import { businessCharts } from '@supersolutions/super-plot-core/charts/business'
import { statsCharts } from '@supersolutions/super-plot-core/charts/stats'
import { mapCharts } from '@supersolutions/super-plot-core/charts/maps'
import { hierarchyCharts } from '@supersolutions/super-plot-core/charts/hierarchy'
import { charts3d } from '@supersolutions/super-plot-core/charts/3d'
import { textCharts } from '@supersolutions/super-plot-core/charts/text'
import { aggregateStep, allTransforms, filterStep, TRANSFORM_DOCS } from '@supersolutions/super-plot-core/transforms'
import { TRANSFORM_OPS } from '@supersolutions/super-plot-core/base'
import { packages } from '../../scripts/packages.mjs'
import { overBudget } from '../../scripts/size-budget.mjs'

const groups = { basic: basicCharts, business: businessCharts, stats: statsCharts, maps: mapCharts, hierarchy: hierarchyCharts, '3d': charts3d, text: textCharts }

describe('chart groups', () => {
  it('cover every chart exactly once', () => {
    const all = Object.values(groups).flat()
    expect(all).toHaveLength(allCharts.length)
    expect(new Set(all).size).toBe(all.length)
    expect([...all].map(d => d.type).sort()).toEqual(allCharts.map(d => d.type).sort())
  })
  it('are the arrays `/charts` lists in chartGroups, and each has its entry point', () => {
    expect(chartGroups).toEqual(groups)
    const entries = packages[0].entries as Record<string, string>
    for (const name of Object.keys(groups)) expect(entries[`charts/${name}`]).toBe(`src/groups/${name}.ts`)
  })
  it('the basic group is the everyday charts', () => {
    expect(basicCharts.map(d => d.type)).toEqual(['bar', 'line', 'area', 'scatter', 'pie', 'donut', 'histogram', 'box', 'heatmap'])
    expect(basicCharts[0]).toBe(bar)
  })
})

describe('/base without the chart types or transform steps', () => {
  it('knows no chart type until one is registered', () => {
    expect(chartTypes()).toEqual([])
    expect(validatePlot({ type: 'bar', data: [{ a: 1 }] }).issues[0]).toMatchObject({ code: 'unknown_type', path: 'type' })
    registerChart(line)
    expect(chartTypes()).toEqual(['line'])
  })
  it('registerCharts registers a whole group, and specs without a transform validate and render', () => {
    registerCharts(basicCharts)
    expect(basicCharts.every(d => getChart(d.type) === d)).toBe(true)
    for (const d of basicCharts) {
      expect(d.example.transform).toBeUndefined()
      expect(validatePlot(d.example).ok).toBe(true)
      expect(renderToSvg(d.example, { width: 400, height: 300 })).toMatch(/^<svg/)
    }
    expect(transformTypes()).toEqual([])
  })
  it('a transform step that is not registered is an error with its path and the import to add, never skipped', () => {
    registerCharts(basicCharts)
    const r = validatePlot({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }], transform: [{ filter: { field: 'v', gt: 1 } }] })
    expect(r.ok).toBe(false)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatchObject({ severity: 'error', code: 'transform_not_registered', path: 'transform[0].filter' })
    expect(r.issues[0].hint).toContain('@supersolutions/super-plot-core/transforms')
    expect(r.issues[0].hint).toContain('filterStep')
    // An unknown step is still `bad_transform`, and an empty list needs no step at all.
    expect(validatePlot({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }], transform: [{ filtr: {} }] }).issues[0].code).toBe('bad_transform')
    expect(validatePlot({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }], transform: [] }).ok).toBe(true)
  })
  it('steps register one by one; the next missing one is reported where it is used', () => {
    registerTransforms([filterStep])
    expect(transformTypes()).toEqual(['filter'])
    const issues: Issue[] = []
    const rows = [{ k: 'a', v: 1 }, { k: 'a', v: 3 }, { k: 'b', v: 2 }]
    expect(applyTransform([{ filter: { field: 'v', gte: 2 } }], rows, issues)).toEqual([{ k: 'a', v: 3 }, { k: 'b', v: 2 }])
    expect(applyTransform([{ filter: { field: 'v', gte: 2 } }, { aggregate: { groupBy: ['k'], count: 'n' } }], rows, issues)).toBeNull()
    expect(issues.map(i => [i.code, i.path])).toEqual([['transform_not_registered', 'transform[1].aggregate']])
    registerTransform(aggregateStep)
    expect(applyTransform([{ filter: { field: 'v', gte: 2 } }, { aggregate: { groupBy: ['k'], count: 'n' } }], rows, [])).toEqual([{ k: 'a', n: 1 }, { k: 'b', n: 1 }])
    expect(transformTypes()).toEqual(['filter', 'aggregate'])
  })
  it('allTransforms is every step, in order, each documented; an unknown step name is refused', () => {
    expect(allTransforms.map(d => d.op)).toEqual([...TRANSFORM_OPS])
    expect(Object.keys(TRANSFORM_DOCS)).toEqual([...TRANSFORM_OPS])
    expect(() => registerTransform({ op: 'calculate' as never, run() {} })).toThrow(/Unknown transform step/)
    registerTransforms(allTransforms)
    expect(transformTypes()).toEqual([...TRANSFORM_OPS])
  })
})

describe('size budgets (scripts/size.mjs --check)', () => {
  it('reports the cases over budget, and cases missing on either side', () => {
    expect(overBudget({ a: 10, b: 20 }, { a: 11, b: 21 })).toEqual([])
    expect(overBudget({ a: 12, b: 20 }, { a: 11, b: 21 })).toEqual([{ name: 'a', size: 12, budget: 11 }])
    expect(overBudget({ a: 10, c: 1 }, { a: 11, b: 21 }).map(o => o.name)).toEqual(['c', 'b'])
  })
})
