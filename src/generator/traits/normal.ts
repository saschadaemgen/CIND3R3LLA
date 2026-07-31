/**
 * Standard normal draws from a deterministic uniform stream.
 *
 * Box-Muller, chosen over the Marsaglia polar method because it consumes a fixed
 * two uniforms per pair. Rejection sampling would also be deterministic (the same
 * seed rejects the same draws), but a variable consumption rate means a later
 * change to the rejection condition silently shifts every subsequent value in the
 * stream, and briefing §2 makes a seed the thing that reconstructs a profile.
 */

import type { Rng } from '../rng.js';

/**
 * `n` independent standard normal values.
 *
 * TAIL RESOLUTION. The uniforms come from a 32-bit generator, so the smallest
 * non-zero `u1` is about 2.3e-10 and the largest magnitude this can produce is
 * around 6.6 standard deviations. For a personality vector that is far past the
 * range any archetype occupies, and it is noted rather than fixed because the
 * alternative buys nothing here and the limit should not be discovered later as a
 * surprise.
 */
export function standardNormals(rng: Rng, n: number): number[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`standardNormals: n must be a non-negative integer, got ${n}`);
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 2) {
    // ln(0) is -Infinity, and float() can legitimately return exactly 0. Redraw:
    // deterministic, since the same seed reaches the same zero at the same point.
    let u1 = rng.float();
    while (u1 === 0) u1 = rng.float();
    const u2 = rng.float();

    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    out[i] = radius * Math.cos(angle);
    if (i + 1 < n) out[i + 1] = radius * Math.sin(angle);
  }
  return out;
}
