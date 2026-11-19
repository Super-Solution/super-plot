import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot, validatePlot, renderToSvg, chartCatalog, drawScene, buildHitIndex, timeTicks, formatDuration, timeZoneName, zoneOffset, calendarDays, timelineItems, DEFAULT_STRINGS, type Canvas2D, type Scene, type Mark } from '../../packages/core/src'

const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const issues = (spec: unknown, o = {}): { code: string; path: string; severity: string; hint?: string }[] => compilePlot(spec, { width: 640, height: 420, ...o }).issues
const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => i.code)
type M<T extends Mark['type']> = Extract<Mark, { type: T }>
const of = <T extends Mark['type']>(s: Scene, type: T, role = 'data'): M<T>[] => s.marks.filter((m): m is M<T> => m.type === type && m.role === role)
const ex = (type: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === type)!.example)
const texts = (s: Scene, role = 'axis-label'): string[] => of(s, 'text', role).map(t => t.text)

/** Wall-clock fields of an instant in a zone, from the engine, to check ticks against. */
const local = (t: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number } => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(t).map(x => [x.type, Number(x.value)]))
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute }
}

// ---- timeline --------------------------------------------------------------------------------------

describe('timeline', () => {
  const tasks = (rows: [string, string, string, string?][]): Record<string, unknown>[] => rows.map(([task, from, to, team]) => ({ task, from, to, ...(team ? { team } : {}) }))
  const spec = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'timeline', y: 'task', start: 'from', end: 'to', data, ...extra })

  it('validates its catalog example cleanly and draws one bar per row with tip, aria and datum', () => {
    const e = ex('timeline')
    expect(validatePlot(e).issues).toEqual([])
    const s = compile(e)
    const bars = of(s, 'rect')
    expect(bars).toHaveLength(e.data.length)
    for (const b of bars) {
      expect(b.tip?.rows.map(r => r.label)).toEqual(['team', 'Start', 'End', 'Duration'])
      expect(b.aria).toMatch(/^.+, (Design|Backend|Frontend): .+ to .+ \(\d+ d\)$/)
      expect(b.datum).toMatchObject({ y: expect.any(String), start: expect.stringMatching(/^2026-/), end: expect.stringMatching(/^2026-/) })
    }
    expect(s.series.map(x => x.key)).toEqual(['Design', 'Backend', 'Frontend'])
    // The "today" line from the example's x annotation.
    expect(of(s, 'line', 'annotation')).toHaveLength(1)
    expect(s.axes?.x.kind).toBe('time')
    expect(s.axes?.y).toMatchObject({ kind: 'band', field: 'task' })
    expect(s.description).toContain('Timeline "Release 4.2 plan". 7 ranges in 7 lanes')
    expect(s.description).toContain('Longest: API (32 d).')
  })

  it('lays bars from start to end on the time axis, in lane order', () => {
    const s = compile(spec(tasks([['A', '2026-01-01', '2026-01-11'], ['B', '2026-01-06', '2026-01-21']])))
    const [a, b] = of(s, 'rect')
    const x = s.axes!.x
    const px = (t: number): number => x.range[0] + ((t - (x.domain as number[])[0]) / ((x.domain as number[])[1] - (x.domain as number[])[0])) * (x.range[1] - x.range[0])
    expect(a.x).toBeCloseTo(px(Date.UTC(2026, 0, 1)), 6)
    expect(a.x + a.w).toBeCloseTo(px(Date.UTC(2026, 0, 11)), 6)
    expect(b.x).toBeCloseTo(px(Date.UTC(2026, 0, 6)), 6)
    expect(a.y).toBeLessThan(b.y)
    expect(a.tip?.rows.find(r => r.label === 'Duration')?.value).toBe('10 d')
  })

  it('shows durations in days and hours, and dates with times when the data has them', () => {
    const s = compile(spec([{ task: 'Deploy', from: '2026-03-02T08:00:00Z', to: '2026-03-05T12:30:00Z' }]))
    const tip = of(s, 'rect')[0].tip!
    expect(tip.rows.find(r => r.label === 'Duration')?.value).toBe('3 d 5 h')
    expect(tip.rows.find(r => r.label === 'Start')?.value).toBe('Mar 2, 2026, 08:00')
  })

  it('swaps an end before its start, with range_reversed', () => {
    const d = spec(tasks([['A', '2026-01-10', '2026-01-01']]))
    expect(validatePlot(d).issues).toMatchObject([{ code: 'range_reversed', path: 'end', severity: 'warning' }])
    const bar = of(compile(d), 'rect')[0]
    expect(bar.datum).toMatchObject({ start: '2026-01-01T00:00:00.000Z', end: '2026-01-10T00:00:00.000Z' })
    expect(bar.w).toBeGreaterThan(100)
  })

  it('skips rows without both ends, and refuses data with none', () => {
    const d = spec([{ task: 'A', from: '2026-01-01', to: '2026-01-05' }, { task: 'B', from: '2026-01-02', to: null }, { task: 'C', from: '', to: '2026-01-03' }])
    expect(validatePlot(d).issues).toMatchObject([{ code: 'missing_range', path: 'end' }])
    expect(of(compile(d), 'rect')).toHaveLength(1)
    // `end` holds text that is not a date: start and end are not the same kind of value.
    expect(codes(spec([{ task: 'A', from: '2026-01-01', to: 'soon' }]))).toEqual(['not_time_or_number'])
    expect(codes(spec([{ task: 'A', from: 1, to: '2026-01-05' }]))).toEqual(['not_time_or_number'])
    // Dates read as numbers find no range.
    expect(codes(spec(tasks([['A', '2026-01-01', '2026-01-05']]), { xType: 'linear' }))).toEqual(['no_ranges'])
    expect(validatePlot(spec(tasks([['A', '2026-01-01', '2026-01-05']]), { end: 'nope' })).issues[0]).toMatchObject({ code: 'no_such_column', path: 'end' })
  })

  it('warns about overlapping bars in a lane and about too many lanes', () => {
    expect(codes(spec(tasks([['Room 1', '2026-01-01', '2026-01-05'], ['Room 1', '2026-01-04', '2026-01-08'], ['Room 2', '2026-01-01', '2026-01-02']])))).toEqual(['overlapping_ranges'])
    // Back to back is not an overlap.
    expect(codes(spec(tasks([['Room 1', '2026-01-01', '2026-01-05'], ['Room 1', '2026-01-05', '2026-01-08']])))).toEqual([])
    const many = Array.from({ length: 503 }, (_, i) => ({ task: `T${i}`, from: i, to: i + 2 }))
    const r = compilePlot(spec(many), { width: 640, height: 420 })
    expect(r.ok && r.issues.map(i => i.code)).toEqual(expect.arrayContaining(['too_many_lanes', 'timeline_cramped']))
    expect(r.ok && r.scene.axes!.y.domain).toHaveLength(500)
  })

  it('takes plain numbers, formatted with `format`', () => {
    const d = spec([{ task: 'Build', from: 0, to: 12.5 }, { task: 'Test', from: 10, to: 30 }], { format: 'fixed:1', xLabel: 'Minutes' })
    expect(codes(d)).toEqual([])
    const s = compile(d)
    expect(s.axes!.x.kind).toBe('linear')
    expect(of(s, 'rect')[0].tip!.rows.map(r => r.value)).toEqual(['0.0', '12.5', '12.5'])
    expect(of(s, 'rect')[0].datum).toMatchObject({ start: 0, end: 12.5 })
    expect(s.description).toContain('from 0.0 to 30.0')
  })

  it('colours by series, hides a series from the legend, and labels bars', () => {
    const d = spec(tasks([['A', '2026-01-01', '2026-01-20', 'x'], ['B', '2026-01-05', '2026-01-25', 'y']]), { series: 'team', labels: true })
    const s = compile(d)
    expect(s.series.map(x => x.key)).toEqual(['x', 'y'])
    const [a, b] = of(s, 'rect')
    expect(a.fill).not.toBe(b.fill)
    expect(texts(s, 'label')).toEqual(['19 d', '20 d'])
    const hidden = compile(d, { hidden: ['x'] })
    expect(of(hidden, 'rect').map(m => m.series)).toEqual(['y'])
    // A label column names the bar.
    const named = compile({ ...d, label: 'team' })
    expect(texts(named, 'label')).toEqual(['x', 'y'])
    expect(of(named, 'rect')[0].tip!.title).toBe('x')
  })

  it('zooms and brushes on x: xDomain cuts the bars, the brush reports a range without a filter column', () => {
    const d = spec(tasks([['A', '2026-01-01', '2026-01-10'], ['B', '2026-02-01', '2026-02-10'], ['C', '2026-03-01', '2026-03-10']]), { zoom: 'xy', brush: 'xy' })
    const s = compile(d)
    expect(s.axes).toMatchObject({ zoom: 'x', brush: 'x' })
    expect(s.axes!.x.field).toBeUndefined()
    const zoomed = compile(d, { view: { x: [Date.UTC(2026, 0, 25), Date.UTC(2026, 1, 15)] } })
    const bars = of(zoomed, 'rect')
    expect(bars.map(b => b.datum)).toMatchObject([{ y: 'B' }])
    expect(bars[0].clip).toBe('plot')
    expect(zoomed.clips?.plot).toBeDefined()
  })

  it('works in small multiples, the canvas renderer and SVG', () => {
    const d = spec(tasks([['A', '2026-01-01', '2026-01-10', 'x'], ['B', '2026-01-05', '2026-01-20', 'y'], ['C', '2026-01-02', '2026-01-12', 'x']]), { facet: 'team' })
    const s = compile(d)
    expect(s.panels?.map(p => p.key)).toEqual(['x', 'y'])
    expect(of(s, 'rect')).toHaveLength(3)
    const calls: string[] = []
    const ctx: Record<string, unknown> = { globalAlpha: 1 }
    for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fill', 'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash']) ctx[k] = () => calls.push(k)
    drawScene(ctx as unknown as Canvas2D, compile(ex('timeline')))
    expect(calls.filter(c => c === 'fill').length).toBeGreaterThanOrEqual(7)
    const tl = compile(ex('timeline'))
    const bar = of(tl, 'rect')[2]
    expect(tl.marks[buildHitIndex(tl).at(bar.x + bar.w / 2, bar.y + bar.h / 2)]).toBe(bar)
    expect(renderToSvg(ex('timeline'))).toContain('Longest: API (32 d).')
  })

  it('exposes its parsing as timelineItems', () => {
    const d = timelineItems(spec(tasks([['A', '2026-01-05', '2026-01-01'], ['A', '2026-01-02', '2026-01-09']])))
    expect(d.kind).toBe('time')
    expect(d.reversed).toBe(1)
    expect(d.overlapping).toEqual(['A'])
    expect(d.items[0]).toMatchObject({ lane: 'A', start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 5), swapped: true })
  })
})

describe('formatDuration', () => {
  const H = 36e5
  const D = 24 * H
  it('uses at most two units, rounding into the larger one', () => {
    expect(formatDuration(3 * D + 4 * H, 'en')).toBe('3 d 4 h')
    expect(formatDuration(2 * H + 15 * 6e4, 'en')).toBe('2 h 15 min')
    expect(formatDuration(D, 'en')).toBe('1 d')
    expect(formatDuration(D + 23 * H + 59.7 * 6e4, 'en')).toBe('2 d')
    expect(formatDuration(59 * 6e4 + 59.6e3, 'en')).toBe('1 h')
    expect(formatDuration(59.7e3, 'en')).toBe('1 min')
    expect(formatDuration(45e3, 'en')).toBe('45 s')
    expect(formatDuration(500, 'en')).toBe('0.5 s')
    expect(formatDuration(0, 'en')).toBe('0 s')
    expect(formatDuration(-3 * H, 'en')).toBe('-3 h')
    expect(formatDuration(1.5e3, 'de', { day: 'T', hour: 'Std', minute: 'Min', second: 's' })).toBe('1,5 s')
    expect(formatDuration(1000 * D, 'de', { day: 'T', hour: 'Std', minute: 'Min', second: 's' })).toBe('1.000 T')
  })
})

// ---- stream graph ----------------------------------------------------------------------------------

describe('area stack: "center" (stream graph)', () => {
  const data = [{ x: 1, a: 2, b: 4 }, { x: 2, a: 6, b: 2 }, { x: 3, a: 1, b: 1 }]
  const spec = { type: 'area', x: 'x', y: ['a', 'b'], stack: 'center', data }

  it('centres each x on the middle: the layers run from -total/2 to +total/2', () => {
    const s = compile(spec)
    const y = s.axes!.y
    expect(y.domain).toEqual([-4, 4])
    const mid = (y.range[0] + y.range[1]) / 2
    const scale = (v: number): number => y.range[0] + ((v + 4) / 8) * (y.range[1] - y.range[0])
    // The hit strips' focus points sit at each series' top edge: a ends at -total/2 + a, b at +total/2.
    const hits = of(s, 'rect', 'hit')
    expect(hits).toHaveLength(3)
    expect(hits[0].focus!.map(f => f.y)).toEqual([scale(-3 + 2), scale(3)])
    expect(hits[2].focus!.map(f => f.y)).toEqual([scale(0), scale(1)])
    expect(scale(0)).toBeCloseTo(mid, 9)
  })

  it('shows no value ticks (there is no zero), and gives the total in the tooltip', () => {
    const s = compile(spec)
    const plot = s.axes!.plot
    const left = of(s, 'text', 'axis-label').filter(t => t.x < plot.x)
    expect(left).toEqual([])
    expect(of(s, 'line', 'grid')).toEqual([])
    expect(of(s, 'rect', 'hit')[1].tip!.rows).toEqual([{ label: 'a', value: '6', color: expect.any(String) }, { label: 'b', value: '2', color: expect.any(String) }, { label: 'Total', value: '8' }])
    // Every layer is outlined above, and the lowest below as well.
    expect(of(s, 'path').filter(p => p.stroke && !p.fill)).toHaveLength(3)
  })

  it('is described as a stream graph, refuses an interval, and leaves the other stacks alone', () => {
    expect(describePlot(spec).ok && (describePlot(spec) as { text: string }).text).toMatch(/^Stream graph\. 2 series .* The layers are stacked around a centre line, so the vertical axis has no zero; the thickness of each layer is its value\.$/)
    expect(codes({ ...spec, y: 'a', yLower: 'a', yUpper: 'b', data: [{ x: 1, a: 1, b: 2 }, { x: 2, a: 2, b: 3 }] })).toEqual(['interval_ignored_stacked'])
    const stacked = compile({ ...spec, stack: 'stack' })
    expect(stacked.axes!.y.domain[0]).toBe(0)
    expect(of(stacked, 'line', 'grid').length).toBeGreaterThan(0)
  })

  it('keeps hidden series out of the centring', () => {
    const s = compile(spec, { hidden: ['b'] })
    expect(s.axes!.y.domain).toEqual([-3, 3])
  })
})

// ---- locale and time zone --------------------------------------------------------------------------

describe('locale-aware dates', () => {
  it('names months and weekdays in the locale, and keeps English output unchanged', () => {
    const jan = Date.UTC(2026, 0, 1)
    const jun = Date.UTC(2026, 5, 1)
    expect(timeTicks(jan, jun, 6, 'en').map(t => t.label)).toEqual(['2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
    expect(timeTicks(jan, jun, 6, 'de').map(t => t.label)).toEqual(['2026', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun'])
    const line = { type: 'line', x: 'd', y: 'v', data: [{ d: '2026-01-05', v: 1 }, { d: '2026-03-02', v: 2 }] }
    expect(of(compile(line, { locale: 'fr' }), 'rect', 'hit')[0].tip!.title).toBe('5 janv. 2026')
    const cal = compile(ex('calendar'), { locale: 'fr' })
    expect(texts(cal)).toEqual(expect.arrayContaining(['lun.', 'janv.']))
    expect(of(cal, 'rect').find(m => m.tip)!.tip!.rows[1].value).toMatch(/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)$/)
  })
})

describe('timeZone render option', () => {
  const NY = 'America/New_York'

  it('places day ticks on local midnights across the spring-forward change in New York', () => {
    const ticks = timeTicks(Date.UTC(2026, 2, 5), Date.UTC(2026, 2, 12), 7, 'en', NY)
    expect(ticks.length).toBeGreaterThanOrEqual(6)
    for (const t of ticks) expect(local(t.value, NY)).toMatchObject({ h: 0, mi: 0 })
    expect(ticks.map(t => t.label)).toEqual(['Mar 5', 'Mar 6', 'Mar 7', 'Mar 8', 'Mar 9', 'Mar 10', 'Mar 11'])
    // The day of the change is 23 hours long.
    const i = ticks.findIndex(t => t.label === 'Mar 8')
    expect(ticks[i + 1].value - ticks[i].value).toBe(23 * 36e5)
  })

  it('keeps hour ticks on local hours over both changes in New York', () => {
    const spring = timeTicks(Date.UTC(2026, 2, 8, 4), Date.UTC(2026, 2, 8, 10), 6, 'en', NY)
    // 04:00 to 10:00 UTC is 23:00 on Mar 7 to 06:00 local; 02:00 does not exist that night.
    expect(spring.map(t => t.label)).toEqual(['23:00', 'Mar 8', '01:00', '03:00', '04:00', '05:00', '06:00'])
    for (const t of spring) expect(local(t.value, NY).mi).toBe(0)
    // Fall back: 01:00 happens twice and both get a tick.
    const fall = timeTicks(Date.UTC(2026, 10, 1, 3), Date.UTC(2026, 10, 1, 9), 6, 'en', NY)
    expect(fall.map(t => t.label)).toEqual(['23:00', 'Nov 1', '01:00', '01:00', '02:00', '03:00', '04:00'])
    const six = timeTicks(Date.UTC(2026, 2, 7, 12), Date.UTC(2026, 2, 9), 8, 'en', NY)
    for (const t of six) expect(local(t.value, NY).h % 6).toBe(0)
  })

  it('places month ticks on local first days in London, through summer time', () => {
    const LDN = 'Europe/London'
    const ticks = timeTicks(Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31), 12, 'en', LDN)
    expect(ticks.map(t => t.label)).toEqual(['2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    for (const t of ticks) expect(local(t.value, LDN)).toMatchObject({ d: 1, h: 0, mi: 0 })
    expect(ticks[3].value).toBe(Date.UTC(2026, 2, 31, 23))
    const days = timeTicks(Date.UTC(2026, 2, 26), Date.UTC(2026, 3, 3), 7, 'en', LDN)
    for (const t of days) expect(local(t.value, LDN)).toMatchObject({ h: 0, mi: 0 })
    // Half-hour and 45-minute zones work the same way.
    for (const t of timeTicks(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2), 6, 'en', 'Asia/Kathmandu')) expect(local(t.value, 'Asia/Kathmandu').mi).toBe(0)
  })

  it('shifts ticks, tooltips and the description of a chart, and leaves UTC alone by default', () => {
    const line = { type: 'line', x: 't', y: 'v', data: [{ t: '2026-03-08T04:00:00Z', v: 1 }, { t: '2026-03-08T12:00:00Z', v: 2 }, { t: '2026-03-08T20:00:00Z', v: 3 }] }
    const utc = compile(line)
    const ny = compile(line, { timeZone: NY })
    expect(of(utc, 'rect', 'hit')[0].tip!.title).toBe('Mar 8, 2026, 04:00')
    expect(of(ny, 'rect', 'hit')[0].tip!.title).toBe('Mar 7, 2026, 23:00')
    expect(of(ny, 'rect', 'hit')[1].aria).toBe('Mar 8, 2026, 08:00: v 2')
    expect(texts(ny)).toContain('Mar 8')
    expect(utc.description).toContain('at Mar 8, 2026')
    expect(ny.description).toContain('from 1 at Mar 7, 2026')
    expect(describePlot(line, { timeZone: NY }).ok && (describePlot(line, { timeZone: NY }) as { text: string }).text).toBe(ny.description)
    expect(compile(line, { timeZone: 'UTC' })).toEqual(utc)
  })

  it('warns about an unknown zone and falls back to UTC', () => {
    const line = { type: 'line', x: 't', y: 'v', data: [{ t: '2026-03-08T04:00:00Z', v: 1 }, { t: '2026-03-09T04:00:00Z', v: 2 }] }
    for (const tz of ['Mars/Olympus', '', 42]) {
      const r = compilePlot(line, { timeZone: tz as string })
      expect(r.ok && r.issues).toMatchObject([{ code: 'bad_time_zone', path: 'timeZone', severity: 'warning' }])
      expect(r.ok && r.scene).toEqual(compilePlot(line).ok && (compilePlot(line) as { scene: Scene }).scene)
    }
    expect(timeZoneName('america/new_york')).toBe(NY)
    expect(timeZoneName('Mars/Olympus')).toBeNull()
    expect(zoneOffset(Date.UTC(2026, 0, 15), NY)).toBe(-5 * 36e5)
    expect(zoneOffset(Date.UTC(2026, 6, 15), NY)).toBe(-4 * 36e5)
    expect(zoneOffset(Date.UTC(2026, 0, 15), 'Asia/Kolkata')).toBe(5.5 * 36e5)
  })

  it('warns when date-only values meet another zone (they are midnights UTC)', () => {
    const line = { type: 'line', x: 'd', y: 'v', data: [{ d: '2026-03-01', v: 1 }, { d: '2026-03-02', v: 2 }] }
    expect(issues(line, { timeZone: NY })).toMatchObject([{ code: 'time_zone_dates', path: 'x' }])
    expect(issues(line, { timeZone: 'Europe/London' })).toEqual([]) // GMT in March: midnight UTC is local midnight
    expect(issues(line)).toEqual([])
    expect(issues(ex('timeline'), { timeZone: 'Asia/Tokyo' }).map(i => i.code)).toEqual(['time_zone_dates'])
  })

  it('counts calendar instants on their local day, and keeps date-only days', () => {
    const rows = [{ t: '2026-03-01T03:00:00Z', v: 1 }, { t: Date.UTC(2026, 2, 1, 3), v: 2 }, { t: '2026-03-01', v: 4 }]
    const day = (d: number): number => Math.floor(d / 864e5)
    expect([...calendarDays(rows, 't', 'v')]).toEqual([[day(Date.UTC(2026, 2, 1)), 7]])
    expect([...calendarDays(rows, 't', 'v', NY)]).toEqual([[day(Date.UTC(2026, 1, 28)), 3], [day(Date.UTC(2026, 2, 1)), 4]])
    const cal = compile({ type: 'calendar', x: 't', value: 'v', data: rows }, { timeZone: NY })
    expect(of(cal, 'rect').filter(m => m.tip).map(m => m.datum)).toEqual([{ date: '2026-02-28', value: 3 }, { date: '2026-03-01', value: 4 }])
  })
})

// ---- UI strings ------------------------------------------------------------------------------------

describe('strings render option', () => {
  it('exports the English defaults, which are what charts show without overrides', () => {
    expect(DEFAULT_STRINGS.other).toBe('Other')
    expect(DEFAULT_STRINGS.legendToggle).toBe('{label}: toggle series')
    const s = compile(ex('waterfall'))
    expect(s.series.map(x => x.label)).toEqual(['Increase', 'Decrease', 'Total'])
  })

  it('translates legend entries, tooltip labels and accessible names, keeping keys and descriptions', () => {
    const strings = { increase: 'Zunahme', decrease: 'Abnahme', total: 'Summe', runningTotal: 'Laufende Summe', legendToggle: '{label} ein- oder ausblenden', increaseAria: '{name}: plus {value}, Summe {total}' }
    const s = compile(ex('waterfall'), { strings, locale: 'de' })
    expect(s.series.map(x => [x.key, x.label])).toEqual([['increase', 'Zunahme'], ['decrease', 'Abnahme'], ['total', 'Summe']])
    expect(of(s, 'rect', 'legend').filter(m => m.legendKey).map(m => m.aria)).toEqual(['Zunahme ein- oder ausblenden', 'Abnahme ein- oder ausblenden', 'Summe ein- oder ausblenden'])
    const step = of(s, 'rect').find(m => (m.datum as { kind?: string })?.kind === 'increase')!
    expect(step.tip!.rows.map(r => r.label)).toEqual(['Zunahme', 'Laufende Summe'])
    expect(step.aria).toMatch(/^Revenue: plus 420, Summe 420$/)
    expect(s.description).toBe(compile(ex('waterfall'), { locale: 'de' }).description)
    expect(s.description).toMatch(/^Waterfall chart/)
  })

  it('renames the merged slice but keeps its key', () => {
    const data = 'abcdefghij'.split('').map((k, i) => ({ k, v: 10 - i }))
    const s = compile({ type: 'pie', label: 'k', value: 'v', maxSlices: 4, data }, { strings: { other: 'Andere', share: 'Anteil' } })
    const other = s.series.find(x => x.key === 'Other')!
    expect(other.label).toBe('Andere')
    const slice = of(s, 'path').find(m => m.series === 'Other')!
    expect(slice.tip!.title).toBe('Andere')
    expect(slice.tip!.rows[1].label).toBe('Anteil')
    expect(slice.datum).toMatchObject({ label: 'Other' })
  })

  it('fills placeholders and leaves out the ones an override drops', () => {
    const tl = compile(ex('timeline'), { strings: { start: 'Début', end: 'Fin', duration: 'Durée', unitDay: 'j', timelineAria: '{task} : {duration}' }, locale: 'fr' })
    const bar = of(tl, 'rect')[0]
    expect(bar.tip!.rows.map(r => r.label)).toEqual(['team', 'Début', 'Fin', 'Durée'])
    expect(bar.tip!.rows[3].value).toBe('18 j')
    expect(bar.aria).toBe('Research, Design : 18 j')
  })

  it('warns about unknown keys, wrong types and long values instead of failing', () => {
    const spec = ex('pie')
    expect(issues(spec, { strings: { totl: 'Summe' } })).toMatchObject([{ code: 'unknown_string', path: 'strings.totl', hint: 'Did you mean "total"?' }])
    expect(issues(spec, { strings: { total: 5 } as never })).toMatchObject([{ code: 'bad_string', path: 'strings.total' }])
    expect(issues(spec, { strings: 'de' as never })).toMatchObject([{ code: 'bad_strings', path: 'strings' }])
    expect(issues(spec, { strings: { total: 'x'.repeat(200) } })).toMatchObject([{ code: 'string_truncated', path: 'strings.total' }])
    expect(issues(spec, { strings: { constructor: 'x' } as never })).toMatchObject([{ code: 'unknown_string' }])
  })
})
