/**
 * Model-written bio text.
 *
 * ── WHY THIS IS THE PRIMARY PATH ───────────────────────────────────────────
 *
 * A read of two hundred generated profiles produced ten defect classes, and every one of
 * them was a language defect that a model conditioned on the personality does not have:
 * German that is German rather than calqued from English, no `Buchbinden-Verteidiger`,
 * no hobby named in three consecutive clauses, umlauts written as umlauts, nouns
 * capitalised, a bio when a bio was asked for rather than `Zurzeit keine Fragen`, and one
 * register held across a profile. Ten for ten.
 *
 * The line that decides which components are deterministic is not "hard" versus "easy".
 * It is STRUCTURE versus LANGUAGE. Traits and surface derivation are mathematics. Names
 * are corpus statistics, where a model would invent plausible-sounding names with wrong
 * frequencies. Bios are language, and the specification put them on the wrong side.
 *
 * ── WHAT THE DETERMINISTIC LAYER IS FOR, WHICH IS NOT LESS ─────────────────
 *
 * THE MODEL WRITES WORDING. IT DECIDES NOTHING. Who the person is, whether they have a
 * bio at all, how long it is, what it is about, which language it is in, how formal, how
 * playful, how active: all of that is already decided before this module is called, by
 * the trait sampler and the surface derivation. This module is handed a finished person
 * and asked only to phrase them.
 *
 * That conditioning is the whole difference between a text generator and a personality
 * generator. Without it a model writes a generic bio; with it, it writes the bio of
 * someone conscientious, reserved, German, interested in bookbinding, who rarely posts.
 *
 * The boundary is the project's standing one and this does not move it: the model never
 * decides identity, permissions, disclosure or actor type.
 */

import type { AgeBand, ActivityTier, Style } from '../surface/types.js';
import type { Latent } from '../traits/types.js';
import type { BioTheme } from '../surface/types.js';

export interface ModelBioConfig {
  /** Ollama-compatible base URL, e.g. `http://127.0.0.1:11434`. */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  temperature: number;
  /** Concurrent in-flight requests. Local inference, so modest by default. */
  concurrency: number;
  /**
   * What to do when the model is unreachable or returns something unusable.
   *
   * `template` keeps the deterministic fallback text that is already in the profile,
   * which is what the template path exists for. `empty` drops the bio instead, which is
   * the right choice when a population is going to be READ: a wrong bio is a tell and an
   * absent one is ordinary, since most real profiles have none.
   */
  onFailure: 'template' | 'empty';
  /**
   * How many times to ask before the bio is treated as failed.
   *
   * A rejection is usually a bad SAMPLE rather than a bad model: the same conditioning
   * that recited its own adjectives once often does not the second time. Retrying costs
   * one local inference and saves an empty bio, and the retry is counted so a model that
   * needs two attempts every time is visible rather than merely slow.
   */
  attempts: number;
  /**
   * The languages this model may be ASKED for. Anything else gets no bio at all.
   *
   * A MODEL-SPECIFIC LIMITATION, NOT A DESIGN ONE, and recorded that way on purpose so it
   * is re-examined rather than inherited. Measured against `qwen3.5:9b` (Q4_K_M, 9.7B) on
   * 2026-08-01: six of eighteen non-German, non-English bios carried outright grammatical
   * errors a native could not make. `horne` for `horneo`, `je parcoure` for `je parcours`,
   * `cocinador`, which is not a Spanish word at all.
   *
   * It is a capability limit rather than a prompt defect, and that was demonstrated rather
   * than argued: when the recitation gate was tightened, the model rewrote a Spanish bio
   * from a recitation into `Cursó lenguas`, third person preterite where first person
   * present was needed. The defect moved instead of disappearing.
   *
   * An empty bio is realistic and correct; a Spanish bio with a conjugation error is a
   * tell no reader misses. This is the same rule the template path already runs under:
   * SILENCE BEATS WRONG.
   *
   * A larger model very likely lifts this, but that is a hardware and cost decision for
   * the platform rather than for this component. Widening the list is how it gets lifted,
   * and the list is here so somebody has to look at this comment first.
   */
  languages: string[];
}

/**
 * The default names a model that is ACTUALLY INSTALLED, checked rather than guessed.
 *
 * The first version of this file defaulted to `qwen2.5:7b-instruct`, which was a plausible
 * name and was not present on the machine. A default that cannot run is worse than no
 * default: it turns "no model configured" into "the model is failing", which is exactly
 * the distinction the standing rule asks to be kept.
 *
 * Verified against `GET /api/tags` on 2026-07-31: ollama 0.32.3 serving `qwen3.5:9b`
 * (family qwen35, 9.7B, Q4_K_M, 262144 context). Re-check when the host changes; the
 * model identity is part of the bio cache key, so a change regenerates visibly.
 */
export const DEFAULT_MODEL_BIO_CONFIG: ModelBioConfig = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 30_000,
  temperature: 0.9,
  concurrency: 4,
  onFailure: 'template',
  attempts: 2,
  languages: ['de', 'en'],
});

/**
 * Names the model exactly, for the cache key.
 *
 * Part of the key rather than ignored, so swapping the model is VISIBLE as text changing
 * rather than silently producing different words for a seed that is supposed to be
 * reproducible.
 */
export function modelIdentity(config: ModelBioConfig): string {
  return `${config.model}@t${config.temperature}`;
}

/** Everything the model is told about the person. Nothing here is a decision it makes. */
export interface BioConditioning {
  seed: number;
  language: string;
  theme: Exclude<BioTheme, 'none'>;
  latent: Latent;
  style: Style;
  ageBand: AgeBand;
  activityTier: ActivityTier;
  interests: string[];
  /** Target word count the deterministic length draw produced. */
  targetWords: number;
  /**
   * The avatar's own display name. Passed so the wording can suit the person, and
   * BLOCKED from appearing in the output: a profile description that states the name
   * printed directly above it reads as generated.
   */
  displayName: string;
}

/**
 * Every adjective the conditioning can contain.
 *
 * Kept as one list because the validator has to know what the prompt said. The first real
 * model run wrote "I am a very organised, warm Linux enthusiast who finds quiet moments"
 * and "Organised typography enthusiast with a curious mind": the model RECITED its own
 * inputs instead of expressing them. Nobody describes themselves as organised and warm;
 * being organised and warm is what the writing is supposed to show.
 */
const CONDITIONING_STEMS = [
  // English, as the prompt states them.
  'conventional', 'curious', 'casual', 'organis', 'organiz', 'reserved', 'outgoing',
  'blunt', 'warm', 'unflappable', 'highly strung', 'formal', 'neutral', 'terse',
  'moderate', 'talkative', 'serious', 'playful', 'lurker', 'contributor', 'superuser',
  // AND THE TRANSLATIONS, because the recitation survives translation. The conditioning
  // is written in English and the bio is not: "Ich bin geordnet, doch warmherzig" is the
  // same defect as "I am organised and warm", and an English-only list called it clean.
  'geordnet', 'ordentlich', 'strukturier', 'warmherzig', 'neugierig', 'zurückhaltend',
  'gesellig', 'gelassen', 'förmlich', 'wortkarg', 'gesprächig', 'verspielt', 'ungeduldig',
  'organizad', 'curios', 'reservad', 'cálid', 'sociable', 'parc',
  'organisé', 'curieu', 'réservé', 'chaleureu', 'ludique',
  'georganiseerd', 'nieuwsgierig', 'teruggetrokken', 'hartelijk', 'spraakzaam',
] as const;

/**
 * Match a stem plus up to four more letters, on Unicode letter boundaries.
 *
 * NOT `\b` AND NOT WHOLE WORDS, and both halves of that were learned the hard way.
 *
 * Whole words under-catch, because these languages inflect: the list held
 * `strukturiert` and the model wrote `strukturiere`, so the recitation slipped through as
 * a finite verb and took a dangling object with it ("meinen Kaffee genieße und
 * strukturiere", which reads as "I enjoy and structure my coffee"). A German or Romance
 * word list that matches only the citation form is a list that mostly does not fire.
 *
 * `\b` is the wrong boundary, because it is ASCII-derived: `\bcálido\b` behaves
 * unpredictably around the accented letter. `(?<![\p{L}])` is the boundary that means
 * what it says in every language this generator writes.
 *
 * Four letters is the bound, so `organis` reaches `organised` and `organising` but stops
 * short of `organisation`, which is a noun a real bio may legitimately contain.
 */
function stemPattern(stem: string): RegExp {
  // String.raw, NOT a plain template literal. This is the third escaping fault in this
  // one function: `\p` in a plain template literal is an identity escape yielding `p`, so
  // `[\p{L}]` silently became the character class [p{L}] and matched braces and the
  // letters p and L. It still "worked" well enough to look right and gated the wrong
  // things. String.raw makes the pattern mean what it reads as.
  return new RegExp(
    String.raw`(?<![\p{L}])` + stem + String.raw`[\p{L}]{0,4}(?![\p{L}])`,
    'iu',
  );
}

/** Percentiles read as words. A model handles "quite formal" better than `tone: 23`. */
function band(v: number, low: string, mid: string, high: string): string {
  return v < 33 ? low : v < 67 ? mid : high;
}

function trait(v: number, low: string, high: string): string {
  if (v <= -0.6) return `very ${low}`;
  if (v <= -0.2) return low;
  if (v < 0.2) return 'neither';
  if (v < 0.6) return high;
  return `very ${high}`;
}

function describe(c: BioConditioning): Record<string, unknown> {
  return {
    language: c.language,
    aboutRoughly: c.theme,
    interests: c.interests,
    approximateWordCount: c.targetWords,
    person: {
      openness: trait(c.latent.openness, 'conventional', 'curious'),
      conscientiousness: trait(c.latent.conscientiousness, 'casual', 'organised'),
      extraversion: trait(c.latent.extraversion, 'reserved', 'outgoing'),
      agreeableness: trait(c.latent.agreeableness, 'blunt', 'warm'),
      neuroticism: trait(c.latent.neuroticism, 'unflappable', 'highly strung'),
      ageBand: c.ageBand,
      postsHowOften: c.activityTier,
    },
    writingStyle: {
      formality: band(c.style.tone, 'formal', 'neutral', 'very casual'),
      wordiness: band(c.style.verbosity, 'terse', 'moderate', 'talkative'),
      warmth: band(c.style.warmth, 'cool', 'neutral', 'warm'),
      humour: band(c.style.humor, 'serious', 'dry', 'playful'),
      sentenceComplexity: band(c.style.sentenceComplexity, 'fragments', 'simple', 'complex'),
      emoji: band(c.style.emojiAffinity, 'never', 'rarely', 'often'),
    },
  };
}

function systemPrompt(c: BioConditioning): string {
  return [
    `Write the profile description (bio) for one member of a chat community.`,
    ``,
    `WRITE IN ${c.language.toUpperCase()}. Write it as a native speaker of that language`,
    `would write it, with that language's own spelling, capitalisation and idiom. Never`,
    `translate an English phrase word for word.`,
    ``,
    `Write AS the person, in first person or as a bare fragment. Never write about them.`,
    `A bio is a self-description. It is not a greeting, not a reply, not a status message.`,
    ``,
    `Rules:`,
    `- About ${c.targetWords} words. Real bios are short; fragments are fine.`,
    `- Do not use the em-dash, the en-dash, the horizontal bar or the middle dot. Nobody`,
    `  can type those on a phone keyboard, so they give away that a machine wrote this.`,
    `- Do not state the person's name. It is already displayed above the bio.`,
    `- Do not name an interest more than once.`,
    `- No hashtags, no contact details, no links, no quotation marks around the whole bio.`,
    `- Do not explain yourself. Return only the bio text.`,
    ``,
    `THE PERSON DESCRIPTION IS NOT VOCABULARY. It says how this person writes and what`,
    `they care about. It is never a list of words to use, and never something to state.`,
    `Someone organised writes an organised bio; they do not write "I am organised".`,
    `Someone warm sounds warm; they do not say "warm". Never describe your own`,
    `personality, and never use the words from the person description in the bio.`,
    ``,
    `Match the person and the writing style given. The point is that this reads as one`,
    `specific person rather than as a generic profile.`,
  ].join('\n');
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bio'],
  properties: { bio: { type: 'string', minLength: 1, maxLength: 600 } },
} as const;

/** Model output is untrusted text on its way to being read as a member's own words. */
function sanitise(raw: string): string {
  return (
    raw
      .replace(/```/g, '')
      // The standing rule (CCB-S3-021), applied at the last possible moment. A prompt is
      // a request; this is the guarantee.
      .replace(/[–—―]/g, ' - ')
      .replace(/·/g, ', ')
      // Control characters stripped ON PURPOSE: a stray C0/C1 byte would ride into
      // the rendered member list. The rule fires on the intent, not on a fault.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      // A model that wrapped the whole thing in quotes meant the text, not the quotes.
      .replace(/^["'«»„“”](.*)["'«»„“”]$/su, '$1')
      .trim()
  );
}

/** Meta-text a model emits when it answers the request instead of performing it. */
const META = /^(here(?: is|'s)\b|sure[,!]|certainly[,!]|bio:|profile:|okay[,!]|of course[,!])/iu;

/**
 * Reasons a generated bio is rejected.
 *
 * REPORTED AND COUNTED, never silently accepted. Model output fails less obviously than
 * template output, so the failure modes that CAN be named mechanically are named here and
 * the rest is what the reading step in the review views is for.
 */
export type BioRejection =
  | 'empty'
  | 'meta-text'
  | 'too-long'
  | 'names-self'
  | 'has-link'
  | 'recites-traits';

/**
 * Every rejection reason, enumerated at runtime.
 *
 * EXISTS SO THE HARNESS CAN PROVE EACH ONE ACTUALLY REJECTS. A validator whose job is to
 * reject must be gated on rejecting: a test asserting that good input passes says nothing
 * at all about whether bad input fails, and three escaping faults in this file each
 * produced a check that read correctly, type-checked, and rejected nothing while the
 * harness reported green. `verify:bio-model` walks this list and fails if any reason was
 * never triggered, so adding a reason without a test that fires it breaks the build
 * rather than quietly widening what gets through.
 */
export const BIO_REJECTIONS: readonly BioRejection[] = [
  'empty', 'meta-text', 'too-long', 'names-self', 'has-link', 'recites-traits',
] as const;

export function validateBio(text: string, c: BioConditioning): BioRejection | null {
  if (text.length === 0) return 'empty';
  if (META.test(text)) return 'meta-text';
  // Generous: the word target is a target, not a contract, and a model that runs 3x over
  // it has stopped writing a bio and started writing a paragraph.
  if (text.split(/\s+/u).filter(Boolean).length > Math.max(12, c.targetWords * 3)) return 'too-long';
  if (/https?:\/\/|www\./iu.test(text)) return 'has-link';
  const first = c.displayName.split(/\s+/u)[0];
  if (first !== undefined && first.length >= 3 && text.toLocaleLowerCase().includes(first.toLocaleLowerCase())) {
    return 'names-self';
  }
  // TWO OR MORE, not one. A bio may legitimately contain "curious" or "dry"; a bio
  // containing two of the exact adjectives its own conditioning used is reciting the
  // input, which is what the first real model run did in roughly half its output.
  const lower = text.toLocaleLowerCase();
  // Two silent failures are compressed into `stemPattern`, and NEITHER of them ever
  // showed up as a failing check. First, `\b` inside a template literal is U+0008,
  // the backspace character, so the original built /organised/ and matched nothing at
  // all while the harness reported green. Second, whole-word matching then missed every
  // inflected form: the list held `strukturiert`, the model wrote `strukturiere`, and
  // the recitation walked straight through as a finite verb.
  const recited = CONDITIONING_STEMS.filter((stem) => stemPattern(stem).test(lower));
  if (recited.length >= 2) return 'recites-traits';
  return null;
}

export type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;

/**
 * One bio, from the model. Throws on anything unusable; the caller counts and falls back.
 *
 * Throwing rather than returning a placeholder is deliberate (CCB-S3-023): a caught error
 * converted into a value that reads as a legitimate result is exactly the masking the
 * standing rule forbids, and here it would mean a population silently half written by a
 * model and half by the template pool with no way to tell which.
 */
export async function writeBioWithModel(
  c: BioConditioning,
  config: ModelBioConfig,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const endpoint = new URL('/v1/chat/completions', `${config.baseUrl}/`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt(c) },
          { role: 'user', content: JSON.stringify(describe(c)) },
        ],
        stream: false,
        temperature: config.temperature,
        max_tokens: 200,
        // The installed model has a `thinking` capability, and a profile description is
        // the last thing that needs one. Left on it spends most of its latency and most
        // of its token budget reasoning about a sentence, and a population is thousands
        // of these. Ignored by models that do not support the field.
        reasoning_effort: 'none',
        // The same seed must give the same text from the same model. The cache is the
        // real guarantee, but asking costs nothing and makes a cold run reproducible too.
        seed: c.seed,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'cinderella_bio', strict: true, schema: SCHEMA },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`bio model HTTP ${response.status}`);

    const body: unknown = await response.json();
    const content = (body as { choices?: { message?: { content?: unknown } }[] })
      ?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('bio model returned no message content');

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('bio model returned content that is not JSON');
    }
    const bio = (parsed as { bio?: unknown }).bio;
    if (typeof bio !== 'string') throw new Error('bio model returned no bio field');

    const text = sanitise(bio);
    const rejection = validateBio(text, c);
    if (rejection !== null) throw new Error(`bio model output rejected: ${rejection}`);
    return text;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`bio model timed out after ${config.timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
