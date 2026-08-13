/**
 * The Welcome plugin definition (CCB-S5-041, D-206).
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────────────
 *
 * A new member joins a group and she greets them ONCE, with something the
 * operator wrote. Per D-175 the capability and the TEXT are per bot; the
 * destination and the first-time/returning switch are per bot too, because a
 * greeting is the bot's own voice in the bot's own room and two bots in one
 * group may reasonably want different things - or, more usually, one of them
 * silent.
 *
 * ── THE THREE THINGS CALLED "WELCOME", NOW NAMED APART (D-206) ───────────────
 *
 * Three unrelated features wore one word, which is why a stored welcome went
 * nowhere for months and nobody could see that it was not meant to go anywhere:
 *
 *   1. `AddressSettings.autoReply` - the CONTACT-ADDRESS auto-reply, greeting
 *      someone who connects to the bot's address. Stored by onboarding as
 *      `welcome_message`, validated to 4000 characters, and NOT WIRED to
 *      anything. Left exactly where it is with an honest note; whether the
 *      operator wants a contact-address auto-reply at all is a question nobody
 *      has asked him, and it deserves its own decision rather than being
 *      absorbed into this one.
 *   2. `arrivalNotice()` (was `welcomeMessage()`) in `consent/commands.ts` -
 *      the consent-first line she posts when SHE joins a group, fired from
 *      `bot/connect.ts` on `userJoinedGroup`, from the one-shot `npm run
 *      connect` helper. Her arrival, not a member's.
 *   3. THIS - the member greeting. It owns its own text and shares nothing with
 *      either of the above.
 *
 * ── WHY IT CONTRIBUTES NO INTENT ─────────────────────────────────────────────
 *
 * `intents: []`. Nobody asks to be welcomed; the trigger is a membership event.
 * So the absent-capability property is one layer down, as with the bridge and
 * the knowledge base: for a bot the plugin is off for, the trigger plans
 * nothing and sends nothing, proven with a spy rather than by inspecting a
 * catalog.
 *
 * ── THE MODEL DOES NOT WRITE THIS AND DOES NOT SEE IT ────────────────────────
 *
 * D-137 and D-180. A greeting containing a fabricated fact is worse than no
 * greeting, and the member's name is filled by the APPLICATION. That also
 * settles the guard question the briefing raised: `containsBlockedLiteral`,
 * which rejects a reply carrying the speaking member's display name, has
 * exactly two call sites and both are inside `generateOllamaReply`. It reads
 * `AiReplyRequest.blockedLiterals`, a field that only exists for a model
 * request. An application-written greeting never meets it - which is correct
 * rather than lucky, since that guard exists because the MODEL invents uses of
 * a member's name.
 *
 * The consequence is that this path has NO automatic protection, so the
 * placeholder fill is the only thing between a member's name and the wire, and
 * it carries its own check rather than leaning on a guard that will never run.
 *
 * ── OFF BY DEFAULT ───────────────────────────────────────────────────────────
 *
 * It speaks to a member unprompted, in public by default, on somebody else's
 * arrival. That is a thing an operator turns on deliberately after reading what
 * it does.
 */

import { definePlugin } from '../registry.js';

export const WELCOME_ID = 'welcome';

export const welcomePlugin = definePlugin({
  id: WELCOME_ID,
  name: 'Welcome',
  description:
    'Greets a member once when they join a group, with text you write. The greeting can go to the group, to the private support thread, or as a direct message, and a member who left and came back can get a different line. The capability and the text are per bot.',
  version: '1.0.0',
  intents: [],
  // See the note above: it speaks unprompted, in public by default, on somebody else's
  // arrival. The bridge is off by default for the same reason.
  defaultEnabled: false,
  adminPath: '/welcome',
});
