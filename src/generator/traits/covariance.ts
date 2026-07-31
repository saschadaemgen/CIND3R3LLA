/**
 * The correlation matrix, its validation, and the Cholesky factor.
 *
 * Briefing §4.1 gives raw correlations for eight trait pairs; unlisted pairs are 0
 * and the diagonal is 1. Sampling needs `L` with `L @ Lt = Sigma`, which is a
 * Cholesky decomposition, which requires `Sigma` to be positive-definite. A
 * hand-authored correlation matrix is not guaranteed to be.
 *
 * WHAT HAPPENS WHEN IT IS NOT: an error, naming the matrix as non-positive-definite
 * and naming the trait whose pivot went non-positive. No silent repair, no fallback
 * to independent sampling. Briefing §4.2 is blunt about why, and it is the same
 * reasoning as the repository's standing rule against swallowing failures
 * (CCB-S3-023): a silent fallback here "would reintroduce exactly the failure this
 * component exists to prevent, and nothing downstream would show it". Independently
 * drawn vectors are the mush. A sampler that quietly produced them on a bad matrix
 * would look like it was working.
 *
 * `ridgeRepair` exists as the explicit, opt-in option §4.2 permits. It is a TUNING
 * AID for whoever is retuning the matrix by hand. Nothing on the sampling path
 * imports it, and `verify:traits` asserts that.
 */

import { TRAIT_COUNT, TRAIT_INDEX, TRAIT_ORDER, type TraitKey } from './types.js';

/**
 * Briefing §4.1, verbatim. Raw correlations, tunable.
 *
 *     E-A  = +0.29     N-C  = -0.22     E-O  = +0.20
 *     A-O  = +0.19     C-A  = +0.15     N-A  = -0.12
 *     N-E  = -0.11     C-O  =  0.00
 *
 * Written as named pairs rather than as a literal 6x6 grid, because a grid is the
 * artefact this module is most afraid of: a transposed or reordered one decomposes
 * and samples happily while putting the correlations on the wrong traits. Named
 * pairs cannot be reordered, and `buildCorrelationMatrix` places each one into both
 * cells so the result is symmetric by construction.
 *
 * `C-O = 0.00` is listed although zero is the default. It is in the briefing as an
 * explicit statement that the pair was considered and found uncorrelated, not
 * overlooked, so it is kept.
 *
 * Honesty-Humility appears in no pair. That is the HEXACO position: the sixth
 * dimension is close to orthogonal to the Big Five by construction, which is what
 * makes it able to separate good-faith from manipulative disposition independently
 * of the other five.
 */
export const DEFAULT_CORRELATIONS: readonly (readonly [TraitKey, TraitKey, number])[] =
  Object.freeze([
    ['extraversion', 'agreeableness', 0.29],
    ['neuroticism', 'conscientiousness', -0.22],
    ['extraversion', 'openness', 0.2],
    ['agreeableness', 'openness', 0.19],
    ['conscientiousness', 'agreeableness', 0.15],
    ['neuroticism', 'agreeableness', -0.12],
    ['neuroticism', 'extraversion', -0.11],
    ['conscientiousness', 'openness', 0.0],
  ] as const);

/**
 * The higher-order structure the §4.1 values produce, which "should survive any
 * retuning": C, A and low N form one factor; O and E form another. Asserted in
 * `verify:traits` against the matrix rather than left as a comment, so a retune that
 * destroys it fails a check.
 */
export const FACTOR_STRUCTURE: Readonly<Record<string, readonly TraitKey[]>> = Object.freeze({
  /** Stability. Neuroticism enters this factor negatively. */
  stability: Object.freeze(['conscientiousness', 'agreeableness', 'neuroticism'] as const),
  /** Engagement. */
  engagement: Object.freeze(['openness', 'extraversion'] as const),
});

/** Build a symmetric 6x6 correlation matrix from named pairs. */
export function buildCorrelationMatrix(
  pairs: readonly (readonly [TraitKey, TraitKey, number])[] = DEFAULT_CORRELATIONS,
): number[][] {
  const m: number[][] = Array.from({ length: TRAIT_COUNT }, (_, i) =>
    Array.from({ length: TRAIT_COUNT }, (_, j) => (i === j ? 1 : 0)),
  );
  for (const [a, b, r] of pairs) {
    const i = TRAIT_INDEX[a];
    const j = TRAIT_INDEX[b];
    if (i === j) {
      throw new Error(`Trait sampler: correlation pair names the same trait twice (${a}).`);
    }
    // Both cells from one source value: symmetry is structural, not asserted later.
    m[i]![j] = r;
    m[j]![i] = r;
  }
  return m;
}

/** The shipped matrix. Frozen, because a caller mutating it would be invisible. */
export const DEFAULT_COVARIANCE: readonly (readonly number[])[] = Object.freeze(
  buildCorrelationMatrix().map((row) => Object.freeze(row)),
);

/** A fresh, mutable copy of the shipped matrix, for callers that want to tune it. */
export function defaultCovariance(): number[][] {
  return buildCorrelationMatrix();
}

/**
 * Tolerance on the authored diagonal and on symmetry. These are hand-written
 * decimals, so anything past rounding noise is a mistake rather than float drift.
 */
const AUTHORING_EPSILON = 1e-9;

/**
 * Smallest pivot accepted as positive-definite.
 *
 * `> 0` alone is not the right test: a singular matrix (one trait an exact linear
 * combination of others) yields a pivot of about 1e-17 rather than exactly 0, and
 * dividing by its square root produces a factor full of enormous values instead of
 * an error. Positive-SEMI-definite is not positive-definite, and only the latter
 * gives a usable factor.
 */
const MIN_PIVOT = 1e-10;

/**
 * `Array.isArray` widens a typed array to `any[]`, which loses every guarantee the
 * checks below are trying to establish. This narrows to `unknown[]` instead, so the
 * cells stay unknown until they have actually been proven to be finite numbers.
 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Reject anything that is not a well-formed correlation matrix, before Cholesky
 * gets a chance to fail in a less legible way.
 *
 * The diagonal must be 1. This module takes a CORRELATION matrix, and per-trait
 * scale is expressed through `sigma`, never through the diagonal. Accepting a
 * non-unit diagonal would silently compound the two, so a diagonal of 1 is required
 * rather than normalised away: normalising would quietly accept a matrix its author
 * did not mean to write.
 */
export function assertCorrelationMatrix(matrix: readonly (readonly number[])[]): void {
  // Shape first, in one pass, so the second pass can compare any two cells without
  // re-checking whether they exist. The parameter is typed, but the checks are
  // runtime ones: this matrix reaches here from configuration and from callers with
  // no type checking at all, which is exactly where a malformed one comes from.
  const rows: unknown[] = isUnknownArray(matrix) ? matrix : [];
  if (rows.length !== TRAIT_COUNT) {
    throw new Error(
      `Trait sampler: the covariance matrix must be ${TRAIT_COUNT}x${TRAIT_COUNT}, ` +
        `got ${isUnknownArray(matrix) ? `${rows.length} rows` : typeof matrix}.`,
    );
  }
  const grid: number[][] = [];
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const row: unknown = rows[i];
    if (!isUnknownArray(row) || row.length !== TRAIT_COUNT) {
      throw new Error(
        `Trait sampler: covariance row ${i} (${TRAIT_ORDER[i]}) must have ${TRAIT_COUNT} ` +
          `entries, got ${isUnknownArray(row) ? row.length : typeof row}.`,
      );
    }
    const cells: number[] = [];
    for (let j = 0; j < TRAIT_COUNT; j++) {
      const v: unknown = row[j];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(
          `Trait sampler: covariance[${i}][${j}] ` +
            `(${TRAIT_ORDER[i]} x ${TRAIT_ORDER[j]}) is not a finite number, got ${String(v)}.`,
        );
      }
      cells.push(v);
    }
    grid.push(cells);
  }

  for (let i = 0; i < TRAIT_COUNT; i++) {
    for (let j = 0; j < TRAIT_COUNT; j++) {
      const v = grid[i]![j]!;
      if (i === j) {
        if (Math.abs(v - 1) > AUTHORING_EPSILON) {
          throw new Error(
            `Trait sampler: covariance diagonal must be 1, but [${i}][${i}] ` +
              `(${TRAIT_ORDER[i]}) is ${v}. This is a correlation matrix; express ` +
              `per-trait scale through sigma, not through the diagonal.`,
          );
        }
        continue;
      }
      if (Math.abs(v) > 1 + AUTHORING_EPSILON) {
        throw new Error(
          `Trait sampler: covariance[${i}][${j}] ` +
            `(${TRAIT_ORDER[i]} x ${TRAIT_ORDER[j]}) is ${v}, outside the -1..1 a ` +
            `correlation can take.`,
        );
      }
      const mirrored = grid[j]![i]!;
      if (Math.abs(v - mirrored) > AUTHORING_EPSILON) {
        // The transposition typo. Cholesky reads the lower triangle only, so an
        // asymmetric matrix would sample from HALF of what its author wrote, with
        // no complaint at all.
        throw new Error(
          `Trait sampler: covariance is not symmetric. [${i}][${j}] ` +
            `(${TRAIT_ORDER[i]} x ${TRAIT_ORDER[j]}) is ${v} but [${j}][${i}] is ` +
            `${mirrored}. Both cells of a pair must carry the same correlation.`,
        );
      }
    }
  }
}

/**
 * Lower-triangular `L` with `L @ Lt = matrix`.
 *
 * Throws, loudly and by name, if the matrix is not positive-definite. That is the
 * whole contract of briefing §4.2. There is no repair here and no fallback: this
 * function either returns a factor that reproduces the requested correlations, or
 * it raises.
 */
export function cholesky(matrix: readonly (readonly number[])[]): number[][] {
  assertCorrelationMatrix(matrix);

  const n = TRAIT_COUNT;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i]![j]!;
      for (let k = 0; k < j; k++) sum -= L[i]![k]! * L[j]![k]!;

      if (i === j) {
        if (!(sum > MIN_PIVOT)) {
          throw new Error(
            `Trait sampler: the covariance matrix is NOT POSITIVE-DEFINITE and cannot ` +
              `be decomposed. The pivot at index ${i} (${TRAIT_ORDER[i]}) is ${sum.toExponential(3)}, ` +
              `which is not positive, so ${TRAIT_ORDER[i]} carries no variance independent ` +
              `of the traits before it. Retune the correlations involving ${TRAIT_ORDER[i]}; ` +
              `they claim more shared structure than six dimensions can hold. ` +
              `Nothing here repairs the matrix or falls back to independent sampling: ` +
              `that would silently reintroduce the very failure this sampler exists to prevent.`,
          );
        }
        L[i]![j] = Math.sqrt(sum);
      } else {
        L[i]![j] = sum / L[j]![j]!;
      }
    }
  }
  return L;
}

/** True if the matrix decomposes. For diagnostics; the sampler uses `cholesky`. */
export function isPositiveDefinite(matrix: readonly (readonly number[])[]): boolean {
  try {
    cholesky(matrix);
    return true;
  } catch {
    return false;
  }
}

/** `L @ Lt`, for proving a factor actually reproduces its matrix. */
export function productWithTranspose(factor: readonly (readonly number[])[]): number[][] {
  const n = factor.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += factor[i]![k]! * factor[j]![k]!;
      out[i]![j] = sum;
    }
  }
  return out;
}

export interface RidgeRepairResult {
  /** The repaired matrix: `(1 - blend) * matrix + blend * I`. */
  matrix: number[][];
  /** How much identity had to be mixed in. Report it; do not hide it. */
  blend: number;
}

/**
 * The explicit, opt-in repair briefing §4.2 permits. NEVER A DEFAULT, and never
 * reached from the sampling path: this is a tool for a human retuning the matrix,
 * called from a script, whose output they then paste back into their pair list.
 *
 * It pulls the matrix toward the identity until it decomposes. That direction is
 * exactly the direction of independent sampling, which is why `maxBlend` is capped
 * well below 1 and why the amount used is returned rather than swallowed: a matrix
 * needing a large blend is not slightly off, it is wrong, and quietly shipping it
 * would be the silent fallback §4.2 forbids. Past the cap this throws like
 * `cholesky` does.
 */
export function ridgeRepair(
  matrix: readonly (readonly number[])[],
  options: { maxBlend?: number; steps?: number } = {},
): RidgeRepairResult {
  const maxBlend = options.maxBlend ?? 0.5;
  const steps = options.steps ?? 200;
  assertCorrelationMatrix(matrix);

  for (let step = 0; step <= steps; step++) {
    const blend = (maxBlend * step) / steps;
    const candidate = matrix.map((row, i) =>
      row.map((v, j) => (i === j ? 1 : v * (1 - blend))),
    );
    if (isPositiveDefinite(candidate)) return { matrix: candidate, blend };
  }
  throw new Error(
    `Trait sampler: the covariance matrix is not positive-definite and could not be ` +
      `repaired by blending up to ${maxBlend} of the identity into it. A matrix needing ` +
      `more than that is not slightly off, it is wrong: retune the correlations by hand.`,
  );
}
