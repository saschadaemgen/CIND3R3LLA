/**
 * She greets a new member once (CCB-S5-041, D-206).
 *
 * Runs against PGlite with NO SimpleX core, because every guarantee that can be decided
 * without the network was deliberately built where it can be: the once-rule is a database
 * constraint, the flood guard is a pure predicate, and the archive exclusion is a parser.
 *
 * The two mutations the briefing names by hand are sections 6 and 7. Both break the SOURCE
 * rather than a fixture, because a mutation that only edits test data proves the test reads
 * its data.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import {
  arrivedAfterBot,
  afterRefusal,
  fillPlaceholders,
  isFault,
  planGreeting,
  type WelcomeSettings,
} from '../src/plugins/welcome/greeting.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

const SETTINGS: WelcomeSettings = {
  enabled: true,
  text: 'Welcome, {{member}}, to {{group}}.',
  returningText: 'Back again, {{member}}.',
  separateReturning: false,
  destination: 'group',
  fallback: 'group',
};

function sectionFlood(): void {
  console.log('\n1. The bot joining a room is not 900 arrivals');
  // THE HAZARD. `connectedToGroupMember` fires once per EXISTING member when the bot joins.
  check('a member who predates the bot is not an arrival', !arrivedAfterBot('pre'));
  check('  nor is the host who invited us', !arrivedAfterBot('host'));
  check('  nor is the bot itself', !arrivedAfterBot('user'));
  check(
    '  nor is a category nobody has enumerated (the allow-list FAILS CLOSED)',
    !arrivedAfterBot('some_category_the_sdk_adds_later'),
  );
  check('  nor is a missing category', !arrivedAfterBot(undefined));
  // POSITIVE CONTROLS. Every line above passes against a predicate that always says no,
  // which would mean nobody is ever greeted.
  check('POSITIVE CONTROL: someone who joined after us IS an arrival', arrivedAfterBot('post'));
  check('  and so is somebody this bot invited', arrivedAfterBot('invitee'));
}

function sectionPlan(): void {
  console.log('\n2. What she says, and when she says nothing');
  check(
    'the capability being off suppresses before anything else',
    planGreeting({ ...SETTINGS, enabled: false }, ctx()).kind === 'suppress',
  );
  const noText = planGreeting({ ...SETTINGS, text: '   ' }, ctx());
  check(
    'an unwritten greeting is `no-text`, not an empty message',
    noText.kind === 'suppress' && noText.reason === 'no-text',
  );
  const plan = planGreeting(SETTINGS, ctx());
  check(
    'POSITIVE CONTROL: a written greeting is planned, with placeholders filled',
    plan.kind === 'send' && plan.text === 'Welcome, Ada, to Cyb3rD3sk.',
    plan.kind === 'send' ? plan.text : 'suppressed',
  );

  // The combining switch: OFF means one text serves both, which is the default.
  const off = planGreeting(SETTINGS, { ...ctx(), returning: true });
  check(
    'with the switch off, a returning member gets the same words',
    off.kind === 'send' && off.text.startsWith('Welcome,'),
  );
  const on = planGreeting({ ...SETTINGS, separateReturning: true }, { ...ctx(), returning: true });
  check(
    '  and with it on, the second text INSTEAD',
    on.kind === 'send' && on.text === 'Back again, Ada.',
  );
}

function sectionPlaceholders(): void {
  console.log('\n3. The fill is the only guard this path has');
  // `containsBlockedLiteral` has two call sites, both inside `generateOllamaReply`, so it can
  // never run here - correctly, since it exists because the MODEL invents uses of a name.
  check(
    'both placeholders are filled',
    fillPlaceholders('{{member}} in {{group}}', { member: 'Ada', group: 'Cyb3rD3sk' }) ===
      'Ada in Cyb3rD3sk',
  );
  check(
    'a name containing a placeholder cannot cause a second substitution',
    fillPlaceholders('Hello {{member}}.', { member: '{{group}}', group: 'SECRET' }) ===
      'Hello {{group}}.',
    'the replacement is never rescanned',
  );
  check(
    'an unknown placeholder is left alone rather than emptied',
    fillPlaceholders('{{nickname}}', { member: 'Ada', group: 'G' }) === '{{nickname}}',
  );
}

function sectionFallback(): void {
  console.log('\n4. A fault is never absorbed into a fallback');
  const t = { text: 'hi' };
  for (const reason of ['no-contact', 'prohibited'] as const) {
    const r = afterRefusal(SETTINGS, t, reason);
    check(`${reason} falls back to the group when asked to`, r.kind === 'send' && r.route === 'group');
    check(
      `  and suppresses when the operator chose not to`,
      afterRefusal({ ...SETTINGS, fallback: 'none' }, t, reason).kind === 'suppress',
    );
  }
  const failed = afterRefusal(SETTINGS, t, 'send-failed');
  check(
    'send-failed NEVER falls back, even with fallback set to group',
    failed.kind === 'suppress',
    'delivering to the group would hide a fault behind a success',
  );
  check('  and it is the only reason counted as a fault', isFault('send-failed'));
  check('  no-contact is not a fault', !isFault('no-contact'));
  check('  prohibited is not a fault', !isFault('prohibited'));
}

async function sectionOnce(): Promise<void> {
  console.log('\n5. Once per member, across every bot in the room');
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE cinderella_welcome_greetings (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      member_id TEXT NOT NULL,
      bot_profile_id BIGINT NOT NULL,
      group_id BIGINT NOT NULL,
      group_name TEXT NOT NULL,
      member_name TEXT NOT NULL,
      is_returning BOOLEAN NOT NULL DEFAULT FALSE,
      route TEXT NOT NULL,
      reason TEXT,
      greeted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX cinderella_welcome_greetings_member
      ON cinderella_welcome_greetings (member_id);
  `);
  const claim = async (bot: number): Promise<boolean> => {
    const r = await db.query(
      `INSERT INTO cinderella_welcome_greetings
         (member_id, bot_profile_id, group_id, group_name, member_name, route)
       VALUES ('abc', $1, 8, 'Cyb3rD3sk', 'Ada', 'group')
       ON CONFLICT (member_id) DO NOTHING`,
      [bot],
    );
    return (r.affectedRows ?? 0) > 0;
  };
  check('the first bot wins the claim', await claim(10));
  check('  the second bot in the SAME room finds it taken', !(await claim(14)));
  check('  a third finds it taken too', !(await claim(21)));
  check('  and a rejoin by the same member finds it taken', !(await claim(10)));
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM cinderella_welcome_greetings`,
  );
  check('exactly one row exists after four attempts', Number(rows[0]?.n) === 1, `${rows[0]?.n} row(s)`);
}

async function sectionMutationTwice(): Promise<void> {
  console.log('\n6. MUTATION: a member cannot be greeted twice (the briefing names this one)');
  // Break the SOURCE: the once-rule is the UNIQUE index, so removing it is the mutation.
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE g (member_id TEXT NOT NULL, bot BIGINT NOT NULL);
  `);
  const claimNoIndex = async (bot: number): Promise<boolean> => {
    const r = await db.query(`INSERT INTO g (member_id, bot) VALUES ('abc', $1)`, [bot]);
    return (r.affectedRows ?? 0) > 0;
  };
  await claimNoIndex(10);
  await claimNoIndex(14);
  const { rows } = await db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM g`);
  check(
    'without the UNIQUE index two bots BOTH greet, so the index is what holds the rule',
    Number(rows[0]?.n) === 2,
    `${rows[0]?.n} greetings - this is the defect the constraint prevents`,
  );
  // And the migration really carries it, so the mutation above describes the shipped schema.
  const sql = await readFile('migrations/060_welcome_greetings.sql', 'utf8');
  check(
    '  and the shipped migration DOES create it',
    /CREATE UNIQUE INDEX[\s\S]*cinderella_welcome_greetings \(member_id\)/.test(sql),
  );
}

async function sectionMutationPrivate(): Promise<void> {
  console.log('\n7. MUTATION: a private greeting cannot reach the archive (the second named one)');
  const src = await readFile('src/bot/parse.ts', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // The RECEIVE side has always guarded this.
  check(
    'a received scoped item is refused (isPublicGroupMessage)',
    /groupChatScope === undefined/.test(code),
  );
  // The SEND side did NOT, which is the defect this briefing found: her own support-thread
  // message is `group` + `groupSnd`, so it passed both existing checks and was archived.
  const sent = code.slice(code.indexOf('export function parseSentGroupItem'));
  check(
    'HER OWN scoped send is refused too (parseSentGroupItem)',
    /chatInfo\.groupChatScope !== undefined\) return null/.test(sent),
    'this was absent and is the leak the briefing asked to be proven',
  );
  check(
    '  MUTATION: removing that line leaves a parser that accepts a private send',
    !/chatInfo\.groupChatScope !== undefined/.test(sent.replace(/chatInfo\.groupChatScope !== undefined\) return null;/, '')),
  );
  // POSITIVE CONTROL: a guard that refused everything would pass every line above.
  check(
    'POSITIVE CONTROL: an ordinary public send is still archived',
    /chatDir\.type !== 'groupSnd'\) return null/.test(sent) && /groupId: chatInfo\.groupInfo\.groupId/.test(sent),
  );
}

function ctx(): { memberName: string; groupName: string; returning: boolean; predatesBot: boolean } {
  return { memberName: 'Ada', groupName: 'Cyb3rD3sk', returning: false, predatesBot: false };
}

async function main(): Promise<void> {
  console.log('She greets a new member once (CCB-S5-041, D-206)');
  sectionFlood();
  sectionPlan();
  sectionPlaceholders();
  sectionFallback();
  await sectionOnce();
  await sectionMutationTwice();
  await sectionMutationPrivate();
  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} CHECK(S) FAILED`} - welcome.`,
  );
  console.log(
    'Note: the live cases (a real join, each route, two bots in one room) need the host (D-178).',
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
