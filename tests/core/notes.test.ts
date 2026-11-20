import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, type Mark, type Scene } from '../../packages/core/src'

type R = Record<string, unknown>
const data: R[] = [
  { q: '2026-Q1', rev: 10, rev_note: '', cost: 4, cost_note: '' },
  { q: '2026-Q2', rev: null, rev_note: 'Not given: missing F', cost: 5, cost_note: 'restated' },
  { q: '2026-Q3', rev: 12, rev_note: '  est.  ', cost: 6, cost_note: '' },
]
const scene = (extra: R = {}): Scene => {
  const r = compilePlot({ type: 'line', x: 'q', y: ['rev', 'cost'], data, notes: { rev: 'rev_note', cost: 'cost_note' }, ...extra }, { width: 640, height: 400 })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const tipAt = (s: Scene, title: string) => s.marks.find((m): m is Mark & { tip: { title: string; rows: { label: string; value: string }[] } } => m.role === 'hit' && (m as any).tip?.title === title)?.tip

describe('notes: text from a column in the tooltip', () => {
  it('stands in for a missing value', () => {
    expect(tipAt(scene(), '2026-Q2')!.rows.find(r => r.label === 'rev')!.value).toBe('Not given: missing F')
  })
  it('follows a value that is there, trimmed, and is left out when empty', () => {
    const s = scene()
    expect(tipAt(s, '2026-Q2')!.rows.find(r => r.label === 'cost')!.value).toMatch(/^5.*\(restated\)$/)
    expect(tipAt(s, '2026-Q3')!.rows.find(r => r.label === 'rev')!.value).toMatch(/\(est\.\)$/)
    expect(tipAt(s, '2026-Q1')!.rows.map(r => r.value).join('|')).not.toContain('(')
  })
  it('without notes the tooltip is as before', () => {
    const r = compilePlot({ type: 'line', x: 'q', y: ['rev', 'cost'], data }, { width: 640, height: 400 })
    if (!r.ok) throw new Error('x')
    const hit = r.scene.marks.find(m => m.role === 'hit' && (m as any).tip?.title === '2026-Q2') as any
    expect(hit.tip.rows.map((x: any) => x.label)).toEqual(['cost'])
  })
  it('is validated: an object of series name to a column name', () => {
    expect(validatePlot({ type: 'line', x: 'q', y: 'rev', data, notes: ['rev_note'] }).ok).toBe(false)
    const bad = validatePlot({ type: 'line', x: 'q', y: 'rev', data, notes: { rev: 3, cost: '' } })
    expect(bad.issues.filter(i => i.severity === 'error').map(i => i.path)).toEqual(['notes.rev', 'notes.cost'])
  })
})
