/**
 * Which bot the console is editing (CCB-S5-011, D-169).
 *
 * ── THE DEFECT THIS REPLACES ─────────────────────────────────────────────────
 *
 * Four page families each invented their own `?bot=` control: Interaction had pills inside a
 * card called "What this page changes", Personality had a dropdown, the Book had a sentence,
 * and AI Bot Setup had a master-detail list. So an operator had to re-state which bot he
 * meant on every page, could not tell at a glance which bot a form belonged to, and had no
 * single place that said it. The operator's own words were that it felt like four consoles.
 *
 * It also made the PRIMARY look like something he should think about, because the primary was
 * the console's default selection and the only thing that survived a page change. That is the
 * whole of what an operator ever noticed about the primary, and a remembered selection does
 * it better. This module does not remove the flag (that is its own briefing); it removes the
 * reason to look at it.
 *
 * ── THE TWO SOURCES, AND WHY THEY DIFFER ─────────────────────────────────────
 *
 * `?bot=` in the URL WINS when present, and does NOT change the remembered choice. A link to
 * a specific bot's page stays shareable and stays a one-off: following one shows you that
 * bot, and does not silently re-point the rest of your session at it.
 *
 * The SESSION holds the standing choice, written only by the switcher itself. It lives on
 * `admin_sessions` (migration 050) because it belongs to this operator's session and not to
 * the deployment, and it is cleared by the foreign key if that bot is deleted.
 *
 * Absent both, the FIRST bot. Never "no bot" when bots exist: a settings page with nothing
 * selected is a page that cannot say what it edits, which is the defect again.
 */

import type { BotOnboardingProfile } from '../profiles/bot-onboarding.js';

/** One bot, reduced to what a switcher needs. */
export interface SwitchableBot {
  id: number;
  displayName: string;
}

export interface SelectedBot {
  /** Every bot, in the order the console lists them. */
  bots: SwitchableBot[];
  /** The bot every form on this page edits, or null only when there are no bots at all. */
  selectedId: number | null;
  /** Its name, for the switcher and for any page that says whose settings these are. */
  selectedName: string | null;
  /**
   * True when the URL named the bot rather than the session.
   *
   * The switcher renders differently for it: an operator who followed a link to one bot
   * should be able to see that this page is not showing his usual selection, or he will read
   * the difference as the console having changed its mind.
   */
  fromUrl: boolean;
}

/**
 * Resolve the bot a page is editing.
 *
 * Pure, so the precedence is testable without a request: `verify:bot-switcher` drives every
 * combination of the three sources including the ones a browser cannot easily produce, such
 * as a session pointing at a bot that has since been deleted.
 */
export function resolveSelectedBot(
  profiles: readonly BotOnboardingProfile[],
  urlBot: string | undefined,
  sessionBot: number | null,
): SelectedBot {
  const bots = profiles.map((p) => ({ id: p.id, displayName: p.displayName }));
  // ── THE EXPLICIT SHARED VIEW (D-228) ──────────────────────────────────────
  //
  // `?bot=shared` selects the SHARED record on a page that offers both. It has to be
  // representable in the URL, because the fallback chain below ends at the first bot:
  // since CCB-S5-011 unified every page on this resolver, "no bot named" has meant
  // "your usual bot", so a link claiming the shared view needs a word for it. A one-off
  // view like any `?bot=` link: it does not touch the remembered choice.
  if (urlBot === 'shared') {
    return { bots, selectedId: null, selectedName: null, fromUrl: true };
  }
  const byId = (id: number | null): SwitchableBot | undefined =>
    id === null ? undefined : bots.find((b) => b.id === id);

  const requested = Number.parseInt(urlBot ?? '', 10);
  const fromUrlBot = Number.isSafeInteger(requested) ? byId(requested) : undefined;
  // The session's bot is validated against the list too. The foreign key clears it when a bot
  // is deleted, but a session read and a bot deletion can interleave, and a page rendering
  // "editing bot 14" for a bot that is gone is worse than falling back.
  const fromSession = fromUrlBot ? undefined : byId(sessionBot);
  const chosen = fromUrlBot ?? fromSession ?? bots[0];

  return {
    bots,
    selectedId: chosen?.id ?? null,
    selectedName: chosen?.displayName ?? null,
    fromUrl: fromUrlBot !== undefined,
  };
}
