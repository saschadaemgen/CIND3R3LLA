/**
 * Deterministic pseudo-random number generation.
 *
 * Briefing §2: the same seed plus the same configuration must always produce the
 * identical result, including the culture drawn, the pattern chosen and the final
 * string. "This is not a nicety. A seed is the only thing needed to reconstruct a
 * profile later, and a whole later feature depends on it."
 *
 * Consequences, all of them load-bearing:
 *
 *   - `Math.random` is never used. There is no global state to seed or reseed.
 *   - A generator instance carries its own counter, so two instances created from
 *     the same seed produce the same sequence regardless of what else ran between.
 *   - Streams are NAMED. Drawing the culture must not shift the sequence the
 *     casing stage sees, or adding a stage would silently change every previously
 *     generated name for the same seed. Each stage derives its own independent
 *     stream from (seed, streamName), so stages are reorderable and insertable
 *     without breaking reproducibility of the stages before them.
 */

/** 32-bit FNV-1a. Used to fold a stream name into the seed. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // hash *= 16777619, in 32-bit arithmetic without overflowing to double.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * SplitMix32. Chosen over a bare LCG because the low bits of an LCG are famously
 * non-random, and several draws here use small moduli where that would show up as
 * visible structure in the output.
 */
function splitmix32(state: number): { value: number; next: number } {
  const z = (state + 0x9e3779b9) >>> 0;
  let x = z;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return { value: x >>> 0, next: z };
}

/**
 * A named, independent random stream derived from a seed.
 *
 * Never share one across stages: that is exactly the coupling the named-stream
 * design exists to prevent.
 */
export class Rng {
  private state: number;

  constructor(seed: number, stream: string) {
    // Fold the stream name in so each stage walks a different sequence.
    this.state = (Math.imul(seed >>> 0, 0x2545f491) ^ fnv1a(stream)) >>> 0;
    // Discard one value: a freshly mixed state correlates with its inputs.
    this.next();
  }

  /** Raw 32-bit unsigned value. */
  next(): number {
    const { value, next } = splitmix32(this.state);
    this.state = next;
    return value;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.next() / 0x100000000;
  }

  /**
   * Uniform integer in [0, bound). Rejection-sampled rather than `% bound`,
   * because modulo biases the low values whenever bound does not divide 2^32 and
   * the pools here are almost never powers of two.
   */
  int(bound: number): number {
    if (bound <= 0) throw new RangeError(`Rng.int bound must be positive, got ${bound}`);
    if (bound === 1) return 0;
    const limit = Math.floor(0x100000000 / bound) * bound;
    let v = this.next();
    while (v >= limit) v = this.next();
    return v % bound;
  }

  /** True with the given probability. Out-of-range probabilities are clamped. */
  chance(probability: number): boolean {
    if (!(probability > 0)) return false;
    if (probability >= 1) return true;
    return this.float() < probability;
  }

  /** Uniform choice from a non-empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick from an empty list');
    return items[this.int(items.length)]!;
  }

  /**
   * Weighted choice over `{ key: weight }`. Weights need not sum to 1; they are
   * normalised. Non-positive weights are skipped, so a caller can zero out an
   * option without removing it from the configuration.
   */
  pickWeighted<K extends string>(weights: Readonly<Partial<Record<K, number>>>): K {
    const entries = (Object.entries(weights) as [K, number][]).filter(
      ([, w]) => typeof w === 'number' && w > 0,
    );
    if (entries.length === 0) throw new RangeError('Rng.pickWeighted with no positive weights');
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.float() * total;
    for (const [key, weight] of entries) {
      roll -= weight;
      if (roll < 0) return key;
    }
    // Floating-point residue only; the last positive entry is the correct answer.
    return entries[entries.length - 1]![0];
  }
}
