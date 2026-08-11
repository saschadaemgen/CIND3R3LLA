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
import { wakeWordForNewBot } from '../interaction/setting-scope.js';
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
  /**
   * Where the wake word comes from (CCB-S5-030).
   *
   *   own     the operator set it. It stays put, including through a rename.
   *   name    it follows this bot's display name, so a rename carries through.
   *   shared  neither: the display name derives nothing usable, so the deployment default
   *           applies and this bot cannot be told apart from any other on it.
   *
   * This replaced a boolean. The boolean had only two answers and the interesting state was
   * the third: a bot whose word was pinned at creation reported "its own" in green, which is
   * exactly what an operator sees on a bot that has silently stopped following its name.
   */
  wakeWordSource: 'own' | 'name' | 'shared';
  /** What the word WOULD be if it followed the name, so the panel can offer it. Null if none. */
  wakeWordFromName: string | null;
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
  /**
   * This bot's display name, which is what its wake word falls back to (CCB-S5-030).
   *
   * Optional so that callers written before this keep compiling; absent means the panel
   * cannot tell "follows its name" from "on the shared default" and reports the latter.
   */
  displayName?: string;
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

  const ownWake =
    typeof wakeOverride?.value === 'string' && wakeOverride.value.trim() !== ''
      ? wakeOverride.value
      : null;
  // The same derivation the reply path uses, from the same function, so this panel and the
  // bot cannot disagree about what it answers to (CCB-S5-030).
  const fromName = input.displayName === undefined ? null : wakeWordForNewBot(input.displayName);

  return {
    wakeWord: ownWake ?? fromName ?? input.shared.wakeWord,
    wakeWordSource: ownWake !== null ? 'own' : fromName !== null ? 'name' : 'shared',
    wakeWordFromName: fromName,
    retortCount: own === undefined ? inherited.length : own.length,
    retortSource: own === undefined ? 'inherited' : own.length === 0 ? 'none' : 'own',
    hasFace: input.avatarPath !== null,
    // The contact address is the first onboarding step that touches a real SimpleX profile
    // and the one the page already treats as the Onboarded/Not onboarded line. Reusing that
    // definition rather than inventing a second one, so two places cannot disagree.
    onboarded: input.contactAddressLink !== null,
  };
}
