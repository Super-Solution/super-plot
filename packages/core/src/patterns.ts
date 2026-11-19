/**
 * Textures for `patterns: true`: one per series, drawn over the fill in the surface colour so a series stays
 * recognisable without its hue (colour-vision deficiency, greyscale print). Each is an 8 x 8 px tile; the
 * same numbers drive the SVG `<pattern>` and the canvas tile, so both renderers look alike.
 */
export interface PatternTile {
  /** Strokes in tile space (a path `d`), drawn with `width`. */
  lines?: string
  /** Dot centres [x, y] with `r`. */
  dots?: [number, number][]
  r?: number
  width?: number
}

export const PATTERN_SIZE = 8

export const PATTERNS: readonly PatternTile[] = [
  { lines: 'M-2 2L2 -2M0 8L8 0M6 10L10 6', width: 1.3 },
  { dots: [[2, 2], [6, 6]], r: 1.2 },
  { lines: 'M0 2H8M0 6H8', width: 1.2 },
  { lines: 'M-2 2L2 -2M0 8L8 0M6 10L10 6M-2 6L2 10M0 0L8 8M6 -2L10 2', width: 1 },
  { lines: 'M2 0V8M6 0V8', width: 1.2 },
  { lines: 'M-2 6L2 10M0 0L8 8M6 -2L10 2', width: 1.3 },
  { lines: 'M0 4H8M4 0V8', width: 1 },
  { dots: [[4, 4]], r: 2 }
]

/** Opacity of the texture over the fill. */
export const PATTERN_OPACITY = 0.6

export const patternAt = (i: number): PatternTile => PATTERNS[((i % PATTERNS.length) + PATTERNS.length) % PATTERNS.length]
