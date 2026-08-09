/**
 * What a bot actually is, as four readable facts (CCB-S5-009, D-163).
 *
 * ── WHY THIS IS A MODULE AND NOT FOUR EXPRESSIONS IN A VIEW ──────────────────
 *
 * The operator created a second bot and stopped, because creation left it in a state he
 * could not read: the name it answered to was derived invisibly, its retorts were somebody
 * else's, and finding either out meant visiting other pages. Answering that is a decision
 * with real edges (inherited is not the same as absent, and neither is the same as off), and
 * decisions with edges belong somewhere they can be driven with no database and no console.
 *
 * Same reasoning as `bot/runtime/faces.ts`: the console renders this, it does not compute it.
 */

import type { InteractionSettings } from '../interaction/settings.js';
import type { SettingOverride } from '../interaction/setting-scope.js';

/** Where a bot's nickname retorts come from. The three are not interchangeable. */
export type RetortSource =
  /** Written for this bot. Editable, and what a new bot ships with since CCB-S5-009. */
  | 'own'
  /** No deviation, so it is answering with the shared list: another bot's voice and name. */
  | 'inherited'
  /** Its own list, deliberately emptied. The nickname path answers nothing. */
  | 'none';

export interface BotIdentityFacts {
  wakeWord: string;
  /** False when the bot has no deviation and is answering to the deployment default. */
  wakeWordIsOwn: boolean;
  retortCount: number;
  retortSource: RetortSource;
  hasFace: boolean;
  onboarded: boolean;
}

export interface BotIdentityInput {
  /** This bot's own avatar path, or null for the deployment default (D-161). */
  avatarPath: string | null;
  /** The contact link the core returned, or null while onboarding has not produced one. */
  contactAddressLink: string | null;
  /** This bot's deviations. Absence of a key means it inherits the shared value. */
  overrides: readonly SettingOverride[];
  shared: InteractionSettings;
  /** Which language's retorts to count. The reply path picks per message; this reports one. */
  language?: string;
}

function retortsOf(value: unknown, language: string, fallback: string): string[] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const byLang = value as Record<string, unknown>;
  const picked = byLang[language] ?? byLang[fallback] ?? byLang['en'];
  return Array.isArray(picked) ? picked.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The four facts.
 *
 * ── THE RETORT BRANCH IS THE LOAD-BEARING ONE ────────────────────────────────
 *
 * `own` requires an override row, because that is what "written for this bot" means in the
 * storage model: absence is inheritance, and inheritance of the shipped retorts is a bot
 * telling members that the glass slipper does not come in a shortened size. An override whose
 * list is EMPTY is `none` rather than `own`, because an operator who emptied it deliberately
 * has a working configuration that answers nothing, and calling that "its own" would report a
 * silent feature as healthy.
 *
 * The distinction only exists because the console has to name it. The engine does not care:
 * it reads the effective list either way, which is exactly why nothing announced any of this
 * before somebody went looking.
 */
export function botIdentity(input: BotIdentityInput): BotIdentityFacts {
  const language = input.language ?? input.shared.defaultLanguage ?? 'en';
  const wakeOverride = input.overrides.find((o) => o.key === 'wakeWord');
  const retortOverride = input.overrides.find((o) => o.key === 'retorts');

  const own = retortOverride === undefined ? undefined : retortsOf(retortOverride.value, language, 'en');
  const inherited = retortsOf(input.shared.retorts, language, 'en') ?? [];

  return {
    wakeWord:
      typeof wakeOverride?.value === 'string' && wakeOverride.value.trim() !== ''
        ? wakeOverride.value
        : input.shared.wakeWord,
    wakeWordIsOwn: typeof wakeOverride?.value === 'string' && wakeOverride.value.trim() !== '',
    retortCount: own === undefined ? inherited.length : own.length,
    retortSource: own === undefined ? 'inherited' : own.length === 0 ? 'none' : 'own',
    hasFace: input.avatarPath !== null,
    // The contact address is the first onboarding step that touches a real SimpleX profile
    // and the one the page already treats as the Onboarded/Not onboarded line. Reusing that
    // definition rather than inventing a second one, so two places cannot disagree.
    onboarded: input.contactAddressLink !== null,
  };
}
