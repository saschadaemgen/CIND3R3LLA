/**
 * The Moderation console (CCB-S4-032, D-136): two ladders, who is under something, and
 * the record.
 *
 * ── WHAT THIS SECTION PROMISES AND WHAT IT DOES NOT ──────────────────────────
 *
 * Enforcement SHIPS OBSERVING. Every page says so in its own words rather than in one
 * banner the operator learns to scroll past, because the difference between "she muted
 * four people last night" and "she would have" is the whole product. The mode control
 * renders the alternative DISABLED with an honest sentence: a select that offered
 * `enforce` and then quietly did nothing would be exactly the dead toggle this project
 * refuses to ship.
 *
 * The Active page is empty by construction while every row is observed, and it says
 * that rather than looking broken.
 */

import type { FastifyInstance } from 'fastify';
import {
  ARMING_UNLOCKED,
  DEFAULT_MODERATION_RULES,
  ENFORCEMENT_ACTIONS,
  LADDER_RUNGS,
  type EnforcementAction,
  type ModerationRules,
} from '../../moderation/rules.js';
import {
  botModerationRules,
  listViolations,
  updateModerationRules,
  type ViolationRow,
  ARM_CONFIRMATION,
  findSanction,
  listActiveSanctionsDetailed,
  listSanctionsDetailed,
  markSanctionUndone,
  updateModerationMode,
  type ActiveSanctionRow,
} from '../../moderation/store.js';
import { invalidateModerationRules } from '../../moderation/service.js';
// The console can act, and it acts through exactly the same port and the same restore
// function the expiry job uses. Two reversal paths that did not share code would be two
// chances to put a member back as the wrong thing.
import { restoreSanction } from '../../moderation/apply.js';
import { enforcementAvailable, liveEnforcementPort } from '../../bot/enforcement.js';
import { writeAudit } from '../../db/audit.js';
import {
  listBotOnboardingProfiles,
  type BotOnboardingProfile,
  type SdkGroupRole,
} from '../../profiles/bot-onboarding.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, pageHeader } from './ui.js';
import { resolveSelectedBot } from '../selected-bot.js';

const INPUT_CLS = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';

const ROLES: SdkGroupRole[] = [
  'owner',
  'admin',
  'moderator',
  'member',
  'author',
  'observer',
  'relay',
];

const SECTIONS: { slug: string; title: string; desc: string }[] = [
  {
    slug: 'rules',
    title: 'Rules',
    desc: 'The two ladders, their windows, and who enforcement never touches.',
  },
  {
    slug: 'active',
    title: 'Active',
    desc: 'Members currently under a sanction that has not lapsed or been undone.',
  },
  {
    slug: 'log',
    title: 'Log',
    desc: 'Every violation counted and every step decided. Tune the thresholds from here.',
  },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

function fmt(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16);
}

function numberField(name: string, value: number, min: number, max: number): SafeHtml {
  return html`<input
    name="${name}"
    type="number"
    min="${String(min)}"
    max="${String(max)}"
    step="1"
    value="${String(value)}"
    class="${INPUT_CLS} sm:w-32"
  />`;
}

function actionField(name: string, current: EnforcementAction): SafeHtml {
  const labels: Record<EnforcementAction, string> = {
    none: 'none (rung is inert)',
    warn: 'warn',
    mute: 'mute (role to Observer)',
    block: 'block',
    remove: 'remove from group',
  };
  return html`<select name="${name}" class="${INPUT_CLS}">
    ${ENFORCEMENT_ACTIONS.map(
      (action) =>
        html`<option value="${action}" ${action === current ? raw('selected') : ''}>
          ${labels[action]}
        </option>`,
    )}
  </select>`;
}

/**
 * The index of the rung whose threshold is derived from the warning count, or -1.
 *
 * Mirrors `deriveFromWarningCount`: the first live rung after the live `warn` rung. Kept
 * here rather than exported from the rules module because it is a rendering question,
 * and getting it wrong renders a field editable that the normaliser would overwrite,
 * which the console check below catches.
 */
function derivedRungIndex(rules: ModerationRules): number {
  if (rules.warningCount <= 0) return -1;
  const live = rules.enforcement
    .map((rung, index) => (rung.action === 'none' ? -1 : index))
    .filter((index) => index >= 0);
  const warnAt = live.find((index) => rules.enforcement[index]!.action === 'warn');
  if (warnAt === undefined) return -1;
  return live.find((index) => index > warnAt) ?? -1;
}

/**
 * The mode control, and the switch that turns recordings into consequences.
 *
 * ── WHY ARMING COSTS SIX KEYSTROKES AND DISARMING COSTS NONE ─────────────────
 *
 * The confirmation is a TYPED WORD, not a checkbox, for the reason
 * `updateModerationRules` already gives about the ordering guarantee: a box is something
 * an operator ticks once and then ticks forever. Typing cannot happen by a stray click or
 * by a browser restoring a form.
 *
 * Going back to observing has no confirmation at all. Friction belongs on the direction
 * that increases harm, and an operator who wants enforcement to stop must be able to make
 * it stop now. Same asymmetry as the consent path, where taking it back is always cheaper
 * than giving it.
 *
 * The sentence names the three things that become possible, in the plainest words
 * available, because "enforce" is a word that hides what it does.
 */
/**
 * ── THE SCOPE OF ARMING, WHICH NEEDED A JUDGEMENT (CCB-S5-017, D-170) ────────
 *
 * There are TWO things here and they have different scopes, which is why the briefing
 * flagged it. `moderation_mode` is a column on `cinderella_bot_profiles`, so which mode a
 * bot is in is PER BOT and correctly so: once arming is possible at all, one bot may enforce
 * in a strict group while another only observes. `ARMING_UNLOCKED` is a code constant, so
 * whether arming is possible AT ALL is a property of the BUILD, not of a bot and not even of
 * a deployment's settings. The switcher cannot vary it and no operator can set it.
 *
 * So the mode stays per bot and the page says the gate is deployment-wide, which is the
 * D-155 shape: a control that cannot be per bot says so, with the reason, instead of being
 * offered and then refusing.
 */
function modeCard(rules: ModerationRules, csrf: string, botId: number): SafeHtml {
  const armed = rules.mode === 'enforce';

  return card(
    armed ? 'Mode: enforcing' : 'Mode: observing',
    html`<p class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <strong>Per bot.</strong> The mode and both ladders below belong to the bot selected in
        the sidebar; another bot keeps its own. Whether enforcement can be armed at all is
        <strong>not</strong> per bot: it is a build-time constant for the whole deployment, so
        switching bots does not change it.
      </p>
      <p class="text-sm text-slate-600">
        ${armed
          ? html`Enforcement is <strong>live</strong>. When a rung fires, it happens: a mute
              changes the member's role to observer, a block hides their messages from
              everyone, a removal takes them out of the group. Every step is written to the
              <a class="underline" href="/moderation/log">Log</a> marked <em>enforced</em>,
              and every mute appears on the
              <a class="underline" href="/moderation/active">Active</a> page until it lifts.`
          : html`Enforcement is <strong>computing and recording only</strong>. Every step that
              would fire is written to the <a class="underline" href="/moderation/log">Log</a>
              marked <em>observed</em>, and nothing happens to anybody: no role is changed,
              nobody is blocked, nobody is removed. This is how thresholds get tuned against
              real traffic without silencing half a group by accident.`}
      </p>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        ${armed ? badge('enforcing', 'red') : badge('observing', 'amber')}
        <span class="text-xs text-slate-500">
          ${armed
            ? 'Members can be muted, blocked or removed by rule.'
            : 'Nothing can happen to a member while this says observing.'}
        </span>
      </div>

      ${!armed && !ARMING_UNLOCKED
        ? html`<div
            class="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900"
          >
            <p>
              <strong>Enforcement is built but not yet unlocked.</strong> Everything a
              reversible sanction needs is in place and checked: she remembers the role a
              muted member held, a timed mute expires through the durable queue, an expiry
              that gets lost shows here as overdue, and any mute can be lifted by hand. The
              failure paths are checked too: a role change that fails writes no row claiming
              it worked, and a member whose role is unknown is never muted at all.
            </p>
            <p class="mt-2">
              What is missing is proof against a <strong>real group with a real second
              member</strong>: an actual mute applied and lifted, a moderator restored as a
              moderator rather than as a plain member, and an expiry firing. None of that can
              be proven against a test double, and the only real group here is yours, whose
              members are not test subjects. Arming before that would be switching on
              consequences that have never run against anything real.
            </p>
            <p class="mt-2 text-xs">
              To unlock: set <code>ARMING_UNLOCKED</code> in
              <code>src/moderation/rules.ts</code> and do those checks. Nothing else changes.
            </p>
          </div>`
        : null}
      ${armed
        ? html`<form method="post" action="/moderation/mode" class="mt-4">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="bot" value="${String(botId)}" />
            <input type="hidden" name="mode" value="observe" />
            <button
              type="submit"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Stop enforcing, go back to observing
            </button>
            <p class="mt-2 text-xs text-slate-500">
              Takes effect on the next message. Sanctions already applied stay applied: this
              stops new ones, it does not lift old ones. Lift those on the
              <a class="underline" href="/moderation/active">Active</a> page.
            </p>
          </form>`
        : !ARMING_UNLOCKED
          ? null
          : html`<form method="post" action="/moderation/mode" class="mt-4">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="bot" value="${String(botId)}" />
            <input type="hidden" name="mode" value="enforce" />
            <div
              class="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900"
            >
              <p>
                <strong>Read this before arming.</strong> While enforcement is armed, members
                can be <strong>muted</strong>, <strong>blocked</strong> and
                <strong>removed</strong> by rule, automatically, without anybody being asked
                first. The ladder above decides who and when. Nobody reviews it in between.
              </p>
              <p class="mt-2">
                A mute is reversible: she remembers the role the member held and puts it back
                when the timer runs out, or when you lift it by hand. A block and a removal
                are <strong>not</strong> reversible from here and have to be undone in your
                own SimpleX client.
              </p>
              <label class="mt-3 flex flex-col gap-1">
                <span class="font-medium">Type ${ARM_CONFIRMATION} to confirm</span>
                <input
                  name="confirm"
                  autocomplete="off"
                  placeholder="${ARM_CONFIRMATION}"
                  class="w-full rounded-lg border border-red-300 px-2 py-1.5 sm:w-48"
                />
              </label>
              <button
                type="submit"
                class="mt-3 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"
              >
                Arm enforcement
              </button>
            </div>
          </form>`}

      <p class="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        <strong>The count decides, and nothing else does.</strong> The violation counter is a
        database count, the thresholds are numbers you set, and the rung follows from a
        comparison. No model output is read to choose a step, armed or not. She may say
        something about a step in her own voice; she never picks one.
      </p>`,
  );
}

function verbalCard(rules: ModerationRules, csrf: string, botId: number): SafeHtml {
  return card(
    'Ladder A: how sharply she answers',
    html`<form method="post" action="/moderation/rules" class="flex flex-col gap-4">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="bot" value="${String(botId)}" />
      <input type="hidden" name="section" value="verbal" />
      <p class="text-sm text-slate-600">
        Repetition raises her sharpness above the base set on the
        <a class="underline" href="/ai/personality">Personality page</a>, then it relaxes on
        its own as the violations age out of the window. This is tone and nothing else. It
        harms nobody, so it is live.
      </p>
      <label class="flex flex-col gap-1 text-sm sm:w-72">
        <span class="font-medium text-slate-700">Window (seconds)</span>
        ${numberField('verbalWindowSeconds', rules.verbalWindowSeconds, 10, 604800)}
        <span class="text-xs text-slate-500">
          How long a violation keeps counting toward her tone. There is no separate decay
          setting: ageing out of this window is the decay.
        </span>
      </label>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pr-3">Rung</th>
              <th class="py-2 pr-3">At this many in the window</th>
              <th class="py-2">Sharpness bonus</th>
            </tr>
          </thead>
          <tbody>
            ${rules.verbal.map(
              (rung, index) => html`<tr class="border-b border-slate-100">
                <td class="py-2 pr-3 text-slate-500">${String(index + 1)}</td>
                <td class="py-2 pr-3">
                  ${numberField(`verbal.${index}.threshold`, rung.threshold, 1, 100000)}
                </td>
                <td class="py-2">
                  ${numberField(`verbal.${index}.sharpnessBonus`, rung.sharpnessBonus, 0, 9)}
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="verbalExemptsStaff"
          ${rules.verbalExemptsStaff ? raw('checked') : ''}
          class="rounded"
        />
        Owners, admins and moderators are also spared the sharper tone
      </label>
      <span class="text-xs text-slate-500">
        Off by default. A sharper sentence is not a sanction, so a cheeky admin can still get
        one.
      </span>
      <button
        type="submit"
        class="self-start rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        Save ladder A
      </button>
    </form>`,
  );
}

function enforcementCard(rules: ModerationRules, csrf: string, botId: number): SafeHtml {
  // Which rung's threshold the warning count owns. Rendered read only rather than
  // hidden: an operator needs to see the number they are steering, they just must not be
  // able to type a second, contradicting one.
  const derivedRung = derivedRungIndex(rules);

  return card(
    'Ladder B: what would happen',
    html`<form method="post" action="/moderation/rules" class="flex flex-col gap-4">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="bot" value="${String(botId)}" />
      <input type="hidden" name="section" value="enforcement" />
      <p class="text-sm text-slate-600">
        While the mode is observing, every rung below is <strong>computed and written to
        the Log and nothing more</strong>. Set a rung to <em>none</em> to keep the ladder
        short without losing the capability; an inert rung is skipped, so a higher one still
        applies.
      </p>
      <div class="flex flex-wrap gap-6">
        <label class="flex flex-col gap-1 text-sm sm:w-72">
          <span class="font-medium text-slate-700">Window (seconds)</span>
          ${numberField('enforcementWindowSeconds', rules.enforcementWindowSeconds, 10, 604800)}
          <span class="text-xs text-slate-500">
            Counted separately from ladder A, so the tone can relax sooner than the count
            does.
          </span>
        </label>
        <label class="flex flex-col gap-1 text-sm sm:w-72">
          <span class="font-medium text-slate-700">Warnings before escalating</span>
          ${numberField('warningCount', rules.warningCount, 0, 100)}
          <span class="text-xs text-slate-500">
            <strong>She warns on every violation while the warning rung applies</strong>, so
            this number is exactly how many warnings a member hears before the next rung is
            reached. Set it to 0 for no warnings at all.
          </span>
        </label>
      </div>
      <p class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        The threshold of the rung after the warning is <strong>derived</strong> from that
        number and is shown below as read only. There is one control for the gap, not two
        that could disagree: change the warning count and the threshold follows.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pr-3">Rung</th>
              <th class="py-2 pr-3">At this many in the window</th>
              <th class="py-2 pr-3">Action</th>
              <th class="py-2">Mute duration (seconds)</th>
            </tr>
          </thead>
          <tbody>
            ${rules.enforcement.map(
              (rung, index) => html`<tr class="border-b border-slate-100">
                <td class="py-2 pr-3 text-slate-500">${String(index + 1)}</td>
                <td class="py-2 pr-3">
                  ${derivedRung === index
                    ? html`<div class="flex flex-col gap-1">
                        <input
                          type="number"
                          value="${String(rung.threshold)}"
                          class="${INPUT_CLS} sm:w-32"
                          readonly
                          disabled
                        />
                        <span class="text-xs text-slate-500">derived</span>
                      </div>`
                    : numberField(`enforcement.${index}.threshold`, rung.threshold, 1, 100000)}
                </td>
                <td class="py-2 pr-3">${actionField(`enforcement.${index}.action`, rung.action)}</td>
                <td class="py-2">
                  ${numberField(
                    `enforcement.${index}.durationSeconds`,
                    rung.durationSeconds,
                    0,
                    31536000,
                  )}
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium text-slate-700">Enforcement never applies to</span>
        <div class="flex flex-wrap gap-3">
          ${ROLES.map(
            (role) => html`<label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="exempt:${role}"
                ${rules.exemptRoles.includes(role) ? raw('checked') : ''}
                class="rounded"
              />
              ${role}
            </label>`,
          )}
        </div>
        <span class="text-xs text-slate-500">
          She cannot act against an owner in any case, because SimpleX will not let a bot
          outrank one. Keeping owner ticked means she never tries and fails, which is the
          difference between a policy and an error in the log.
        </span>
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="announce"
          ${rules.announce ? raw('checked') : ''}
          class="rounded"
        />
        Announce a step in the chat when it is applied
      </label>
      <span class="text-xs text-slate-500">
        Stored now, honoured when enforcement is armed. Nothing is announced while the mode
        is observing, because nothing happens.
      </span>

      <button
        type="submit"
        class="self-start rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        Save ladder B
      </button>
    </form>`,
  );
}

/**
 * The distinction the briefing asks be made plainly, because the two are easy to
 * confuse and do completely different things.
 */
function spamLimitNote(): SafeHtml {
  return card(
    'This is not the nickname anti-spam limit',
    html`<p class="text-sm text-slate-600">
        The anti-spam limit on the
        <a class="underline" href="/interaction/nicknames">Nicknames page</a> stops her
        <em>answering</em> after so many nicknames in a row. It is a reply suppression: she
        goes quiet, and nothing at all happens to the member.
      </p>
      <p class="mt-3 text-sm text-slate-600">
        The ladders on this page are about the member. Ladder A changes how she sounds;
        ladder B decides what would be done about them. A member can hit the anti-spam limit
        and climb these ladders in the same minute, and the two do not know about each other.
      </p>`,
  );
}

function rulesBody(
  profiles: BotOnboardingProfile[],
  rules: ModerationRules,
  csrf: string,
  botId: number | null,
): SafeHtml {
  // The SELECTED bot, not `profiles[0]` (CCB-S5-017). That was the primary, always, and it
  // is what made every save on this page land on one bot whatever the operator was looking at.
  const bot = profiles.find((p) => p.id === botId);
  if (!bot) {
    return card(
      'No bot profile yet',
      html`<p class="text-sm text-slate-600">
          Moderation rules belong to a bot, and there is no bot profile to configure. Create
          one first.
        </p>
        <a
          class="mt-3 inline-flex rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          href="/ai/onboarding"
          >Open the bot setup</a
        >`,
    );
  }

  return html`
    ${modeCard(rules, csrf, bot.id)}
    <div class="mt-4">${verbalCard(rules, csrf, bot.id)}</div>
    <div class="mt-4">${enforcementCard(rules, csrf, bot.id)}</div>
    <div class="mt-4">${spamLimitNote()}</div>
  `;
}

/**
 * Who is actually serving something, and how to let them out.
 *
 * ── WHY OVERDUE IS A ROW ON THIS PAGE AND NOT A LOG LINE ─────────────────────
 *
 * A mute is a promise with a deadline. The expiry job is what keeps it, and the job can be
 * lost: a crash between the row committing and the job being accepted, a dead-lettered
 * retry, a queue that was never started. In every one of those cases the member stays an
 * observer forever and nothing anywhere says so, because the sanction still looks exactly
 * like a mute that has not expired yet.
 *
 * So overdue is computed on read (`expires_at` passed, `expired_at` still null) and shown
 * in red at the top of the page the operator already looks at. CCB-S4-032's query excluded
 * these rows by filtering on `expires_at > now`, which was right while nothing could
 * expire and is exactly wrong now.
 */
function activeBody(
  active: ActiveSanctionRow[],
  csrf: string,
  botName: string | null,
): SafeHtml {
  const overdue = active.filter((row) => row.overdue).length;

  return card(
    // The bot is NAMED (CCB-S5-017). This list read across every bot with no column saying
    // whose, so an operator could not tell which bot had sanctioned whom. It is one bot's
    // now, and the title says which rather than leaving it to be inferred.
    `Members currently under a sanction by ${botName ?? 'this bot'}`,
    active.length === 0
      ? html`<p class="text-sm text-slate-600">
            <strong>Nobody.</strong> Either enforcement has not applied anything, or
            everything it applied has since been lifted. A mute leaves this page when the
            role has actually been put back, not when its clock runs out, so an empty page
            here means nobody is being held by anything.
          </p>`
      : html`
          ${overdue > 0
            ? html`<p
                class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
              >
                <strong
                  >${String(overdue)} sanction(s) are past their expiry and have not
                  lifted.</strong
                >
                The automatic expiry did not run for these, so the members are still held.
                Lift them here.
              </p>`
            : null}
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th class="py-2 pr-3">Since</th>
                  <th class="py-2 pr-3">Member</th>
                  <th class="py-2 pr-3">Chat</th>
                  <th class="py-2 pr-3">Step</th>
                  <th class="py-2 pr-3">Was</th>
                  <th class="py-2 pr-3">Until</th>
                  <th class="py-2"></th>
                </tr>
              </thead>
              <tbody>
                ${active.map(
                  (row) => html`<tr
                    class="border-b border-slate-100 ${row.overdue ? 'bg-red-50' : ''}"
                  >
                    <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${fmt(row.decidedAt)}</td>
                    <td class="py-2 pr-3">${row.memberDisplayName}</td>
                    <td class="py-2 pr-3 text-slate-500">${String(row.groupId)}</td>
                    <td class="py-2 pr-3">${badge(row.action, 'red')}</td>
                    <td class="py-2 pr-3 text-slate-500">
                      ${row.previousRole ?? 'unknown'}
                    </td>
                    <td class="whitespace-nowrap py-2 pr-3 text-slate-500">
                      ${row.expiresAt
                        ? row.overdue
                          ? html`<span class="font-medium text-red-700"
                              >overdue since ${fmt(row.expiresAt)}</span
                            >`
                          : fmt(row.expiresAt)
                        : 'no expiry'}
                    </td>
                    <td class="py-2">
                      ${row.action === 'mute'
                        ? html`<form method="post" action="/moderation/undo">
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <input type="hidden" name="id" value="${row.id}" />
                            <button
                              type="submit"
                              class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Lift now
                            </button>
                          </form>`
                        : html`<span class="text-xs text-slate-400">not reversible here</span>`}
                    </td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>
          <p class="mt-4 text-xs text-slate-500">
            <strong>Was</strong> is the role the member held before the mute, and it is what
            they are put back to. A block or a removal has no automatic reversal and none
            from this page: undo those in your own SimpleX client.
          </p>`,
  );
}

/**
 * The Log, where "what actually happened to whom" has to be readable at a glance.
 *
 * THREE OUTCOMES, NOT TWO (CCB-S4-035). Observation had only one axis worth showing,
 * because nothing ever happened. Armed, a decided step lands in one of three states and
 * an operator who cannot tell them apart cannot tell a working ladder from a broken one:
 *
 *   observed  - the mode was observing, nothing was attempted.
 *   enforced  - it was attempted and it worked.
 *   failed    - it was attempted and it did not, and the member is unaffected.
 *
 * The third is the one that must not hide. A ladder quietly failing every mute looks
 * identical to a ladder that is working, unless the failure is on the page in red with
 * the reason next to it. Refusals (an unknown role, an owner, a missing member id) are
 * failures too and carry their reason in the same column, prefixed so they read as
 * policy rather than as fault.
 */
function logBody(
  sanctions: ActiveSanctionRow[],
  violations: ViolationRow[],
  botName: string | null,
): SafeHtml {
  return html`
    <div class="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
      Showing what <strong>${botName ?? 'this bot'}</strong> counted and decided. Each bot keeps
      its own violations and its own sanctions, so another bot's records are on its own page:
      switch bots in the sidebar to see them.
    </div>
    <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
      Two different questions, two columns. <strong>Outcome</strong> is what happened to the
      member: <em>observed</em> means nothing was attempted, <em>enforced</em> means it was
      applied, <em>failed</em> means it was attempted and did not apply, and the member is
      unaffected. <strong>Heard</strong> is whether she said it in the chat.
    </div>
    ${card(
      'Steps decided',
      sanctions.length === 0
        ? html`<p class="text-sm text-slate-600">
            No rung has been reached yet. When one is, it appears here marked
            <em>observed</em>, with the rule and the count that produced it.
          </p>`
        : html`<div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th class="py-2 pr-3">When</th>
                  <th class="py-2 pr-3">Member</th>
                  <th class="py-2 pr-3">Role</th>
                  <th class="py-2 pr-3">Step</th>
                  <th class="py-2 pr-3">Why</th>
                  <th class="py-2">Outcome / heard</th>
                </tr>
              </thead>
              <tbody>
                ${sanctions.map(
                  (row) => html`<tr class="border-b border-slate-100 align-top">
                    <td class="whitespace-nowrap py-2 pr-3 text-slate-500">
                      ${fmt(row.decidedAt)}
                    </td>
                    <td class="py-2 pr-3">${row.memberDisplayName}</td>
                    <td class="py-2 pr-3 text-slate-500">${row.memberRole ?? 'unknown'}</td>
                    <td class="py-2 pr-3">
                      ${badge(row.action, row.mode === 'observed' ? 'amber' : 'red')}
                    </td>
                    <td class="py-2 pr-3 text-slate-600">
                      ${row.reason}
                      ${row.enforcementError
                        ? html`<div class="mt-1 text-xs font-medium text-red-700">
                            ${row.enforcementError}
                          </div>`
                        : null}
                      ${row.expiredAt
                        ? html`<div class="mt-1 text-xs text-slate-500">
                            lifted automatically ${fmt(row.expiredAt)}
                          </div>`
                        : null}
                      ${row.undoneAt
                        ? html`<div class="mt-1 text-xs text-slate-500">
                            lifted by ${row.undoneBy ?? 'an operator'} ${fmt(row.undoneAt)}
                          </div>`
                        : null}
                    </td>
                    <td class="py-2">
                      <div class="flex flex-col gap-1">
                        ${row.mode === 'observed'
                          ? badge('observed, nothing done', 'slate')
                          : row.enforcedAt
                            ? badge('enforced', 'red')
                            : badge('failed, member unaffected', 'amber')}
                        ${row.spokenAt
                          ? badge('said in the chat', 'blue')
                          : badge('not said', 'slate')}
                      </div>
                    </td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>`,
    )}
    <div class="mt-4">
      ${card(
        'Violations counted',
        violations.length === 0
          ? html`<p class="text-sm text-slate-600">
              Nothing counted yet. Each entry is one rule trigger by one member in one chat.
            </p>`
          : html`<div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr
                    class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
                  >
                    <th class="py-2 pr-3">When</th>
                    <th class="py-2 pr-3">Member</th>
                    <th class="py-2 pr-3">Role</th>
                    <th class="py-2 pr-3">Chat</th>
                    <th class="py-2">Rule</th>
                  </tr>
                </thead>
                <tbody>
                  ${violations.map(
                    (row) => html`<tr class="border-b border-slate-100">
                      <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${fmt(row.at)}</td>
                      <td class="py-2 pr-3">${row.memberDisplayName}</td>
                      <td class="py-2 pr-3 text-slate-500">${row.memberRole ?? 'unknown'}</td>
                      <td class="py-2 pr-3 text-slate-500">${String(row.groupId)}</td>
                      <td class="py-2">${row.type}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>`,
      )}
    </div>
  `;
}

function submenu(active: string): SafeHtml {
  return html`<nav class="mb-6 flex flex-wrap gap-1 border-b border-slate-200 pb-2">
    ${SECTIONS.map(
      (section) =>
        html`<a
          href="/moderation/${section.slug}"
          class="rounded-lg px-3 py-1.5 text-sm font-medium ${section.slug === active
            ? 'bg-slate-900 text-white'
            : 'text-slate-600 hover:bg-slate-100'}"
          >${section.title}</a
        >`,
    )}
  </nav>`;
}

/**
 * Turn the flat form body into a ladder document.
 *
 * The whole normalised object is rebuilt from the CURRENT rules and then overlaid with
 * what this form sent, so a page that edits one ladder cannot blank the other. Same
 * discipline as the Interaction console's per-section saves.
 */
function ladderFrom(
  body: Record<string, unknown>,
  section: string,
  current: ModerationRules,
): unknown {
  const next: Record<string, unknown> = { ...current };

  if (section === 'verbal') {
    next['verbalWindowSeconds'] = bodyString(body, 'verbalWindowSeconds');
    next['verbal'] = Array.from({ length: LADDER_RUNGS }, (_unused, index) => ({
      threshold: bodyString(body, `verbal.${index}.threshold`),
      sharpnessBonus: bodyString(body, `verbal.${index}.sharpnessBonus`),
    }));
    next['verbalExemptsStaff'] = 'verbalExemptsStaff' in body;
  } else if (section === 'enforcement') {
    next['enforcementWindowSeconds'] = bodyString(body, 'enforcementWindowSeconds');
    next['warningCount'] = bodyString(body, 'warningCount');
    next['enforcement'] = Array.from({ length: LADDER_RUNGS }, (_unused, index) => ({
      // The derived rung renders disabled, so its field is absent from the post. Falling
      // back to the CURRENT threshold rather than to a default keeps the normaliser's
      // derivation the only thing that ever sets it.
      threshold:
        bodyString(body, `enforcement.${index}.threshold`) ||
        String(current.enforcement[index]?.threshold ?? ''),
      action: bodyString(body, `enforcement.${index}.action`),
      durationSeconds: bodyString(body, `enforcement.${index}.durationSeconds`),
    }));
    next['exemptRoles'] = ROLES.filter((role) => `exempt:${role}` in body);
    next['announce'] = 'announce' in body;
  } else {
    throw new Error('Unknown moderation section.');
  }

  return next;
}

export function registerModeration(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{
    Params: { section?: string };
    Querystring: { saved?: string; error?: string; bot?: string };
  }>(
    '/moderation/:section',
    async (req, reply) => {
      const slug = req.params.section ?? 'rules';
      const meta = SECTIONS.find((section) => section.slug === slug);
      if (!meta) return reply.redirect('/moderation/rules');

      const csrf = req.session?.csrfToken ?? '';
      reply.type('text/html');

      const notice = req.query.saved
        ? html`<div
            class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            Saved. The next message she hears is counted against the new thresholds.
          </div>`
        : req.query.error
          ? html`<div
              class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              ${req.query.error}
            </div>`
          : null;

      // ── UNDER THE SWITCHER, THROUGH THE SHARED RESOLVER (CCB-S5-017) ──
      //
      // These pages took no bot at all. The Rules page read `profiles[0]`, which is the
      // PRIMARY because `listBotOnboardingProfiles` orders it first, so it always showed
      // and always saved the primary's ladders whatever the operator had selected. The Log
      // and Active pages read across every bot with no column saying whose.
      //
      // The same resolver every other settings page uses, rather than a fifth answer to one
      // question: the URL when it names a bot, otherwise the session's standing choice,
      // otherwise the first bot.
      const profiles = await listBotOnboardingProfiles(ctx.db);
      const selection = resolveSelectedBot(
        profiles,
        typeof req.query.bot === 'string' ? req.query.bot : undefined,
        req.session?.selectedBotProfileId ?? null,
      );
      const botId = selection.selectedId;

      let body: SafeHtml;
      if (slug === 'rules') {
        const rules =
          botId === null
            ? DEFAULT_MODERATION_RULES
            : ((await botModerationRules(ctx.db, botId)) ?? DEFAULT_MODERATION_RULES);
        body = rulesBody(profiles, rules, csrf, botId);
      } else if (slug === 'active') {
        body = activeBody(
          botId === null ? [] : await listActiveSanctionsDetailed(ctx.db, new Date(), botId),
          csrf,
          selection.selectedName,
        );
      } else {
        body = logBody(
          botId === null ? [] : await listSanctionsDetailed(ctx.db, new Date(), botId, 100),
          botId === null ? [] : await listViolations(ctx.db, botId, 100),
          selection.selectedName,
        );
      }

      return page({
        title: `Moderation ${meta.title}`,
        active: `moderation:${slug}`,
        csrfToken: csrf,
        botSwitcher: { ...selection, returnTo: `/moderation/${slug}` },
        body: html`${pageHeader(`Moderation ${meta.title}`, meta.desc)} ${submenu(slug)}
        ${notice} ${body}`,
      });
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/moderation/rules', async (req, reply) => {
    const botId = Number.parseInt(bodyString(req.body, 'bot'), 10);
    const section = bodyString(req.body, 'section');

    try {
      if (!Number.isSafeInteger(botId) || botId <= 0) throw new Error('No bot profile selected.');
      const current = (await botModerationRules(ctx.db, botId)) ?? DEFAULT_MODERATION_RULES;

      await updateModerationRules(
        ctx.db,
        botId,
        ladderFrom(req.body, section, current),
        req.session?.username ?? 'unknown',
      );
      // The engine caches the ladders, so a save has to say so or the operator would
      // tune a threshold and watch the old one keep firing.
      invalidateModerationRules();
      return reply.redirect('/moderation/rules?saved=1');
    } catch (error) {
      return reply.redirect('/moderation/rules?error=' + encodeURIComponent(errorMessage(error)));
    }
  });
  /**
   * Arm or disarm (CCB-S4-035, D-139).
   *
   * ITS OWN ROUTE, separate from the ladder save, so the switch that turns recordings into
   * consequences can never ride along with a threshold tweak. The confirmation phrase, the
   * ordering-guarantee re-check and the audit row all live in `updateModerationMode`, where
   * a second caller would get them too.
   */
  app.post<{ Body: Record<string, unknown> }>('/moderation/mode', async (req, reply) => {
    const botId = Number.parseInt(bodyString(req.body, 'bot'), 10);
    const requested = bodyString(req.body, 'mode');

    try {
      if (!Number.isSafeInteger(botId) || botId <= 0) throw new Error('No bot profile selected.');
      if (requested !== 'observe' && requested !== 'enforce') {
        throw new Error('Unknown moderation mode.');
      }

      await updateModerationMode(
        ctx.db,
        botId,
        requested,
        bodyString(req.body, 'confirm'),
        req.session?.username ?? 'unknown',
      );
      // The engine caches the rules, and the mode is one of them. Without this an operator
      // would arm enforcement and watch the next three messages still be observed.
      invalidateModerationRules();
      return reply.redirect(
        `/moderation/rules?saved=${requested === 'enforce' ? 'armed' : 'disarmed'}`,
      );
    } catch (error) {
      return reply.redirect('/moderation/rules?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  /**
   * Lift a sanction by hand.
   *
   * Goes through the same `restoreSanction` the expiry job uses, so the role that comes
   * back is the same role by the same path. A sanction already lifted returns an honest
   * note rather than an error, which is the briefing's explicit requirement: undo after
   * expiry is a no-op, not a failure.
   */
  app.post<{ Body: Record<string, unknown> }>('/moderation/undo', async (req, reply) => {
    const id = bodyString(req.body, 'id');

    try {
      if (!id) throw new Error('No sanction selected.');
      const row = await findSanction(ctx.db, id, new Date());
      if (!row) throw new Error('That sanction no longer exists.');

      const port = enforcementAvailable() ? liveEnforcementPort : null;
      if (!port) {
        // Refused rather than half-done. Marking it undone with no core to restore
        // through would take the member off the Active page while leaving them muted,
        // which is the lie this whole briefing is written against.
        throw new Error(
          'The bot is not running, so the role cannot be restored. The sanction is left ' +
            'in place rather than marked lifted while the member is still held.',
        );
      }

      const outcome = await restoreSanction(ctx.db, port, row);
      if (outcome.status === 'already' || outcome.status === 'nothing-to-do') {
        return reply.redirect('/moderation/active?saved=' + encodeURIComponent(outcome.note));
      }

      const marked = await markSanctionUndone(ctx.db, id, req.session?.username ?? 'unknown');
      await writeAudit(
        ctx.db,
        req.session?.username ?? 'unknown',
        'cinderella.moderation.undo',
        `sanction:${id}`,
        { action: row.action, restoredRole: outcome.role, marked },
      );
      return reply.redirect(
        '/moderation/active?saved=' +
          encodeURIComponent(`lifted, ${row.memberDisplayName} is ${outcome.role} again`),
      );
    } catch (error) {
      return reply.redirect('/moderation/active?error=' + encodeURIComponent(errorMessage(error)));
    }
  });
}
