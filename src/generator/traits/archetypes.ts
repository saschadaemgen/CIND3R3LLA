/**
 * Archetype loading and the separation constraint.
 *
 * THE ONLY FILE IN THIS MODULE THAT TOUCHES THE FILESYSTEM. Everything else takes
 * an `ArchetypeSet` as an argument, which is what makes briefing §1's "no corpus,
 * no filesystem, no database" structural rather than a discipline. Call `load`
 * once at startup; never per avatar.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE FILE LIVES (briefing §9, the open question)
 * ---------------------------------------------------------------------------
 *
 * Beside the sampler, at `data/archetypes.json`, matching what the name generator
 * did with its grammar metadata.
 *
 * §9 leaves this open because it depends on whether archetypes are later edited
 * through an interface, which is not yet decided. So the choice was made on the
 * cost of being wrong rather than on a guess about that decision. Local is the
 * reversible option: the injection seam means the only thing that knows where the
 * file is, is `load`, and `LoadArchetypesOptions.path` already lets a caller point
 * it anywhere. If archetypes do become interface-edited and need to sit in a shared
 * configuration location beside whatever else that interface owns, moving them is
 * a path change in one function and a `git mv`. Starting shared, and being wrong,
 * would mean a shared configuration surface with exactly one tenant.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MEANS ARE NAMED RATHER THAN POSITIONAL
 * ---------------------------------------------------------------------------
 *
 * The file authors each mean as `{ "openness": 0.1, ... }`, not `[0.1, ...]`.
 * Briefing §5 wants this file editable without a rebuild, which means it is edited
 * by hand, and a hand-edited array of six bare decimals is the single most likely
 * place for a silent index-order mistake to enter. `resolveMean` converts names to
 * `TRAIT_ORDER` positions in one place and rejects a vector with a missing or
 * unknown key.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_ARCHETYPE_SEPARATION,
  TRAIT_COUNT,
  TRAIT_ORDER,
  type Archetype,
  type ArchetypeSet,
  type TraitKey,
} from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = './data/archetypes.json';

/** The raw shape of the authored file. */
interface RawArchetypeFile {
  _README?: unknown;
  version?: unknown;
  archetypes?: unknown;
}

interface RawArchetype {
  key?: unknown;
  label?: unknown;
  sketch?: unknown;
  mean?: unknown;
  defining?: unknown;
  note?: unknown;
  provenance?: unknown;
  provenanceWhy?: unknown;
}

const TRAIT_KEYS = new Set<string>(TRAIT_ORDER);

function fail(source: string, message: string): never {
  throw new Error(`Trait sampler: archetype file ${source} - ${message}`);
}

/** Convert one named mean object into `TRAIT_ORDER` index order. */
function resolveMean(raw: unknown, source: string, where: string): number[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(
      source,
      `${where} has no mean object. Means are authored as named traits ` +
        `({ "openness": 0.1, ... }), never as a bare array, so an index-order ` +
        `mistake cannot be made by hand.`,
    );
  }
  const named = raw as Record<string, unknown>;
  for (const key of Object.keys(named)) {
    if (!TRAIT_KEYS.has(key)) {
      fail(source, `${where} mean has unknown trait "${key}". Expected: ${TRAIT_ORDER.join(', ')}.`);
    }
  }
  const mean = new Array<number>(TRAIT_COUNT);
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const key = TRAIT_ORDER[i]!;
    const v = named[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      fail(source, `${where} mean is missing a finite value for "${key}", got ${String(v)}.`);
    }
    mean[i] = v;
  }
  return mean;
}

function resolveDefining(raw: unknown, source: string, where: string): TraitKey[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(
      source,
      `${where} must list at least one defining trait. The separation check in ` +
        `briefing §4.3 compares archetypes on the traits their sketch pins, so an ` +
        `archetype with none cannot be checked against anything.`,
    );
  }
  const out: TraitKey[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !TRAIT_KEYS.has(entry)) {
      fail(source, `${where} lists unknown defining trait ${JSON.stringify(entry)}.`);
    }
    if (out.includes(entry as TraitKey)) {
      fail(source, `${where} lists defining trait "${entry}" twice.`);
    }
    out.push(entry as TraitKey);
  }
  return out;
}

/**
 * Validate and index a parsed archetype file. Pure: no filesystem, so a test can
 * drive it with a hand-built object.
 */
export function parseArchetypes(raw: unknown, source: string): ArchetypeSet {
  if (typeof raw !== 'object' || raw === null) {
    fail(source, `is not a JSON object.`);
  }
  const file = raw as RawArchetypeFile;
  if (!Array.isArray(file.archetypes) || file.archetypes.length === 0) {
    fail(source, `has no non-empty "archetypes" array.`);
  }

  const list: Archetype[] = [];
  const byKey = new Map<string, Archetype>();

  for (let i = 0; i < file.archetypes.length; i++) {
    const entry = file.archetypes[i] as RawArchetype;
    const where = `entry ${i}`;
    if (typeof entry !== 'object' || entry === null) fail(source, `${where} is not an object.`);
    if (typeof entry.key !== 'string' || entry.key.length === 0) {
      fail(source, `${where} has no "key".`);
    }
    const named = `archetype "${entry.key}"`;
    if (byKey.has(entry.key)) fail(source, `${named} appears twice.`);
    if (typeof entry.label !== 'string' || entry.label.length === 0) {
      fail(source, `${named} has no "label".`);
    }
    if (typeof entry.sketch !== 'string' || entry.sketch.length === 0) {
      fail(source, `${named} has no "sketch". Keep the briefing §5 sketch beside the vector: it is what the numbers were authored against.`);
    }
    if (entry.note !== undefined && typeof entry.note !== 'string') {
      fail(source, `${named} has a non-string "note".`);
    }

    if (entry.provenance !== 'product-role' && entry.provenance !== 'empirical-candidate') {
      fail(
        source,
        `${named} has no valid "provenance" (product-role or empirical-candidate). ` +
          `It must be declared BEFORE any reference comparison runs: deciding afterwards ` +
          `lets a real finding be argued away and a product decision be defended as empirical.`,
      );
    }
    if (typeof entry.provenanceWhy !== 'string' || entry.provenanceWhy.length === 0) {
      fail(source, `${named} declares a provenance with no reason.`);
    }

    const archetype: Archetype = {
      key: entry.key,
      provenance: entry.provenance,
      provenanceWhy: entry.provenanceWhy,
      label: entry.label,
      sketch: entry.sketch,
      mean: resolveMean(entry.mean, source, named),
      defining: resolveDefining(entry.defining, source, named),
      ...(typeof entry.note === 'string' ? { note: entry.note } : {}),
    };
    list.push(archetype);
    byKey.set(archetype.key, archetype);
  }

  if (typeof file.version !== 'string' || file.version.length === 0) {
    fail(
      source,
      `has no "version". Quality measures are properties of a specific archetype set, ` +
        `so a set that cannot be named cannot have a bound written against it.`,
    );
  }
  return { list, byKey, source, version: file.version };
}

export interface LoadArchetypesOptions {
  /** Override the archetype source. See the note on §9 at the top of this file. */
  path?: string;
  /**
   * Separation to enforce on load. Defaults to `DEFAULT_ARCHETYPE_SEPARATION`;
   * pass `null` to skip the check, which is only ever right for a test that is
   * deliberately loading a collapsed set.
   *
   * Checked on load rather than left for the caller to remember, because an
   * archetype set that violates §4.3 is broken data and the only thing standing
   * between it and a population nobody can tell apart is this call.
   */
  separation?: number | null;
}

/**
 * Read and validate the archetype set. Once, at startup.
 *
 * A missing or malformed file raises rather than yielding an empty set. An empty
 * set would sample every avatar out of the unclassified background and produce a
 * population that looks superficially fine and has no archetypes in it at all.
 */
export function loadArchetypes(options: LoadArchetypesOptions = {}): ArchetypeSet {
  const relative = options.path ?? DEFAULT_PATH;
  const path = resolve(HERE, relative);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Trait sampler: could not read the archetype file at ${path} - ` +
        `${err instanceof Error ? err.message : String(err)}. It is expected beside ` +
        `this module; the build does not copy data files into dist, so run the ` +
        `generator from source or pass an explicit path.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Trait sampler: the archetype file at ${path} is not valid JSON - ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const set = parseArchetypes(parsed, path);
  const separation = options.separation === undefined ? DEFAULT_ARCHETYPE_SEPARATION : options.separation;
  if (separation !== null) assertSeparation(set, separation);
  return set;
}

/* ------------------------------------------------------- the §4.3 constraint */

export interface SeparationPair {
  a: string;
  b: string;
  /** Union of the two archetypes' defining traits: the axes compared. */
  traits: TraitKey[];
  /** Euclidean distance between the two means, restricted to `traits`. */
  distance: number;
}

/**
 * Pairwise separations, closest first.
 *
 * WHAT "SEPARATED ON THEIR DEFINING TRAITS" IS TAKEN TO MEAN. For each pair, the
 * Euclidean distance between the two mean vectors restricted to the UNION of the
 * two archetypes' defining traits.
 *
 * The union, not the intersection: `reserved` and `quietLurker` are both low on
 * extraversion, so their intersection contributes nothing and an intersection rule
 * would call every pair sharing a defining trait a collision. The union asks the
 * right question, which is whether two archetypes differ anywhere that either of
 * them is actually defined by.
 *
 * Restricted, not all six: the free components of a sketch are authored, not
 * specified, and letting them contribute would mean an archetype pair could pass
 * on the strength of numbers nobody chose deliberately. Restricting is the
 * conservative reading, and it is the one that makes briefing §4.3's stated
 * purpose true: "if someone authors two archetypes that sit on top of each other,
 * the test should say so".
 */
export function separations(set: ArchetypeSet): SeparationPair[] {
  const out: SeparationPair[] = [];
  for (let i = 0; i < set.list.length; i++) {
    for (let j = i + 1; j < set.list.length; j++) {
      const a = set.list[i]!;
      const b = set.list[j]!;
      const traits = [...new Set([...a.defining, ...b.defining])];
      let sum = 0;
      for (const t of traits) {
        const k = TRAIT_ORDER.indexOf(t);
        const d = a.mean[k]! - b.mean[k]!;
        sum += d * d;
      }
      out.push({ a: a.key, b: b.key, traits, distance: Math.sqrt(sum) });
    }
  }
  return out.sort((x, y) => x.distance - y.distance);
}

/**
 * Assert briefing §4.3. `archetypeSeparation` is NOT a sampling input: it is a
 * property of the archetype definitions, so it is validated here and applied
 * nowhere.
 */
export function assertSeparation(set: ArchetypeSet, separation: number): void {
  if (!Number.isFinite(separation) || separation <= 0) {
    throw new Error(`Trait sampler: archetypeSeparation must be positive, got ${separation}.`);
  }
  const violations = separations(set).filter((p) => p.distance < separation);
  if (violations.length === 0) return;
  const detail = violations
    .map(
      (p) =>
        `${p.a} / ${p.b} are ${p.distance.toFixed(3)} apart on ` +
        `[${p.traits.join(', ')}]`,
    )
    .join('; ');
  throw new Error(
    `Trait sampler: ${violations.length} archetype pair(s) sit closer together than ` +
      `the required separation of ${separation} in ${set.source}: ${detail}. Two ` +
      `archetypes this close are one archetype with two names, and nothing downstream ` +
      `will be able to tell them apart.`,
  );
}
