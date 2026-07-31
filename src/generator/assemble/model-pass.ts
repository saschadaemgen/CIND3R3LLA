/**
 * The model pass: the deterministic layer decides the person, the model writes the words.
 *
 * Runs AFTER assembly, over an already-finished population, and changes exactly one field.
 * Whether a profile has a bio at all, how long it is, what it is about, which language it
 * is in: all decided before this runs, by the trait sampler and the surface derivation.
 * That separation is the point. A model handed nothing writes a generic bio; a model
 * handed a finished person writes that person's bio.
 *
 * The target word count is not plumbed through from the length draw, because it is
 * already realised in the template text this pass replaces. Reading it back off that text
 * is the same number by construction and needs no new parameter.
 */

import { BioCache } from '../bio/cache.js';
import {
  modelIdentity,
  writeBioWithModel,
  type BioConditioning,
  type FetchLike,
  type ModelBioConfig,
} from '../bio/model.js';
import { structuralSignature } from '../bio/generate.js';
import type { TemplateSet } from '../bio/types.js';
import type { AssembledProfile } from './index.js';

export interface ModelPassReport {
  /** Profiles the deterministic layer gave a bio, so the ones this pass had work for. */
  attempted: number;
  fromCache: number;
  generated: number;
  failed: number;
  /** Failure reason to count. Named, never a bare total. */
  failures: Record<string, number>;
  keptTemplateText: number;
  emptied: number;
  cache: BioCache['stats'];
}

export interface ModelPassOptions {
  config: ModelBioConfig;
  templates: TemplateSet;
  /**
   * Names the conditioning exactly: the four component data set versions plus the
   * assemble configuration. Part of the cache key, so editing an archetype set
   * regenerates rather than silently serving text written for a different person.
   */
  conditioningVersion: string;
  cachePath: string | null;
  fetchImpl?: FetchLike;
  onProgress?: (done: number, total: number) => void;
  /** Injectable so the harness can prove the pass without a model running. */
  now?: () => string;
}

/** Run `limit` promises at a time. Local inference, so the pool stays small. */
async function pooled<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await run(items[i]!);
    }
  });
  await Promise.all(workers);
}

export async function runModelPass(
  profiles: AssembledProfile[],
  options: ModelPassOptions,
): Promise<ModelPassReport> {
  const { config, templates, conditioningVersion, cachePath } = options;
  const now = options.now ?? ((): string => new Date().toISOString());
  const cache = BioCache.load(cachePath);
  const identity = modelIdentity(config);

  const work = profiles.filter((p) => p.bio.text !== null && p.bio.theme !== null);
  const report: ModelPassReport = {
    attempted: work.length,
    fromCache: 0,
    generated: 0,
    failed: 0,
    failures: {},
    keptTemplateText: 0,
    emptied: 0,
    cache: cache.stats,
  };
  let done = 0;

  await pooled(work, config.concurrency, async (profile) => {
    const key = BioCache.key(profile.seed, conditioningVersion, identity);
    const conditioning: BioConditioning = {
      seed: profile.seed,
      language: profile.bio.language,
      theme: profile.bio.theme as BioConditioning['theme'],
      latent: profile.latent,
      style: profile.surface.style,
      ageBand: profile.surface.identity.ageBand,
      activityTier: profile.surface.rhythm.activityTier,
      interests: profile.surface.content.interests,
      targetWords: profile.bio.text!.split(/\s+/u).filter(Boolean).length,
      displayName: profile.name.displayName,
    };

    const cached = cache.get(key);
    if (cached !== null) {
      applyText(profile, cached, templates);
      report.fromCache++;
    } else {
      try {
        const text = await writeBioWithModel(conditioning, config, options.fetchImpl);
        cache.set(key, text, now());
        applyText(profile, text, templates);
        report.generated++;
      } catch (error) {
        // SURFACED AND COUNTED BY REASON, never absorbed. A population half written by a
        // model and half by the template pool, with no way to tell which, is exactly the
        // masking the standing rule forbids.
        report.failed++;
        const reason = (error as Error).message.replace(/\d+/g, 'N').slice(0, 80);
        report.failures[reason] = (report.failures[reason] ?? 0) + 1;
        if (config.onFailure === 'empty') {
          profile.bio.text = null;
          profile.bio.theme = null;
          profile.bio.length = 'empty';
          profile.bio.pattern = 'empty';
          profile.bio.emojiCount = 0;
          report.emptied++;
        } else {
          report.keptTemplateText++;
        }
      }
    }
    options.onProgress?.(++done, work.length);
  });

  cache.save();
  return report;
}

/**
 * Replace the wording and RE-DERIVE what was derived from it.
 *
 * The structural signature and the length bucket describe the text, so leaving the
 * template's behind would make the distribution view describe a population that no longer
 * exists. It would still have looked green, which is the failure mode that view carries a
 * caveat about.
 */
function applyText(profile: AssembledProfile, text: string, templates: TemplateSet): void {
  const emojiCount = [...text].filter((ch) => templates.emoji.includes(ch)).length;
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  profile.bio.text = text;
  profile.bio.emojiCount = emojiCount;
  profile.bio.length = words <= 5 ? 'short' : words <= 12 ? 'medium' : 'long';
  profile.bio.pattern = structuralSignature(
    text,
    emojiCount,
    templates.languages[profile.bio.language]?.separators,
  );
}
