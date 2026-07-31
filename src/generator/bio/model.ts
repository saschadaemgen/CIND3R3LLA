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
}

export const DEFAULT_MODEL_BIO_CONFIG: ModelBioConfig = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:7b-instruct',
  timeoutMs: 30_000,
  temperature: 0.9,
  concurrency: 4,
  onFailure: 'template',
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
export type BioRejection = 'empty' | 'meta-text' | 'too-long' | 'names-self' | 'has-link';

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
