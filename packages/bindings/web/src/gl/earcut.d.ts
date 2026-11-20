// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
declare module 'earcut' {
  /** Triangulate a polygon (flat coordinates, hole start indices): returns vertex indices, three per triangle. */
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number>, dim?: number): number[]
}
