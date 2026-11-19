declare module 'earcut' {
  /** Triangulate a polygon (flat coordinates, hole start indices): returns vertex indices, three per triangle. */
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number>, dim?: number): number[]
}
