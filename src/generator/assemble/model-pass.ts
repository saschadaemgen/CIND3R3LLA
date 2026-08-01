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
  validateBio,
  writeBioWithModel,
  type BioConditioning,
  type FetchLike,
  type ModelBioConfig,
} from '../bio/model.js';
import { originLanguageFor, structuralSignature } from '../bio/generate.js';
import type { TemplateSet } from '../bio/types.js';
import type { AssembledProfile } from './index.js';

export interface ModelPassReport {
  /**
   * Profiles this pass actually had work for: the deterministic layer gave them a bio AND
   * the model is trusted with their language. Out-of-scope languages are counted
   * separately rather than inflating this, so `generated + fromCache + failed` adds up.
   */
  attempted: number;
  fromCache: number;
  generated: number;
  failed: number;
  /** Failure reason to count. Named, never a bare total. */
  failures: Record<string, number>;
  keptTemplateText: number;
  emptied: number;
  /** Bios that needed more than one attempt. A model always needing two is visible. */
  retried: number;
  /** Cached bios today's validator rejects, so they were regenerated rather than served. */
  cacheRejected: number;
  /** Bios dropped because the model is not trusted to write that language. Counted by tag. */
  outOfScopeLanguage: Record<string, number>;
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

  // Language is decided BEFORE the work list, so a profile the model is not trusted to
  // write is never counted as work it attempted.
  const candidates = profiles
    .filter((p) => p.bio.text !== null && p.bio.theme !== null)
    .map((p) => ({
      profile: p,
      // THE MODEL PATH IS NOT LIMITED TO THE AUTHORED TEMPLATE LANGUAGES. `languageFor`
      // requires a clause pool to exist, which is right for the fallback and wrong here:
      // a model writes Spanish with no Spanish pool authored. On the first real model run
      // `Juan García Hernández` wrote English for no reason except that `es` had no pool
      // the model was never going to use.
      language:
        originLanguageFor(
          { latent: p.latent, style: p.surface.style, identity: p.surface.identity,
            rhythm: p.surface.rhythm, content: p.surface.content },
          templates,
        ) ?? p.bio.language,
    }));

  const work = candidates.filter((c) => config.languages.includes(c.language));
  const report: ModelPassReport = {
    attempted: work.length,
    fromCache: 0,
    generated: 0,
    failed: 0,
    failures: {},
    keptTemplateText: 0,
    emptied: 0,
    retried: 0,
    cacheRejected: 0,
    outOfScopeLanguage: {},
    cache: cache.stats,
  };
  let done = 0;

  // SILENCE BEATS WRONG. The model is competent in some languages and not others, and a
  // bio with a conjugation error is a tell no reader misses while an absent bio is
  // ordinary. Dropped here rather than written badly, and counted PER LANGUAGE so that
  // widening `config.languages` has a number attached to it.
  for (const { profile, language } of candidates) {
    if (config.languages.includes(language)) continue;
    profile.bio.text = null;
    profile.bio.theme = null;
    profile.bio.length = 'empty';
    profile.bio.pattern = 'empty';
    profile.bio.emojiCount = 0;
    profile.bio.language = language;
    report.outOfScopeLanguage[language] = (report.outOfScopeLanguage[language] ?? 0) + 1;
  }

  await pooled(work, config.concurrency, async ({ profile, language }) => {
    const key = BioCache.key(profile.seed, conditioningVersion, identity);
    const conditioning: BioConditioning = {
      seed: profile.seed,
      language,
      theme: profile.bio.theme as BioConditioning['theme'],
      latent: profile.latent,
      style: profile.surface.style,
      ageBand: profile.surface.identity.ageBand,
      activityTier: profile.surface.rhythm.activityTier,
      interests: profile.surface.content.interests,
      targetWords: profile.bio.text!.split(/\s+/u).filter(Boolean).length,
      displayName: profile.name.displayName,
    };

    // CACHED TEXT IS RE-VALIDATED, NOT TRUSTED. The cache key names the seed, the
    // conditioning and the model, and deliberately not the validator, which is code
    // rather than conditioning. Without this the cache would keep serving text that
    // today's rules reject: the recitation gate was tightened after a run had already
    // cached 53 bios written without it, and every one of them would have survived
    // untouched. Re-checking on read costs nothing and makes the gate retroactive.
    const cached = cache.get(key);
    if (cached !== null && validateBio(cached, conditioning) === null) {
      profile.bio.language = language;
      applyText(profile, cached, templates);
      report.fromCache++;
    } else {
      if (cached !== null) report.cacheRejected++;
      try {
        // A rejection is usually a bad sample, not a bad model. Every attempt after the
        // first perturbs the seed so the model does not simply repeat itself.
        let text: string | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < Math.max(1, config.attempts); attempt++) {
          try {
            text = await writeBioWithModel(
              attempt === 0 ? conditioning : { ...conditioning, seed: conditioning.seed + attempt * 1_000_003 },
              config,
              options.fetchImpl,
            );
            if (attempt > 0) report.retried++;
            break;
          } catch (err) {
            lastError = err;
          }
        }
        if (text === null) throw lastError;
        cache.set(key, text, now());
        // The record must say which language it was WRITTEN in, not which one the
        // fallback would have used, or the review views describe the wrong population.
        profile.bio.language = language;
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
