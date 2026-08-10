/**
 * Knowledge Base settings (CCB-S5-022, D-176), stored under `plugin:knowledge-base`.
 *
 * Two groups, and the split is not cosmetic:
 *
 *   INGEST settings decide what is IN the store. Changing one makes every existing chunk a
 *   chunk somebody else's settings produced, so the console must say so before the change
 *   and the documents must be marked stale after it.
 *
 *   RETRIEVAL settings decide what is SEARCHED and what survives. Changing one costs
 *   nothing and takes effect on the next question.
 *
 * The reasoning for each default is in `chunk.ts` and `retrieval.ts`, beside the code that
 * uses it, rather than duplicated here.
 */

import { CHUNK_DEFAULTS, type ChunkSettings } from '../../knowledge/chunk.js';
import { RETRIEVAL_DEFAULTS, type RetrievalSettings } from '../../knowledge/retrieval.js';

/**
 * When she consults the store at all.
 *
 * ── WHY THIS IS NOT THE WEB SEARCH TRIGGER ───────────────────────────────────
 *
 * Web search triggers on an EXPLICIT request ("look up X") because a false positive there is
 * an outbound request, a bill, and a stranger's text entering the prompt. None of those is
 * true here: the store is the operator's own documents, on his own disk, and consulting it
 * costs one local embedding call measured at ~120 ms warm.
 *
 * So requiring "check your notes" would be the wrong shape. It would mean she only knows
 * what he gave her when a member happens to know she was given it, which is the opposite of
 * knowing something.
 *
 * `always` therefore attempts retrieval on every free-conversation turn, and the RELEVANCE
 * FLOOR is what decides whether anything is used. That keeps the decision deterministic and
 * inspectable, exactly as the web search precedent asks, while putting the judgement on a
 * calibrated number rather than on a keyword list. `explicit` is offered for an operator who
 * wants the narrower behaviour, and `off` is the same as not enabling the plugin except that
 * it keeps the documents.
 *
 * COMMAND LANES ARE NEVER IN SCOPE, on any setting. Consent, moderation, the retorts and the
 * Book do not consult the store, because their words are decided by the application and a
 * retrieved chunk has no business anywhere near a consent confirmation.
 */
export const RETRIEVAL_TRIGGERS = ['always', 'explicit', 'off'] as const;
export type RetrievalTrigger = (typeof RETRIEVAL_TRIGGERS)[number];

export const TRIGGER_NOTES: Record<RetrievalTrigger, string> = {
  always:
    'Every free-conversation question. The relevance floor decides whether anything is actually used, so an unrelated question retrieves nothing and she says so.',
  explicit:
    'Only when a member asks her to consult what she was given ("check your notes", "what do your documents say"). Narrower, and she will not know a thing unless asked to look.',
  off: 'Never. The documents stay stored and granted, and nothing is retrieved.',
};

export interface KnowledgeSettings extends ChunkSettings, RetrievalSettings {
  trigger: RetrievalTrigger;
}

export const KNOWLEDGE_DEFAULTS: Readonly<KnowledgeSettings> = Object.freeze({
  ...CHUNK_DEFAULTS,
  ...RETRIEVAL_DEFAULTS,
  trigger: 'always',
});

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'on' || value === 'true' || value === '1') return true;
  if (value === 'off' || value === 'false' || value === '0') return false;
  return fallback;
}

/**
 * Normalised on read, like every other plugin's settings.
 *
 * The ceilings are enforced here rather than trusted from the form, for the reason the web
 * search normaliser gives: a stored document written by a different version must not be able
 * to hand the prompt builder a budget nobody typed. `budgetChars` has the tightest ceiling
 * of the lot at 6000, matching web search exactly, because it is the same quantity.
 */
export function normalizeKnowledge(raw: unknown): KnowledgeSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = KNOWLEDGE_DEFAULTS;
  const trigger = typeof o['trigger'] === 'string' ? o['trigger'] : '';

  const targetChars = clampInt(o['targetChars'], 200, 4000, d.targetChars);
  return {
    // Ingest
    targetChars,
    // The overlap cannot reach the chunk size: at half of it a document would grow without
    // bound as every chunk repeated most of the last one.
    overlapChars: clampInt(o['overlapChars'], 0, Math.floor(targetChars / 2), d.overlapChars),
    maxChars: clampInt(o['maxChars'], targetChars, 8000, Math.max(targetChars, d.maxChars)),
    contextualPrefix: bool(o['contextualPrefix'], d.contextualPrefix),
    // Retrieval
    candidatesPerSearch: clampInt(o['candidatesPerSearch'], 1, 100, d.candidatesPerSearch),
    maxChunks: clampInt(o['maxChunks'], 1, 20, d.maxChunks),
    keywordWeight: clampFloat(o['keywordWeight'], 0, 10, d.keywordWeight),
    vectorWeight: clampFloat(o['vectorWeight'], 0, 10, d.vectorWeight),
    // Cosine similarity, so the bounds are the metric's own.
    minScore: clampFloat(o['minScore'], -1, 1, d.minScore),
    budgetChars: clampInt(o['budgetChars'], 200, 6000, d.budgetChars),
    trigger: (RETRIEVAL_TRIGGERS as readonly string[]).includes(trigger)
      ? (trigger as RetrievalTrigger)
      : d.trigger,
  };
}
