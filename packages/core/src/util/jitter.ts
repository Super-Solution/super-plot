// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC

/** The most a point may be nudged, in pixels (`jitter` is at most this). */
export const JITTER_MAX = 20

/**
 * The unit offset `jitter` is built on, so that a port (or a test) can reproduce where a point went: for the row at
 * `index` in the data (0-based, counted before any series is hidden, so hiding a series moves nothing) and an axis
 * (`x` or `y`), a number in [-1, 1). The point is drawn `jitter * jitterUnit(index, axis)` pixels from its true position.
 * No random numbers and no clock: the murmur3 finaliser on 32-bit integers, then division by 2^32 (exact).
 * With `h = index * 0x9E3779B1 + salt` (the product and sum modulo 2^32; salt is 0x243F6A88 for `x`, 0x13198A2E for
 * `y`): `h ^= h >> 16; h = h * 0x85EBCA6B mod 2^32; h ^= h >> 13; h = h * 0xC2B2AE35 mod 2^32; h ^= h >> 16`; the
 * result is `h / 4294967296 * 2 - 1`. Shifts are logical (unsigned).
 */
export function jitterUnit(index: number, axis: 'x' | 'y'): number {
  let h = (Math.imul(index, 0x9e3779b1) + (axis === 'x' ? 0x243f6a88 : 0x13198a2e)) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return (h / 4294967296) * 2 - 1
}
