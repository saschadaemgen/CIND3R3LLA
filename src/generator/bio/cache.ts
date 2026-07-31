/**
 * Seed-keyed bio cache.
 *
 * A seed must reproduce a profile exactly. That property is what makes a defect in a
 * member list a bug report rather than "something was off in that run", and it is what
 * lets an avatar live for months without rewriting its own biography. A model does not
 * guarantee it, so the cache does: GENERATE ONCE, KEY ON THE SEED.
 *
 * THE KEY IS THREE THINGS, NOT ONE. Seed, conditioning version, and model identity.
 * Keying on the seed alone would be worse than not caching: swapping the model or editing
 * the archetype set would silently keep serving text written for a different person, and
 * the failure would be invisible precisely because the seed still "reproduced". With all
 * three in the key, a change in any of them shows up as text regenerating, which is a
 * visible event rather than a silent one.
 *
 * This is offline tooling, so the store is a JSON file rather than a table. Nothing at
 * runtime reads it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CacheEntry {
  text: string;
  /** ISO timestamp of the generation, for reading the file by hand. */
  at: string;
}

interface CacheFile {
  /** Format version of this file, not of the content. */
  format: 1;
  entries: Record<string, CacheEntry>;
}

export interface BioCacheStats {
  hits: number;
  misses: number;
  writes: number;
  /** Entries present on load that no key in this run asked for. */
  stale: number;
}

export class BioCache {
  private readonly entries: Map<string, CacheEntry>;
  private readonly touched = new Set<string>();
  readonly stats: BioCacheStats = { hits: 0, misses: 0, writes: 0, stale: 0 };
  private dirty = false;

  private constructor(
    private readonly path: string | null,
    entries: Map<string, CacheEntry>,
  ) {
    this.entries = entries;
  }

  /**
   * Load from disk, or start empty.
   *
   * A CORRUPT OR UNREADABLE CACHE IS NOT SILENTLY TREATED AS AN EMPTY ONE. Doing that
   * would turn "your cache file is broken" into "the run is oddly slow and the text all
   * changed", which is the masking the standing rule forbids. A missing file is a normal
   * first run; a malformed one is a fault and says so.
   */
  static load(path: string | null): BioCache {
    if (path === null) return new BioCache(null, new Map());
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new BioCache(path, new Map());
      throw new Error(`bio cache at ${path} could not be read: ${(error as Error).message}`);
    }
    let parsed: CacheFile;
    try {
      parsed = JSON.parse(raw) as CacheFile;
    } catch (error) {
      throw new Error(
        `bio cache at ${path} is not valid JSON (${(error as Error).message}). ` +
          `Delete it to regenerate, which will rewrite every cached bio.`,
      );
    }
    if (parsed.format !== 1 || typeof parsed.entries !== 'object' || parsed.entries === null) {
      throw new Error(`bio cache at ${path} is not a format 1 cache file.`);
    }
    return new BioCache(path, new Map(Object.entries(parsed.entries)));
  }

  /** Seed, conditioning version and model identity. All three, always. */
  static key(seed: number, conditioningVersion: string, modelIdentity: string): string {
    return `${seed}|${conditioningVersion}|${modelIdentity}`;
  }

  get(key: string): string | null {
    this.touched.add(key);
    const hit = this.entries.get(key);
    if (hit === undefined) {
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return hit.text;
  }

  set(key: string, text: string, at: string): void {
    this.entries.set(key, { text, at });
    this.touched.add(key);
    this.stats.writes++;
    this.dirty = true;
  }

  /**
   * Write back if anything changed.
   *
   * Entries nothing asked for are KEPT, not pruned. A run over seeds 0..199 must not
   * throw away the bios for 200..999 that a wider run generated, and the count of them is
   * reported so a file that has quietly become mostly dead is visible.
   */
  save(): void {
    for (const key of this.entries.keys()) if (!this.touched.has(key)) this.stats.stale++;
    if (this.path === null || !this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const file: CacheFile = { format: 1, entries: Object.fromEntries(this.entries) };
    writeFileSync(this.path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}
