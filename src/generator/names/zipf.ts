/**
 * Zipfian sampling over a pool (briefing §7).
 *
 * "Name popularity must be Zipfian. A few very common given names, a long tail of
 * rare ones. Drawing uniformly from 36,162 names produces a flat distribution no
 * real population has."
 *
 * A LIMITATION WORTH STATING PLAINLY, because it is easy to mistake this for more
 * than it is. The shipped corpus carries NO frequency data: it is an alphabetically
 * sorted, deduplicated list. So the rank a name receives here is IMPOSED, derived
 * deterministically from the pool, not measured from any real population. The
 * resulting distribution is genuinely Zipf-SHAPED and satisfies the statistical
 * property the briefing asks for, but the names that come out "common" are
 * arbitrary rather than actually common.
 *
 * The fix is not in this file. It is a corpus that carries frequencies; this module
 * would then rank by the real figure and change nothing else.
 */

import { Rng } from './rng.js';

/**
 * Precomputed cumulative weights for one pool size, so a draw is a binary search
 * rather than a fresh harmonic sum every call.
 *
 * Keyed by size, and shared across pools of equal length: the weight curve depends
 * only on rank, never on the pool's contents.
 */
const cumulativeCache = new Map<string, Float64Array>();

/**
 * Zipf-Mandelbrot weight for rank r (1-based): 1 / (r + q)^s.
 *
 * `s` near 1 is the classic Zipf slope observed in name and word frequency.
 * `q` flattens the very top so the single most common name does not swamp the
 * others, which is what real given-name distributions look like.
 */
function buildCumulative(size: number, s: number, q: number): Float64Array {
  const cumulative = new Float64Array(size);
  let total = 0;
  for (let i = 0; i < size; i++) {
    total += 1 / Math.pow(i + 1 + q, s);
    cumulative[i] = total;
  }
  // Normalise in place so a draw compares against [0, 1).
  for (let i = 0; i < size; i++) cumulative[i] = cumulative[i]! / total;
  return cumulative;
}

function cumulativeFor(size: number, s: number, q: number): Float64Array {
  const key = `${size}:${s}:${q}`;
  let cached = cumulativeCache.get(key);
  if (!cached) {
    cached = buildCumulative(size, s, q);
    cumulativeCache.set(key, cached);
  }
  return cached;
}

export interface ZipfOptions {
  /** Slope. Higher concentrates more mass at the top. Default 1.07. */
  s?: number;
  /** Mandelbrot offset. Higher flattens the head. Default 2.7. */
  q?: number;
}

/**
 * Draw one item, Zipf-distributed over the pool's existing order.
 *
 * The pool's order IS the rank. For the unlabelled corpus that order is
 * alphabetical, which would make every "common" name start with A. So the caller
 * must pass a pool that has already been rank-shuffled (see `rankShuffled`),
 * deterministically, from the seed.
 */
export function zipfPick<T>(rng: Rng, pool: readonly T[], options: ZipfOptions = {}): T {
  if (pool.length === 0) throw new RangeError('zipfPick from an empty pool');
  if (pool.length === 1) return pool[0]!;
  const cumulative = cumulativeFor(pool.length, options.s ?? 1.07, options.q ?? 2.7);
  const roll = rng.float();
  // Binary search for the first cumulative weight strictly greater than the roll.
  let lo = 0;
  let hi = pool.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumulative[mid]! > roll) hi = mid;
    else lo = mid + 1;
  }
  return pool[lo]!;
}

/**
 * A deterministic rank permutation of a pool.
 *
 * Without this, Zipf over an alphabetically sorted corpus would make popularity a
 * function of spelling. The permutation is derived from the pool identity and a
 * fixed salt, NOT from the per-name seed: popularity must be a stable property of
 * the population, identical for every name drawn, or two profiles generated from
 * different seeds would disagree about which names are common.
 *
 * Results are cached per pool identity, since the shuffle is pure and the corpus
 * pools are long-lived.
 */
const shuffleCache = new WeakMap<object, readonly unknown[]>();

/**
 * Fixed salt for the rank permutation. Changing it re-ranks every pool, which
 * changes which names are common and therefore changes the output for every
 * previously issued seed. Treat it as frozen.
 */
const RANK_SALT = 0x5eed_0001;

export function rankShuffled<T>(pool: readonly T[], poolId: string): readonly T[] {
  const cached = shuffleCache.get(pool) as readonly T[] | undefined;
  if (cached) return cached;

  // A dedicated stream, seeded only by the pool's identity, so the ranking is a
  // property of the corpus rather than of any one request.
  const rng = new Rng(RANK_SALT, `rank:${poolId}`);
  const out = pool.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  const frozen = Object.freeze(out);
  shuffleCache.set(pool, frozen);
  return frozen;
}
