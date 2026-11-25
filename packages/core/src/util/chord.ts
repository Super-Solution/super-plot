// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC

/** The empty angle between two arcs, in radians. */
export const CHORD_GAP = 0.03

export interface ChordFlow { source: string; target: string; value: number }
export interface ChordNode { name: string; /** Angle where the arc starts, radians from 0 (a full turn is 2 PI). */ start: number; end: number; /** In plus out: what the arc's length stands for. */ total: number }
export interface ChordRibbon { sourceStart: number; sourceEnd: number; targetStart: number; targetEnd: number }
export interface ChordLayout { nodes: ChordNode[]; ribbons: ChordRibbon[] }

/**
 * The arcs and ribbons of a chord diagram, from flows already summed per (source, target) with a positive value
 * and `source !== target`. No force simulation and no random numbers: the order is the data's, so the same flows
 * always give the same angles, and a port (Go, Python) must give the same numbers. The exact algorithm:
 *
 * 1. Nodes in the order they first appear when the flows are read in order, `source` before `target`.
 * 2. `total` of a node: the sum of `value` of the flows it is the source or the target of, added in flow order.
 * 3. `k = (2 PI - n * CHORD_GAP) / whole`, `whole` being the sum of the nodes' totals added in node order
 *    (`n` is the number of nodes; with no flows, no nodes and no ribbons).
 * 4. Arcs run in node order from angle 0: `start`, then `end = start + total * k`, the next `start` being
 *    `end + CHORD_GAP`.
 * 5. Inside an arc, the flows that touch the node are laid out from `start` in the order of the node at their other
 *    end (node order), a flow the node is the source of before one it is the target of; each takes `value * k` of
 *    angle (`a1 = a0 + value * k`, the next `a0` is that `a1`). A flow's two pieces are its ribbon's two ends.
 *
 * `ribbons[i]` belongs to `flows[i]`; its `source*` piece sits in the source's arc, `target*` in the target's.
 */
export function chordLayout(flows: readonly ChordFlow[], gap: number = CHORD_GAP): ChordLayout {
  const index = new Map<string, number>()
  const names: string[] = []
  const at = (name: string): number => {
    let i = index.get(name)
    if (i === undefined) { i = names.length; index.set(name, i); names.push(name) }
    return i
  }
  for (const f of flows) { at(f.source); at(f.target) }
  const n = names.length
  const total = new Array<number>(n).fill(0)
  for (const f of flows) { total[at(f.source)] += f.value; total[at(f.target)] += f.value }
  let whole = 0
  for (const t of total) whole += t
  if (!n || !(whole > 0)) return { nodes: [], ribbons: [] }
  const k = (2 * Math.PI - n * gap) / whole
  const nodes: ChordNode[] = []
  let a = 0
  for (let i = 0; i < n; i++) {
    const end = a + total[i] * k
    nodes.push({ name: names[i], start: a, end, total: total[i] })
    a = end + gap
  }
  const ribbons: ChordRibbon[] = flows.map(() => ({ sourceStart: 0, sourceEnd: 0, targetStart: 0, targetEnd: 0 }))
  for (let i = 0; i < n; i++) {
    const touching: { other: number; dir: number; flow: number }[] = []
    flows.forEach((f, j) => {
      if (at(f.source) === i) touching.push({ other: at(f.target), dir: 0, flow: j })
      else if (at(f.target) === i) touching.push({ other: at(f.source), dir: 1, flow: j })
    })
    touching.sort((p, q) => p.other - q.other || p.dir - q.dir || p.flow - q.flow)
    let cursor = nodes[i].start
    for (const t of touching) {
      const end = cursor + flows[t.flow].value * k
      if (t.dir === 0) { ribbons[t.flow].sourceStart = cursor; ribbons[t.flow].sourceEnd = end } else { ribbons[t.flow].targetStart = cursor; ribbons[t.flow].targetEnd = end }
      cursor = end
    }
  }
  return { nodes, ribbons }
}
