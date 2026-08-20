/**
 * The resolver seam (CCB-S3-002 §8).
 *
 * Every caller goes through {@link resolveIntent}. Nothing outside this file
 * imports the rule engine, so a later briefing can register a local AI brain
 * with {@link setIntentResolver} and change no caller at all — with the rule
 * engine staying registered as the automatic fallback for when the AI endpoint
 * is unreachable, slow, or returns something outside the closed catalog.
 *
 * The catalog is enforced HERE rather than trusted from the implementation. A
 * resolver that invents an intent, returns a confidence outside 0..1, or throws
 * is treated as having said UNKNOWN. The catalog is the ACTIVE one, so an intent
 * whose plugin is switched off is rejected the same way an invented one is. For a rule engine that is belt-and-braces;
 * for a model it is the difference between "I did not understand" and an
 * unauthorised publish.
 */

import { log } from '../log.js';
import {
  inCatalog,
  unknownResult,
  type Intent,
  type IntentContext,
  type IntentResolver,
  type IntentResult,
  type IntentSlots,
} from './intent.js';
import {
  asksForMusic,
  asksToLookItUp,
  asksWhatSomethingIs,
  namesTheArchive,
  priceSlotsFor,
  ruleResolver,
} from './rules.js';

let active: IntentResolver = ruleResolver;
/** Fallback used when `active` fails. Always the deterministic engine. */
const fallback: IntentResolver = ruleResolver;

/** Swaps in another implementation (the AI brain, in a later briefing). */
export function setIntentResolver(resolver: IntentResolver): void {
  active = resolver;
  log.info(`Intent resolver set to "${resolver.name}".`);
}

/** Restores the deterministic rule engine as the active resolver. */
export function resetIntentResolver(): void {
  active = ruleResolver;
}

export function activeResolverName(): string {
  return active.name;
}

/** Coerces any resolver's output into a valid, in-catalog result. */
function sanitize(raw: unknown, lang: string, catalog: readonly Intent[]): IntentResult {
  if (!raw || typeof raw !== 'object') return unknownResult(lang);
  const r = raw as Record<string, unknown>;
  // Validated against THIS BOT'S catalog, not just the compile-time one: an intent
  // belonging to a plugin that is off for this bot is treated exactly like an invented
  // one (CCB-S3-004 §0, per bot since CCB-S5-021).
  if (!inCatalog(catalog, r['intent'])) return unknownResult(lang);

  const confidence =
    typeof r['confidence'] === 'number' && Number.isFinite(r['confidence'])
      ? Math.min(1, Math.max(0, r['confidence']))
      : 0;

  const rawSlots = (r['slots'] ?? {}) as Record<string, unknown>;
  const slots: IntentSlots = {};
  if (typeof rawSlots['query'] === 'string' && rawSlots['query'].trim()) {
    slots.query = rawSlots['query'].trim().slice(0, 200);
  }
  if (typeof rawSlots['targetName'] === 'string' && rawSlots['targetName'].trim()) {
    slots.targetName = rawSlots['targetName'].trim().slice(0, 80);
  }
  if (Array.isArray(rawSlots['baseAlternates'])) {
    const alts = (rawSlots['baseAlternates'] as unknown[])
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim().slice(0, 40))
      .slice(0, 8);
    if (alts.length > 0) slots.baseAlternates = alts;
  }
  for (const key of ['base', 'quote'] as const) {
    const v = rawSlots[key];
    if (typeof v === 'string' && v.trim()) slots[key] = v.trim().slice(0, 40);
  }
  // An amount that is not a finite positive number is dropped rather than
  // coerced — the caller's default of 1 is always safe, a NaN never is.
  if (typeof rawSlots['amount'] === 'number' && Number.isFinite(rawSlots['amount'])) {
    const a = rawSlots['amount'];
    if (a > 0 && a <= 1e15) slots.amount = a;
  }

  return {
    intent: r['intent'],
    confidence,
    slots,
    lang: typeof r['lang'] === 'string' && r['lang'] ? r['lang'] : lang,
    // Authoritative only when the resolver explicitly says so (CCB-S3-005 Addendum
    // A); a model that omits it falls back to the weighted contest, never asserts a
    // language it did not establish.
    langMatched: r['langMatched'] === true,
  };
}

/**
 * Slots for an elliptical follow-up that inherits a previous intent
 * (CCB-S3-006 §7c). Kept behind the seam so callers still never import the rule
 * engine, and restricted to READ-ONLY intents by its own signature — there is no
 * argument value that yields PUBLISH or UNPUBLISH.
 */
export function carryOverSlots(text: string, intent: 'PRICE' | 'SEARCH'): IntentResult | null {
  if (intent === 'SEARCH') {
    const q = text.trim();
    return q ? { intent: 'SEARCH', confidence: 0.7, slots: { query: q }, lang: 'en' } : null;
  }
  const slots = priceSlotsFor(text);
  if (!slots.base) return null;
  return { intent: 'PRICE', confidence: 0.7, slots, lang: 'en' };
}

/**
 * THE THREE LOOKUPS ARE ALL EXPLICIT-ONLY, FOR EVERY RESOLVER (D-181, extended by D-183).
 *
 * Enforced here for the same reason the catalog is: a property this seam can decide is not
 * left to the implementation to honour. `ollama-resolver.ts` also applies both bars, beside
 * its consent guard and where the override is counted for the console; this is the copy that
 * survives somebody registering a different resolver, which the seam exists to allow.
 *
 * Each bar calls the one predicate in `rules.ts`, built from the same patterns the rule engine
 * scores, so there is nothing here to drift.
 *
 * ── WHY THE TABLE, RATHER THAN TWO IFS ───────────────────────────────────────
 *
 * Because there were two, and the second one took four months and six production misroutes to
 * arrive. SEARCH got its gate in CCB-S5-027 and LOOKUP kept a bar that existed only as prose
 * in a prompt, which is the thing that had just been established as not working. A table makes
 * the question "does this intent have a deterministic bar" answerable by reading one object,
 * and makes the third case somebody adds an entry rather than an oversight.
 *
 * The knowledge base is deliberately NOT in here and cannot be: it contributes no intent at
 * all. It is the residue, and what these bars protect is its share of it.
 */
const EXPLICIT_ONLY: Partial<Record<Intent, { names: (text: string) => boolean; why: string }>> = {
  SEARCH: { names: namesTheArchive, why: 'names no place to look' },
  // CCB-S5-049: a definition question about a named thing is now ALSO a place to look.
  // It is not a relaxation of the bar - it is a second explicit shape, and the widest thing
  // it admits is "what is <named thing>", which is the shape every recorded invention took.
  LOOKUP: {
    names: (text: string) => asksToLookItUp(text) || asksWhatSomethingIs(text),
    why: 'neither asks her to go and look nor asks what a named thing is',
  },
  // CCB-S5-044, the third entry the table was built to receive.
  MUSIC: { names: asksForMusic, why: 'neither asks to play nor asks about the playlists' },
};

/**
 * Re-exported THROUGH THE SEAM, deliberately (CCB-S5-049, D-234).
 *
 * The engine needs this predicate to route a definition question to the lookup lane without
 * waiting for a resolver to claim LOOKUP. It must not reach into `rules.ts` to get it: this
 * file's own header says nothing outside it imports the rule engine, and the engine imports
 * nothing from there today. Handing it out here keeps that true and keeps the bar and the
 * route reading the SAME predicate, which is what stops them drifting apart.
 */
export { asksWhatSomethingIs } from './rules.js';

function explicitOnly(result: IntentResult, text: string): IntentResult {
  const bar = EXPLICIT_ONLY[result.intent];
  if (!bar || bar.names(text)) return result;
  log.debug(
    `Intent resolver "${active.name}" claimed ${result.intent} for a message that ${bar.why}; ` +
      'answering it as conversation instead (D-183).',
  );
  return unknownResult(result.lang);
}

/**
 * Resolves an instruction into an intent. Never throws, never executes anything,
 * and never returns anything outside the closed catalog.
 */
export async function resolveIntent(text: string, ctx: IntentContext): Promise<IntentResult> {
  try {
    return explicitOnly(
      sanitize(await active.resolve(text, ctx), ctx.defaultLanguage, ctx.intents),
      text,
    );
  } catch (err) {
    log.warn(
      `Intent resolver "${active.name}" failed (${
        err instanceof Error ? err.message : String(err)
      }); falling back to "${fallback.name}".`,
    );
  }
  try {
    return explicitOnly(
      sanitize(await fallback.resolve(text, ctx), ctx.defaultLanguage, ctx.intents),
      text,
    );
  } catch (err) {
    log.error(
      `Fallback intent resolver failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return unknownResult(ctx.defaultLanguage);
  }
}
