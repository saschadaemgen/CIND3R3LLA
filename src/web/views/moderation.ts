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
  DEFAULT_MODERATION_RULES,
  ENFORCEMENT_ACTIONS,
  LADDER_RUNGS,
  type EnforcementAction,
  type ModerationRules,
} from '../../moderation/rules.js';
import {
  botModerationRules,
  listActiveSanctions,
  listSanctions,
  listViolations,
  updateModerationRules,
  type SanctionRow,
  type ViolationRow,
} from '../../moderation/store.js';
import { invalidateModerationRules } from '../../moderation/service.js';
import {
  listBotOnboardingProfiles,
  type BotOnboardingProfile,
  type SdkGroupRole,
} from '../../profiles/bot-onboarding.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, pageHeader } from './ui.js';

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
 * The mode control.
 *
 * `enforce` is rendered and DISABLED. Offering it as a working choice would arm an
 * untuned ladder against a real group; hiding it entirely would leave the operator
 * wondering whether the capability exists. Disabled plus a sentence is the honest
 * middle, and the save path does not read this field at all.
 */
function modeCard(): SafeHtml {
  return card(
    'Mode: observing',
    html`<p class="text-sm text-slate-600">
        Enforcement is <strong>computing and recording only</strong>. Every step that would
        fire is written to the Log marked <em>observed</em>, and nothing happens to anybody:
        no role is changed, nobody is blocked, nobody is removed. This is how thresholds get
        tuned against real traffic without silencing half a group by accident.
      </p>
      <div class="mt-4 flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-slate-700">Enforcement mode</span>
          <select class="${INPUT_CLS} sm:w-72" disabled>
            <option selected>Observe: record what would happen</option>
            <option>Enforce: actually apply the step</option>
          </select>
        </label>
        ${badge('observing', 'amber')}
      </div>
      <p class="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        <strong>Speech is live, action stays observed.</strong> A warning changes nothing
        about anybody's membership, so she <em>does</em> say it, in her own voice, at
        whatever sharpness ladder A has reached. Mute, block and remove touch a member's
        standing, so they are recorded and nothing more. That is the whole of what
        observation mode means: she talks, she does not act.
      </p>
      <p class="mt-3 text-xs text-slate-500">
        Enforce is deliberately not selectable yet. Arming it is its own piece of work,
        because it needs the parts that make a sanction reversible: remembering the role a
        muted member held so restoring returns them to it, expiring a timed mute, and an
        undo. Until then this control would be a switch that pretends to work.
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
): SafeHtml {
  const bot = profiles[0];
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
    ${modeCard()}
    <div class="mt-4">${verbalCard(rules, csrf, bot.id)}</div>
    <div class="mt-4">${enforcementCard(rules, csrf, bot.id)}</div>
    <div class="mt-4">${spamLimitNote()}</div>
  `;
}

function activeBody(active: SanctionRow[]): SafeHtml {
  return card(
    'Members currently under a sanction',
    active.length === 0
      ? html`<p class="text-sm text-slate-600">
            <strong>Nobody, and that is expected.</strong> Enforcement is observing: it works
            out what would happen and writes it to the
            <a class="underline" href="/moderation/log">Log</a> without doing it. This page
            stays empty until enforcement is armed, and an empty page here is the system
            behaving correctly rather than a page that failed to load.
          </p>`
      : html`<div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th class="py-2 pr-3">Since</th>
                <th class="py-2 pr-3">Member</th>
                <th class="py-2 pr-3">Chat</th>
                <th class="py-2 pr-3">Step</th>
                <th class="py-2">Until</th>
              </tr>
            </thead>
            <tbody>
              ${active.map(
                (row) => html`<tr class="border-b border-slate-100">
                  <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${fmt(row.decidedAt)}</td>
                  <td class="py-2 pr-3">${row.memberDisplayName}</td>
                  <td class="py-2 pr-3 text-slate-500">${String(row.groupId)}</td>
                  <td class="py-2 pr-3">${badge(row.action, 'red')}</td>
                  <td class="whitespace-nowrap py-2 text-slate-500">
                    ${row.expiresAt ? fmt(row.expiresAt) : 'no expiry'}
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`,
  );
}

function logBody(sanctions: SanctionRow[], violations: ViolationRow[]): SafeHtml {
  return html`
    <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
      Two different questions, two badges. <strong>Applied</strong> is whether it happened
      to the member: while the mode is observing, never. <strong>Heard</strong> is whether
      she said it in the chat: warnings are, everything harder is not.
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
                  <th class="py-2">Applied / heard</th>
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
                    <td class="py-2 pr-3">${badge(row.action, 'amber')}</td>
                    <td class="py-2 pr-3 text-slate-600">${row.reason}</td>
                    <td class="py-2">
                      <div class="flex flex-col gap-1">
                        ${row.mode === 'observed'
                          ? badge('observed, nothing done', 'slate')
                          : badge('enforced', 'red')}
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
  app.get<{ Params: { section?: string }; Querystring: { saved?: string; error?: string } }>(
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

      let body: SafeHtml;
      if (slug === 'rules') {
        const profiles = await listBotOnboardingProfiles(ctx.db);
        // The rules of the record the page is editing, which is the runtime one first
        // because `listBotOnboardingProfiles` orders it that way.
        const rules = profiles[0]
          ? ((await botModerationRules(ctx.db, profiles[0].id)) ?? DEFAULT_MODERATION_RULES)
          : DEFAULT_MODERATION_RULES;
        body = rulesBody(profiles, rules, csrf);
      } else if (slug === 'active') {
        body = activeBody(await listActiveSanctions(ctx.db, new Date()));
      } else {
        body = logBody(await listSanctions(ctx.db, 100), await listViolations(ctx.db, 100));
      }

      return page({
        title: `Moderation ${meta.title}`,
        active: `moderation:${slug}`,
        csrfToken: csrf,
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
}
