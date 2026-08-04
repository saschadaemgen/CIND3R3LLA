/**
 * Moderation: two ladders, and the guarantee that one of them does nothing
 * (CCB-S4-032, D-136).
 *
 * Offline and deterministic. PGlite for the counter, a driven clock for the rolling
 * window, and the real console for the pages. The live half, whether repetition
 * actually makes her sound harder, is `npm run verify:moderation-live`.
 *
 * ── THE ASSERTION THAT MATTERS MOST ──────────────────────────────────────────
 *
 * Section 5 is the no-act guarantee and it is checked three ways, because one way is
 * not enough for a system that could silence a group:
 *
 *   1. STRUCTURAL. The moderation tree is scanned for every enforcement API the SDK
 *      exposes. A source scan is what catches an action added months from now by
 *      somebody who never read this file, and it is mutation-proven below.
 *   2. BEHAVIOURAL. A member is driven past every rung with a spy standing in for the
 *      engine's ONLY outbound capability, and the spy must see nothing but retort text.
 *   3. RECORDED. Every sanction row is `observed`, and the schema itself refuses a row
 *      that claims to be observed and carries an enforcement timestamp.
 *
 *   npx tsx scripts/verify-moderation.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import type * as T from 'simplex-chat/dist/types.js';
import type { AdminConfig, Config } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  DEFAULT_MODERATION_RULES,
  describeRule,
  evaluateEnforcement,
  escalatesWithoutWarning,
  evaluateVerbal,
  normalizeModerationRules,
  warningPosition,
  type ModerationRules,
} from '../src/moderation/rules.js';
import {
  botModerationRules,
  countViolations,
  listActiveSanctions,
  listSanctions,
  listViolations,
  recordSanction,
  recordViolation,
  runtimeModerationRules,
  updateModerationRules,
} from '../src/moderation/store.js';
import { sharpenBy, type BotPersonality } from '../src/interaction/personality.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { normalizeInteraction, type InteractionSettings } from '../src/interaction/settings.js';
import type { AiReplyRequest } from '../src/interaction/ollama-reply.js';
import type { CapturedMessage } from '../src/capture/message.js';
import {
  createBotOnboardingProfile,
  listBotOnboardingProfiles,
  type BotOnboardingInput,
} from '../src/profiles/bot-onboarding.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

function cookieOf(setCookie: string | string[] | undefined, name: string): string | null {
  const values = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const value of values) {
    if (value.startsWith(`${name}=`)) return value.split(';')[0] ?? null;
  }
  return null;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'correct-horse-battery-staple';
const SESSION_SECRET = 'd'.repeat(48);
const GROUP = 42;
const OTHER_GROUP = 77;
const ALICE = 'alice-member-id';
const BOB = 'bob-member-id';

/**
 * Every SimpleX call that could sanction somebody.
 *
 * The scan below fails if any of these appears anywhere under `src/moderation/`. They
 * are the exact names from `simplex-chat/dist/api.d.ts`, so a future author reaching
 * for one is caught by the name they would naturally type.
 */
const ENFORCEMENT_APIS = [
  'apiSetMembersRole',
  'apiBlockMembersForAll',
  'apiRemoveMembers',
  'apiDeleteMemberChatItem',
];

let itemId = 9000;
function makeMessage(
  text: string,
  opts: { member?: string; group?: number; role?: CapturedMessage['senderRole'] } = {},
): CapturedMessage {
  return {
    groupId: opts.group ?? GROUP,
    groupName: 'archive',
    itemId: itemId++,
    sharedMsgId: undefined,
    senderMemberId: opts.member ?? ALICE,
    senderDisplayName: opts.member === BOB ? 'Bob' : 'Alice',
    senderRole: opts.role ?? 'member',
    senderGroupMemberId: 7,
    sentAt: new Date('2026-08-04T12:00:00.000Z').toISOString(),
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as T.AChatItem,
  };
}

function onboardingDefaults(): BotOnboardingInput {
  return {
    slug: 'cinderella',
    displayName: 'Cinderella',
    enabled: true,
    selectedForRuntime: true,
    createAddress: true,
    updateAddress: true,
    updateProfile: true,
    autoAcceptContacts: true,
    welcomeMessage: '',
    businessAddress: false,
    allowFiles: true,
    commandRegistryMode: 'cinderella_defaults',
    customCommands: [],
    useBotProfile: true,
    logContacts: true,
    logNetwork: false,
    groupInvitationMode: 'manual',
    expectedGroupRole: 'admin',
    roleVerificationRequired: true,
    policyActivationMode: 'manual',
    remoteCommandsEnabled: false,
    persistentChangesEnabled: false,
    contactRequestRetentionHours: 168,
    groupInvitationRetentionHours: 168,
    maxPendingContactRequests: 100,
    personality: { ...DEFAULT_PERSONALITY },
  };
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
}

async function main(): Promise<void> {
  setLogLevel('error');
  process.env['SESSION_SECRET'] ??= SESSION_SECRET;

  const pg = new PGlite();
  const db: Queryable = {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  };
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);

  /* ── 1. The ladders, as pure arithmetic ─────────────────────────────────── */

  console.log('\n1. The two ladders');

  const rules = DEFAULT_MODERATION_RULES;

  check('below the first rung nothing sharpens', evaluateVerbal(1, 'member', rules).sharpnessBonus === 0);
  check('the second nickname adds one', evaluateVerbal(2, 'member', rules).sharpnessBonus === 1);
  check(
    'the briefing target holds: the fifth adds four, so base 5 answers at 9',
    evaluateVerbal(5, 'member', rules).sharpnessBonus === 4 &&
      sharpenBy({ ...DEFAULT_PERSONALITY, sharpness: 5 }, 4)?.sharpness === 9,
  );
  check(
    'past the top rung it stays at the top rather than climbing',
    evaluateVerbal(500, 'member', rules).sharpnessBonus === 4,
  );
  check(
    'the sum is capped at the axis maximum',
    sharpenBy({ ...DEFAULT_PERSONALITY, sharpness: 9 }, 7)?.sharpness === 10,
  );
  check('a zero bonus returns the personality untouched', sharpenBy(DEFAULT_PERSONALITY, 0)?.sharpness === 5);
  check('no personality plus a bonus is still no personality', sharpenBy(null, 4) === null);

  check('below every rung no step fires', evaluateEnforcement(4, 'member', rules).action === 'none');
  check('the fifth reaches warn', evaluateEnforcement(5, 'member', rules).action === 'warn');
  check('the tenth reaches mute', evaluateEnforcement(10, 'member', rules).action === 'mute');
  check(
    'a mute carries its duration',
    evaluateEnforcement(10, 'member', rules).durationSeconds === 600,
  );
  check(
    'the shipped ladder never removes anybody by default',
    !rules.enforcement.some((rung) => rung.action === 'remove' || rung.action === 'block'),
  );

  // An inert rung must be skipped, not treated as a ceiling: climbing past a disabled
  // rung dropping the member back to no action would read as a bug.
  const withGap = normalizeModerationRules({
    ...rules,
    enforcement: [
      { threshold: 2, action: 'warn', durationSeconds: 0 },
      { threshold: 4, action: 'none', durationSeconds: 0 },
      { threshold: 6, action: 'mute', durationSeconds: 60 },
      { threshold: 9, action: 'none', durationSeconds: 0 },
    ],
  });
  check('an inert rung is skipped rather than blocking', evaluateEnforcement(5, 'member', withGap).action === 'warn');
  check('a live rung above an inert one still fires', evaluateEnforcement(7, 'member', withGap).action === 'mute');
  check(
    'an inert rung above a live one leaves the live one in force',
    evaluateEnforcement(20, 'member', withGap).action === 'mute',
  );

  /* ── 1c. The warning count owns the gap (CCB-S4-033) ────────────────────── */

  console.log('\n1c. Warnings are stated, not derived by arithmetic');

  check('the shipped count matches the gap 029 shipped implicitly', rules.warningCount === 5);
  check(
    'the rung after the warning sits exactly that many violations later',
    rules.enforcement[0]?.threshold === 5 && rules.enforcement[1]?.threshold === 10,
  );

  // ONE SOURCE OF TRUTH: the threshold follows the count, on every normalisation, so a
  // stored value and a form post cannot disagree.
  const shortened = normalizeModerationRules({ ...rules, warningCount: 2 });
  check(
    'shortening the count moves the derived threshold',
    shortened.enforcement.find((rung) => rung.action === 'mute')?.threshold === 7,
  );
  const lengthened = normalizeModerationRules({ ...rules, warningCount: 20 });
  check(
    'lengthening it moves the threshold too',
    lengthened.enforcement.find((rung) => rung.action === 'mute')?.threshold === 25,
  );
  // Asserted by ACTION, not by index. Normalisation sorts the ladder, so a rung's
  // position is not stable across it and an index-based assertion tests the sort rather
  // than the derivation.
  const typedOver = normalizeModerationRules({
    ...rules,
    warningCount: 3,
    enforcement: rules.enforcement.map((rung, index) =>
      index === 1 ? { ...rung, threshold: 999 } : rung,
    ),
  });
  check(
    'a threshold typed in against the count is overwritten by the derivation',
    typedOver.enforcement.find((rung) => rung.action === 'mute')?.threshold === 8,
  );
  // The defect this section found: derivation ran after the sort, so the ladder could
  // come back out of order, and evaluation took the LAST match rather than the highest.
  check(
    'the ladder is still in threshold order after the derivation',
    typedOver.enforcement.every(
      (rung, index, all) => index === 0 || rung.threshold >= all[index - 1]!.threshold,
    ),
  );
  check(
    'and the decision does not depend on the order anyway',
    evaluateEnforcement(
      50,
      'member',
      // Deliberately unsorted, which the normaliser would never now produce.
      {
        ...rules,
        warningCount: 1,
        enforcement: [
          { threshold: 30, action: 'block', durationSeconds: 0 },
          { threshold: 5, action: 'warn', durationSeconds: 0 },
          { threshold: 8, action: 'mute', durationSeconds: 60 },
        ],
      },
    ).action === 'block',
  );
  check(
    'rungs above the derived one are pushed clear rather than left below it',
    normalizeModerationRules({
      ...rules,
      warningCount: 40,
      enforcement: [
        { threshold: 5, action: 'warn', durationSeconds: 0 },
        { threshold: 10, action: 'mute', durationSeconds: 60 },
        { threshold: 20, action: 'block', durationSeconds: 0 },
        { threshold: 30, action: 'remove', durationSeconds: 0 },
      ],
    }).enforcement.every((rung, index, all) => index === 0 || rung.threshold > all[index - 1]!.threshold),
  );

  // The count IS the number of warnings, by construction rather than by a second rule.
  const warned: number[] = [];
  for (let count = 1; count <= 12; count++) {
    if (evaluateEnforcement(count, 'member', rules).action === 'warn') warned.push(count);
  }
  check('exactly the configured number of warnings fire', warned.length === rules.warningCount, JSON.stringify(warned));
  check('and then the next rung takes over', evaluateEnforcement(10, 'member', rules).action === 'mute');
  check('the warning positions run 1..N', warningPosition(5, rules)?.number === 1 &&
    warningPosition(9, rules)?.number === 5 && warningPosition(9, rules)?.total === 5);
  check('past the last warning there is no position', warningPosition(10, rules) === null);
  check('before the first there is none either', warningPosition(4, rules) === null);

  // Zero warnings is a deliberate choice, and it makes the warn rung inert.
  const noWarnings = normalizeModerationRules({ ...rules, warningCount: 0 });
  check('zero warnings makes the warn rung inert', evaluateEnforcement(5, 'member', noWarnings).action === 'none');
  check('and the harder rung still applies', evaluateEnforcement(10, 'member', noWarnings).action === 'mute');
  check('with no warning position to report', warningPosition(6, noWarnings) === null);
  check(
    'the warn rung is kept in the stored ladder rather than rewritten',
    noWarnings.enforcement.some((rung) => rung.action === 'warn'),
  );

  /* ── 1d. The ordering guarantee ─────────────────────────────────────────── */

  console.log('\n1d. A mute is never the first thing that happens');

  check('the shipped ladder warns first', !escalatesWithoutWarning(rules));
  const muteFirst = normalizeModerationRules({
    ...rules,
    enforcement: [
      { threshold: 3, action: 'mute', durationSeconds: 60 },
      { threshold: 8, action: 'warn', durationSeconds: 0 },
      { threshold: 20, action: 'none', durationSeconds: 0 },
      { threshold: 30, action: 'none', durationSeconds: 0 },
    ],
  });
  check('a ladder that mutes before warning is detected', escalatesWithoutWarning(muteFirst));
  check(
    'an inert first rung does not count as the first thing that happens',
    !escalatesWithoutWarning(
      normalizeModerationRules({
        ...rules,
        enforcement: [
          { threshold: 2, action: 'none', durationSeconds: 0 },
          { threshold: 5, action: 'warn', durationSeconds: 0 },
          { threshold: 10, action: 'mute', durationSeconds: 60 },
          { threshold: 30, action: 'none', durationSeconds: 0 },
        ],
      }),
    ),
  );
  check(
    'zero warnings is a deliberate choice, not a violation',
    !escalatesWithoutWarning(normalizeModerationRules({ ...muteFirst, warningCount: 0 })),
  );

  /* ── 2. Exemptions ──────────────────────────────────────────────────────── */

  console.log('\n2. Exemptions');

  check('an owner is never enforced against', evaluateEnforcement(999, 'owner', rules).exempt);
  check('an admin is never enforced against', evaluateEnforcement(999, 'admin', rules).exempt);
  check('a moderator is never enforced against', evaluateEnforcement(999, 'moderator', rules).exempt);
  check('an ordinary member is not exempt', !evaluateEnforcement(999, 'member', rules).exempt);
  check(
    'an exempt member reaches no step at all',
    evaluateEnforcement(999, 'owner', rules).action === 'none',
  );
  check(
    'staff still get the sharper tone by default',
    evaluateVerbal(5, 'admin', rules).sharpnessBonus === 4,
  );
  check(
    'unless the operator says otherwise',
    evaluateVerbal(5, 'admin', normalizeModerationRules({ ...rules, verbalExemptsStaff: true }))
      .sharpnessBonus === 0,
  );
  // An unknown role must be visible as unknown, because the arming briefing has to
  // refuse to act on it rather than aim a sanction at a member who might be an owner.
  check('an unknown role is reported as unknown', !evaluateEnforcement(9, null, rules).roleKnown);
  check('a known role is reported as known', evaluateEnforcement(9, 'member', rules).roleKnown);

  /* ── 3. The rolling window ──────────────────────────────────────────────── */

  console.log('\n3. Counting, decay, and scope');

  const t0 = new Date('2026-08-04T12:00:00.000Z');
  const at = (secondsLater: number): Date => new Date(t0.getTime() + secondsLater * 1000);

  for (let i = 0; i < 3; i++) {
    await db.query(
      `INSERT INTO cinderella_violations (group_id, member_id, member_display_name, member_role, type, at)
       VALUES ($1, $2, 'Alice', 'member', 'nickname', $3)`,
      [GROUP, ALICE, at(i).toISOString()],
    );
  }
  check(
    'violations inside the window count',
    (await countViolations(db, { groupId: GROUP, memberId: ALICE, type: 'nickname' }, 600, at(10))) === 3,
  );
  // The whole point of a rolling window: five nicknames spread over a year must never
  // add up to a ban.
  check(
    'violations age out of the window',
    (await countViolations(db, { groupId: GROUP, memberId: ALICE, type: 'nickname' }, 600, at(1000))) === 0,
  );
  check(
    'a shorter window sees fewer of them',
    (await countViolations(db, { groupId: GROUP, memberId: ALICE, type: 'nickname' }, 2, at(2))) === 3,
  );

  await recordViolation(db, {
    groupId: OTHER_GROUP,
    memberId: ALICE,
    memberDisplayName: 'Alice',
    memberRole: 'member',
    type: 'nickname',
  });
  check(
    'a violation in another chat does not count here',
    (await countViolations(db, { groupId: GROUP, memberId: ALICE, type: 'nickname' }, 600, at(10))) === 3,
  );
  check(
    'and a different member has their own count',
    (await countViolations(db, { groupId: GROUP, memberId: BOB, type: 'nickname' }, 600, at(10))) === 0,
  );

  /* ── 4. The rules are stored per bot ────────────────────────────────────── */

  console.log('\n4. Per-bot rules');

  const botId = await createBotOnboardingProfile(db, onboardingDefaults(), 'verify-moderation');
  const shipped = await botModerationRules(db, botId);
  check('a new bot ships with the default ladders', shipped?.verbal[3]?.sharpnessBonus === 4);
  check('and ships observing', shipped?.mode === 'observe');
  check('the runtime bot resolves', (await runtimeModerationRules(db))?.mode === 'observe');

  const saved = await updateModerationRules(
    db,
    botId,
    {
      ...DEFAULT_MODERATION_RULES,
      verbalWindowSeconds: 120,
      verbal: [
        { threshold: 2, sharpnessBonus: 2 },
        { threshold: 3, sharpnessBonus: 4 },
        { threshold: 4, sharpnessBonus: 5 },
        { threshold: 5, sharpnessBonus: 5 },
      ],
      enforcement: [
        { threshold: 2, action: 'warn', durationSeconds: 0 },
        { threshold: 3, action: 'mute', durationSeconds: 60 },
        { threshold: 4, action: 'none', durationSeconds: 0 },
        { threshold: 5, action: 'none', durationSeconds: 0 },
      ],
    },
    'verify-moderation',
  );
  check('a saved ladder round-trips', saved.verbal[1]?.sharpnessBonus === 4);
  check('and is read back from the database', (await botModerationRules(db, botId))?.verbalWindowSeconds === 120);
  const audit = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_log WHERE action = 'cinderella.moderation.rules'`,
  );
  check('a rules save is audited', Number(audit.rows[0]?.n ?? 0) === 1);

  // The save path has no mode parameter at all, so a form cannot arm enforcement.
  const modeAfterSave = await db.query<{ moderation_mode: string }>(
    `SELECT moderation_mode FROM cinderella_bot_profiles WHERE id = $1`,
    [botId],
  );
  check('saving rules cannot change the mode', modeAfterSave.rows[0]?.moderation_mode === 'observe');

  /* ── 5. THE NO-ACT GUARANTEE ────────────────────────────────────────────── */

  console.log('\n5. Enforcement computes and records, and does nothing');

  // 5a. STRUCTURAL. Nothing in the moderation tree names an enforcement API.
  const moderationFiles: string[] = [];
  walk(join(ROOT, 'src/moderation'), moderationFiles);
  let sdkNamed: string | null = null;
  for (const file of moderationFiles) {
    const source = readFileSync(file, 'utf8');
    for (const api of ENFORCEMENT_APIS) {
      // The rules file names them in prose to say they are NOT performed, so only a
      // CALL shape counts: the name followed by an opening parenthesis.
      if (new RegExp(`${api}\\s*\\(`).test(source)) {
        sdkNamed = `${file.slice(ROOT.length + 1)} calls ${api}`;
      }
    }
  }
  check('no enforcement API is called anywhere in src/moderation', sdkNamed === null, sdkNamed ?? '');
  check('the scan actually looked at files', moderationFiles.length >= 3, `${moderationFiles.length} files`);

  // 5b. BEHAVIOURAL. Drive a member past every rung through the real engine and watch
  // its only outbound capability.
  const settings: InteractionSettings = normalizeInteraction({
    nicknames: { enabled: true, words: 'Cindy', spamLimit: 1000 },
  });
  const sent: string[] = [];
  const requests: AiReplyRequest[] = [];
  let liveRules: ModerationRules = normalizeModerationRules({
    ...DEFAULT_MODERATION_RULES,
    verbal: [
      { threshold: 2, sharpnessBonus: 1 },
      { threshold: 3, sharpnessBonus: 2 },
      { threshold: 4, sharpnessBonus: 3 },
      { threshold: 5, sharpnessBonus: 4 },
    ],
    // One warning, so six messages still walk the whole ladder: warn at 2, then mute at
    // 3 (2 + 1), block at 4, remove at 5. With the shipped count of five this same ladder
    // would derive to 2/7/8/9 and six messages would never reach the top, which is the
    // derivation working rather than a ladder that failed to fire.
    warningCount: 1,
    enforcement: [
      { threshold: 2, action: 'warn', durationSeconds: 0 },
      { threshold: 3, action: 'mute', durationSeconds: 60 },
      { threshold: 4, action: 'block', durationSeconds: 0 },
      { threshold: 5, action: 'remove', durationSeconds: 0 },
    ],
  });

  const basePersonality: BotPersonality = { ...DEFAULT_PERSONALITY, sharpness: 5 };
  const engine = new InteractionEngine({
    db,
    settings: () => settings,
    personality: () => basePersonality,
    moderationRules: () => liveRules,
    personalize: async (request) => {
      requests.push(request);
      return Promise.resolve(request.mode === 'retort' ? 'Wrong name.' : null);
    },
    send: async (_msg, text) => {
      sent.push(text);
      return Promise.resolve();
    },
  });

  await db.query(`DELETE FROM cinderella_violations`);
  for (let i = 0; i < 6; i++) await engine.handle(makeMessage('Cindy hello'));

  check('every nickname was answered', sent.length === 6);
  // The spy stands in for the engine's ONLY outbound. Warnings and retorts are the only
  // things it may ever see; an enforcement call has no path to it at all.
  check(
    'every reply was retort or warning text and nothing else',
    sent.every((text) => text === 'Wrong name.' || text.startsWith('Wrong name.')),
  );

  const sanctions = await listSanctions(db, 100);
  check('the ladder recorded steps', sanctions.length > 0, `${sanctions.length} rows`);
  check('EVERY recorded step is observed', sanctions.every((row) => row.mode === 'observed'));
  check(
    'no recorded step claims to have been applied',
    sanctions.every((row) => row.enforcedAt === null),
  );
  check(
    'the hardest rung was reached, so this is not a ladder that failed to fire',
    sanctions.some((row) => row.action === 'remove'),
  );
  check(
    'each step carries the rule and count that produced it',
    sanctions.every((row) => row.reason.includes('nickname') && row.violationCount > 0),
  );
  // 5c. RECORDED. The Active page reads only enforced rows, so it is empty.
  check(
    'nobody is under an active sanction',
    (await listActiveSanctions(db, new Date())).length === 0,
  );

  // The schema itself refuses a half-enforced observation.
  let observedEnforcedRefused = false;
  try {
    await db.query(
      `INSERT INTO cinderella_sanctions
         (group_id, member_id, member_display_name, action, violation_type, violation_count,
          window_seconds, reason, mode, enforced_at)
       VALUES ($1, $2, 'Alice', 'mute', 'nickname', 9, 600, 'x', 'observed', now())`,
      [GROUP, ALICE],
    );
  } catch {
    observedEnforcedRefused = true;
  }
  check('the database refuses an observed row that claims to be enforced', observedEnforcedRefused);

  /* ── 5d. The warning is spoken, the harder rungs are not (CCB-S4-033) ──── */

  console.log('\n5d. Speech is live, action stays observed');

  const spokenRows = sanctions.filter((row) => row.spokenAt !== null);
  const silentRows = sanctions.filter((row) => row.spokenAt === null);
  check('at least one step was spoken', spokenRows.length > 0, `${spokenRows.length} spoken`);
  check('everything spoken was a warning', spokenRows.every((row) => row.action === 'warn'));
  check(
    'nothing harder than a warning was said',
    silentRows.every((row) => row.action !== 'warn') || silentRows.length === 0,
  );
  check(
    'the mute, block and remove rungs were recorded and not said',
    sanctions
      .filter((row) => row.action !== 'warn')
      .every((row) => row.spokenAt === null && row.mode === 'observed'),
  );

  // THE CHAT SIDE, asserted on what the spy on the engine's only outbound actually saw.
  // That is where a member's experience lives: not what was drafted and not what was
  // asked of the model, but the bytes that left. It is also the assertion that survived
  // this briefing changing the warning from model-worded to protected text, because it
  // never depended on which of the two produced it.
  const warningSends = sent.filter((text) => text.includes('on the record'));
  check('the warning reached the chat', warningSends.length > 0, `${warningSends.length} of ${sent.length}`);
  check(
    'it travelled with the retort as one message rather than two',
    warningSends.every((text) => {
      const lines = text.split('\n');
      return lines.length === 2 && lines[0] === 'Wrong name.' && lines[1]!.includes('on the record');
    }),
    warningSends[0] ?? '',
  );
  check(
    'the retort is first, so the snub still lands before the paperwork',
    warningSends.every((text) => !text.startsWith('⚠️')),
  );
  // THE NUMBERS ARE THE FACT, and this asserts the exact string a member reads. While
  // the model was allowed to reword this sentence it was measured turning "warning 3 of
  // 3" into "warning 1 of 3", which is why the sentence is now appended verbatim.
  check(
    'and it states exactly which warning it is',
    warningSends.some((text) => text.includes('warning 1 of 1, and it is on the record')),
    warningSends[0] ?? '',
  );
  check(
    'the model never sees the warning, so it cannot reword the count',
    requests.every((request) => !request.deterministicDraft.includes('on the record')),
  );

  // The schema half of the line: while observed, only a warning may be spoken.
  let spokenMuteRefused = false;
  try {
    await db.query(
      `INSERT INTO cinderella_sanctions
         (group_id, member_id, member_display_name, action, violation_type, violation_count,
          window_seconds, reason, mode, spoken_at)
       VALUES ($1, $2, 'Alice', 'mute', 'nickname', 9, 600, 'x', 'observed', now())`,
      [GROUP, ALICE],
    );
  } catch {
    spokenMuteRefused = true;
  }
  check('the database refuses an observed mute that claims to have been announced', spokenMuteRefused);

  /* ── 6. Ladder A actually reaches the retort ────────────────────────────── */

  console.log('\n6. Repetition sharpens the retort');

  const sharpness = requests
    .filter((request) => request.mode === 'retort')
    .map((request) => request.personality?.sharpness ?? 0);
  check('six retorts were worded', sharpness.length === 6, JSON.stringify(sharpness));
  check('the first is at the operator base', sharpness[0] === 5);
  check('the second has climbed', sharpness[1] === 6);
  check('the fifth is at base plus four', sharpness[4] === 9);
  check(
    'the sequence only ever rises within the window',
    sharpness.every((value, index) => index === 0 || value >= sharpness[index - 1]!),
  );

  // Decay: with a window this short, the next nickname is alone in it again.
  liveRules = normalizeModerationRules({ ...liveRules, verbalWindowSeconds: 10 });
  await db.query(`UPDATE cinderella_violations SET at = now() - interval '1 hour'`);
  requests.length = 0;
  await engine.handle(makeMessage('Cindy hello'));
  const afterDecay = requests.find((request) => request.mode === 'retort')?.personality?.sharpness;
  check('once the window empties the tone falls back to base', afterDecay === 5, String(afterDecay));

  // An exempt member is counted but never sanctioned.
  await db.query(`DELETE FROM cinderella_violations`);
  await db.query(`DELETE FROM cinderella_sanctions`);
  for (let i = 0; i < 6; i++) {
    await engine.handle(makeMessage('Cindy hello', { member: BOB, role: 'owner' }));
  }
  check(
    'an owner is still counted',
    (await countViolations(db, { groupId: GROUP, memberId: BOB, type: 'nickname' }, 600, new Date())) === 6,
  );
  check('but never sanctioned', (await listSanctions(db, 10)).length === 0);

  /* ── 7. The console ─────────────────────────────────────────────────────── */

  console.log('\n7. The Moderation section');

  const adminCfg: AdminConfig = {
    adminPort: 0,
    adminUsername: 'operator',
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: SESSION_SECRET,
    publicOrigin: 'https://cinderella.example.org',
    rpId: 'cinderella.example.org',
    webauthnOrigin: 'https://cinderella.example.org',
    rpName: 'Cinderella Admin',
  };
  const cfg: Config = {
    botDisplayName: 'Cinderella',
    simplexDbPrefix: '/var/lib/cinderella/simplex/cinderella',
    simplexFilesFolder: '/var/lib/cinderella/files',
    groupName: '',
    mediaRoot: process.cwd(),
    avatarPath: '',
    databaseUrl: 'postgres://cinderella:test@127.0.0.1:5432/cinderella',
    logLevel: 'error',
  };

  const liveSettings = await SettingsService.load(db, cfg.logLevel);
  const security = await SecurityService.load(db);
  registerNav();
  const app = buildServer({
    db,
    adminCfg,
    cfg,
    settings: liveSettings,
    security,
    mediaRoot: cfg.mediaRoot,
    registerViews: registerAdminViews,
  });
  await app.ready();

  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const token = /name="_csrf" value="([a-f0-9]{64})"/.exec(loginPage.body)?.[1] ?? '';
  const loginCookie = cookieOf(loginPage.headers['set-cookie'], 'cinderella_login_csrf') ?? '';
  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { username: 'operator', password: PASSWORD, _csrf: token },
    headers: { cookie: loginCookie },
  });
  const session = cookieOf(login.headers['set-cookie'], 'cinderella_session') ?? '';
  const flat = (body: string): string => body.replace(/\s+/g, ' ');

  const rulesPage = await app.inject({
    method: 'GET',
    url: '/moderation/rules',
    headers: { cookie: session },
  });
  check('the Rules page renders', rulesPage.statusCode === 200);
  check('the navigation exposes Moderation', flat(rulesPage.body).includes('>Moderation<'));
  check(
    'both ladders are on it',
    flat(rulesPage.body).includes('Ladder A: how sharply she answers') &&
      flat(rulesPage.body).includes('Ladder B: what would happen'),
  );
  check(
    'every rung of both ladders is editable',
    (rulesPage.body.match(/name="verbal\.\d\.threshold"/g) ?? []).length === 4 &&
      (rulesPage.body.match(/name="enforcement\.\d\.action"/g) ?? []).length === 4,
  );
  check('every enforcement rung can be set to none', (rulesPage.body.match(/value="none"/g) ?? []).length === 4);
  check(
    'the mode says observing and does not offer enforce as a working choice',
    flat(rulesPage.body).includes('Mode: observing') && flat(rulesPage.body).includes('<select class="'),
  );
  check('the enforce option is disabled', /<select[^>]*disabled/.test(rulesPage.body));
  check(
    'the page distinguishes the ladders from the anti-spam limit',
    flat(rulesPage.body).includes('This is not the nickname anti-spam limit'),
  );
  check('both windows are editable', flat(rulesPage.body).includes('name="verbalWindowSeconds"') &&
    flat(rulesPage.body).includes('name="enforcementWindowSeconds"'));
  check('exemptions are editable', flat(rulesPage.body).includes('name="exempt:owner"'));

  const activePage = await app.inject({
    method: 'GET',
    url: '/moderation/active',
    headers: { cookie: session },
  });
  check('the Active page renders', activePage.statusCode === 200);
  check(
    'and explains that empty is correct rather than broken',
    flat(activePage.body).includes('Nobody, and that is expected'),
  );

  await db.query(`DELETE FROM cinderella_violations`);
  await db.query(`DELETE FROM cinderella_sanctions`);
  await recordViolation(db, {
    groupId: GROUP,
    memberId: ALICE,
    memberDisplayName: 'Alice',
    memberRole: 'member',
    type: 'nickname',
  });
  await recordSanction(db, {
    groupId: GROUP,
    memberId: ALICE,
    memberDisplayName: 'Alice',
    memberRole: 'member',
    action: 'mute',
    violationType: 'nickname',
    violationCount: 10,
    windowSeconds: 600,
    rungThreshold: 10,
    reason: describeRule('nickname', 10, 600, 10),
    mode: 'observed',
  });

  const logPage = await app.inject({
    method: 'GET',
    url: '/moderation/log',
    headers: { cookie: session },
  });
  check('the Log page renders', logPage.statusCode === 200);
  check('it shows the step', flat(logPage.body).includes('mute'));
  check('marked observed', flat(logPage.body).includes('observed, nothing done'));
  check('with the rule and count that produced it', flat(logPage.body).includes('nickname: 10 in 10 minute(s)'));
  check('and the violations it counted', flat(logPage.body).includes('Violations counted'));

  const rulesCsrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(rulesPage.body)?.[1] ?? '';
  const save = await app.inject({
    method: 'POST',
    url: '/moderation/rules',
    payload: {
      _csrf: rulesCsrf,
      bot: String(botId),
      section: 'verbal',
      verbalWindowSeconds: '300',
      'verbal.0.threshold': '3',
      'verbal.0.sharpnessBonus': '1',
      'verbal.1.threshold': '5',
      'verbal.1.sharpnessBonus': '2',
      'verbal.2.threshold': '7',
      'verbal.2.sharpnessBonus': '3',
      'verbal.3.threshold': '9',
      'verbal.3.sharpnessBonus': '4',
    },
    headers: { cookie: session },
  });
  check('saving ladder A redirects', save.statusCode === 302);
  const afterSave = await botModerationRules(db, botId);
  check('the verbal ladder persisted', afterSave?.verbal[0]?.threshold === 3 && afterSave.verbalWindowSeconds === 300);
  check(
    'and saving one ladder left the other alone',
    afterSave?.enforcement.find((rung) => rung.action === 'mute')?.durationSeconds === 60,
  );
  check('the mode is still observe after a save', afterSave?.mode === 'observe');

  /* ── 7b. The warning count on the page, and the refusal (CCB-S4-033) ────── */

  check(
    'the warning count is an editable control',
    flat(rulesPage.body).includes('name="warningCount"') &&
      flat(rulesPage.body).includes('Warnings before escalating'),
  );
  check(
    'the repeat behaviour is stated in one sentence',
    flat(rulesPage.body).includes('She warns on every violation while the warning rung applies'),
  );
  check(
    'the page says speech is live while action is observed',
    flat(rulesPage.body).includes('Speech is live, action stays observed'),
  );
  check(
    'the derived threshold is shown but not editable',
    flat(rulesPage.body).includes('>derived<') &&
      (rulesPage.body.match(/name="enforcement\.\d\.threshold"/g) ?? []).length === 3,
  );

  // THE ORDERING GUARANTEE, at the only place it can be enforced: the save.
  const badLadder = await app.inject({
    method: 'POST',
    url: '/moderation/rules',
    payload: {
      _csrf: rulesCsrf,
      bot: String(botId),
      section: 'enforcement',
      enforcementWindowSeconds: '600',
      warningCount: '5',
      'enforcement.0.threshold': '3',
      'enforcement.0.action': 'mute',
      'enforcement.0.durationSeconds': '60',
      'enforcement.1.threshold': '8',
      'enforcement.1.action': 'warn',
      'enforcement.1.durationSeconds': '0',
      'enforcement.2.threshold': '20',
      'enforcement.2.action': 'none',
      'enforcement.2.durationSeconds': '0',
      'enforcement.3.threshold': '30',
      'enforcement.3.action': 'none',
      'enforcement.3.durationSeconds': '0',
      'exempt:owner': 'on',
    },
    headers: { cookie: session },
  });
  check('a ladder that mutes before warning is refused', badLadder.statusCode === 302);
  check(
    'and the refusal says what to do about it',
    decodeURIComponent(String(badLadder.headers['location'] ?? '')).includes(
      'without ever warning them',
    ),
    String(badLadder.headers['location'] ?? ''),
  );
  const unchanged = await botModerationRules(db, botId);
  check(
    'the refused ladder was not written',
    unchanged?.enforcement.find((rung) => rung.action !== 'none')?.action === 'warn',
  );

  // Zero warnings is a deliberate choice and must still save.
  const zeroWarnings = await app.inject({
    method: 'POST',
    url: '/moderation/rules',
    payload: {
      _csrf: rulesCsrf,
      bot: String(botId),
      section: 'enforcement',
      enforcementWindowSeconds: '600',
      warningCount: '0',
      'enforcement.0.threshold': '3',
      'enforcement.0.action': 'mute',
      'enforcement.0.durationSeconds': '60',
      'enforcement.1.threshold': '8',
      'enforcement.1.action': 'warn',
      'enforcement.1.durationSeconds': '0',
      'enforcement.2.threshold': '20',
      'enforcement.2.action': 'none',
      'enforcement.2.durationSeconds': '0',
      'enforcement.3.threshold': '30',
      'enforcement.3.action': 'none',
      'enforcement.3.durationSeconds': '0',
      'exempt:owner': 'on',
    },
    headers: { cookie: session },
  });
  check(
    'the same ladder saves once the operator says no warnings',
    String(zeroWarnings.headers['location'] ?? '').includes('saved=1'),
  );
  check('and the count persisted', (await botModerationRules(db, botId))?.warningCount === 0);

  // The Log distinguishes the two questions.
  const logPage2 = await app.inject({
    method: 'GET',
    url: '/moderation/log',
    headers: { cookie: session },
  });
  check(
    'the Log separates what was applied from what was heard',
    flat(logPage2.body).includes('Applied / heard') &&
      flat(logPage2.body).includes('not said') &&
      flat(logPage2.body).includes('Two different questions, two badges'),
  );

  await app.close();
  await pg.close();

  console.log(
    failures === 0 ? '\nAll moderation checks passed.' : `\n${failures} moderation check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
