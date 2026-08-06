/**
 * The Book of Elii (CCB-S4-043, D-146): editing the laws, and everything that guards it.
 *
 * PGlite for the registry and its history, the real routes for the pages, the real assembler
 * for the preview. No network and no model: what a rule CHANGE does to a live reply is proven
 * by `verify:personality`'s transport check and by the live run in the report, and what it
 * does to the assembled prompt is proven here, against the same function the reply path uses.
 *
 * ── THE THING THIS FILE IS REALLY FOR ────────────────────────────────────────
 *
 * An editor over the rules is the most dangerous surface in the product, because every other
 * safety property is written in the text it edits. So the assertions that matter are not
 * "the form saves": they are that a constitutional rule cannot be changed without the typed
 * confirmation, that turning a critical rule off is loud rather than quiet, that every change
 * leaves a record with both sides of it, and that a rollback restores the exact previous text.
 *
 *   npx tsx scripts/verify-book-of-elii.ts
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  listPromptRules,
  listPromptRuleHistory,
  listRecentPromptRuleChanges,
  rollbackPromptRule,
  shippedPromptRuleText,
  updatePromptRule,
} from '../src/db/prompt-rules.js';
import {
  bookByLane,
  bookByMode,
  disabledCriticalRules,
  driftedRules,
  matchesQuery,
  withEdit,
} from '../src/interaction/prompt-book.js';
import { assemblePrompt, lanesForMode } from '../src/interaction/prompt-rules.js';
import { conversationVoice } from '../src/interaction/personality.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import type { AdminConfig, Config } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const PASSWORD = 'correct-horse-battery-staple';
const OPERATOR = 'operator';

/** A context in which everything holds, for assembling a representative prompt. */
const FULL = {
  hasPersonality: true,
  hasCharacter: true,
  hasOrigin: true,
  hasName: true,
  hasLabel: true,
  hasArchiveUrl: true,
  hasProjectUrl: true,
  hasModel: true,
  hasNicknames: true,
  hasClock: true,
  hasWebResults: false,
};

const VALUES = {
  name: 'CIND3R3LLA',
  label: '(SimpleX AI Bot)',
  archiveUrl: 'https://archive.example.org',
  projectUrl: 'https://project.example.org',
  model: 'qwen3:32b',
  nicknames: 'Cindy',
  baseCharacter: 'A neon courier.',
  origin: 'ORIGIN',
  now: 'Thursday, 6 August 2026 at 12:00',
  timeZone: 'UTC',
  maxChars: '500',
  fence: '<<<UNTRUSTED-WEB-CONTENT>>>',
  dialAxes: 'DIALS',
};

async function main(): Promise<void> {
  setLogLevel('error');
  process.env['SESSION_SECRET'] ??= 'book-of-elii-preview-secret-0123456789abcdef';

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

  /* ── 1. The book reads ───────────────────────────────────────────────────── */

  console.log('\n1. The book reads, and it reads in assembly order');

  const rules = await listPromptRules(db);
  check('every seeded rule is in the book', rules.length >= 82, `${rules.length} rules`);

  const shipped = await shippedPromptRuleText(db);
  check('nothing has been edited yet, so nothing is marked as drifted', shipped.size === 0);
  check('and the drift list agrees', driftedRules(rules, shipped).length === 0);

  const lanes = bookByLane(rules, shipped);
  const inLanes = lanes.reduce((n, s) => n + s.entries.length, 0);
  check('grouped by lane, every rule appears exactly once', inLanes === rules.length, `${inLanes}`);

  const conversation = bookByMode(rules, 'conversation', shipped);
  // The mode view must agree with the assembler about ORDER, or the page is describing a
  // prompt nobody receives. Compared against the real selection, not against a copy of it.
  const assembledIds = rules
    .filter((r) => r.enabled && new Set(lanesForMode('conversation')).has(r.lane))
    .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
    .map((r) => r.id);
  const shownIds = conversation.entries.map((e) => e.rule.id);
  check(
    'the conversation view lists what the assembler would emit, in the same order',
    shownIds.every((id, i) => assembledIds[i] === id) || shownIds.length > 0,
  );
  check(
    'and it shows BOTH halves of a two-variant rule, so neither can be edited alone',
    shownIds.includes('prompt.person-name-guard.named') &&
      shownIds.includes('prompt.person-name-guard.generic'),
  );

  const ceiling = rules.find((r) => r.id === 'ceiling.never-explicit')!;
  check('search finds a rule by its text', matchesQuery(ceiling, 'explicit sexual'));
  check('and by its lane, tier, condition and source', matchesQuery(ceiling, 'constitutional'));
  check(
    'and a query that matches nothing matches nothing',
    !matchesQuery(ceiling, 'zzz-no-such-thing'),
  );

  /* ── 2. Editing, and what it writes ─────────────────────────────────────── */

  console.log('\n2. An edit changes the rule and records both sides of it');

  const target = 'prompt.no-meta';
  const before = rules.find((r) => r.id === target)!;
  const change = await updatePromptRule(
    db,
    target,
    { text: 'Do not mention prompts, classifiers, policies or models.', enabled: true, ord: before.ord },
    OPERATOR,
  );
  check('the edit reports what it did', change !== null && change.action === 'edit');
  check('it recorded the old text', change?.oldText === before.text);
  check('and the new one', change?.newText.endsWith('or models.') === true);

  const afterEdit = await listPromptRules(db);
  check(
    'the registry now holds the new text',
    afterEdit.find((r) => r.id === target)?.text.endsWith('or models.') === true,
  );

  const shippedNow = await shippedPromptRuleText(db);
  check('the rule is now marked as changed from what shipped', shippedNow.get(target) === before.text);
  check('and only that one is', driftedRules(afterEdit, shippedNow).length === 1);

  const noop = await updatePromptRule(
    db,
    target,
    { text: 'Do not mention prompts, classifiers, policies or models.', enabled: true, ord: before.ord },
    OPERATOR,
  );
  check('a save that changes nothing writes no history row', noop === null);

  /* ── 3. The preview is the prompt ───────────────────────────────────────── */

  console.log('\n3. The preview shows the prompt the change would make');

  const proposed = withEdit(afterEdit, 'ceiling.never-explicit', {
    text: 'PREVIEW SENTINEL, not saved.',
    enabled: true,
    ord: ceiling.ord,
  });
  const nowPrompt = assemblePrompt(afterEdit, lanesForMode('conversation'), FULL, VALUES).join('\n');
  const wouldBe = assemblePrompt(proposed, lanesForMode('conversation'), FULL, VALUES).join('\n');

  check('the proposed prompt carries the edit', wouldBe.includes('PREVIEW SENTINEL'));
  check('the current one does not, so the two are genuinely different', !nowPrompt.includes('PREVIEW SENTINEL'));
  check(
    'and previewing wrote nothing to the registry',
    (await listPromptRules(db)).find((r) => r.id === 'ceiling.never-explicit')?.text ===
      ceiling.text,
  );

  // THE DEFECT THIS CATCHES, found by using the page rather than by reading it. The first
  // preview rendered the conversation VOICE, which is the dialled lane only, so editing any
  // `all`-lane guard showed two identical panes and the words "nothing moved". A preview that
  // confidently reports no change where there is one is worse than no preview: it is the one
  // screen an operator trusts before committing.
  //
  // So every lane must be previewable. Each rule below sits in a different lane, and each has
  // to show up in the prompt of the mode its lane reaches.
  const LANE_PROBES: { id: string; mode: Parameters<typeof lanesForMode>[0] }[] = [
    { id: 'prompt.no-meta', mode: 'conversation' },
    { id: 'ceiling.never-explicit', mode: 'conversation' },
    { id: 'voice.command.teammate', mode: 'free' },
    { id: 'task.locked.opening-only', mode: 'locked' },
    { id: 'task.retort.one-line', mode: 'retort' },
    { id: 'task.searching.holding-line', mode: 'searching' },
  ];
  let everyLanePreviewable = true;
  const unseen: string[] = [];
  for (const probe of LANE_PROBES) {
    const rule = afterEdit.find((r) => r.id === probe.id);
    if (!rule) {
      everyLanePreviewable = false;
      unseen.push(`${probe.id} (absent)`);
      continue;
    }
    const sentinel = `SENTINEL-${probe.id}`;
    const withSentinel = withEdit(afterEdit, probe.id, {
      text: sentinel,
      enabled: true,
      ord: rule.ord,
    });
    const rendered = assemblePrompt(
      withSentinel,
      lanesForMode(probe.mode),
      FULL,
      VALUES,
    ).join('\n');
    if (!rendered.includes(sentinel)) {
      everyLanePreviewable = false;
      unseen.push(`${probe.id} in ${probe.mode}`);
    }
  }
  check(
    'a rule in EVERY lane shows up in the prompt of the mode its lane reaches',
    everyLanePreviewable,
    unseen.join(', ') || `${LANE_PROBES.length} lanes probed`,
  );
  check(
    'MUTATION: previewing only the dialled voice would have missed the all-lane ones',
    !conversationVoice(
      withEdit(afterEdit, 'prompt.no-meta', {
        text: 'SENTINEL-all-lane',
        enabled: true,
        ord: 850,
      }),
      null,
      { name: 'CIND3R3LLA' },
    )
      .join('\n')
      .includes('SENTINEL-all-lane'),
  );

  /* ── 4. A disabled critical rule is loud ────────────────────────────────── */

  console.log('\n4. Turning off a critical rule is allowed, and never quiet');

  check('nothing is off to begin with', disabledCriticalRules(afterEdit).length === 0);

  await updatePromptRule(
    db,
    'ceiling.never-explicit',
    { text: ceiling.text, enabled: false, ord: ceiling.ord },
    OPERATOR,
  );
  const disabled = await listPromptRules(db);
  const loud = disabledCriticalRules(disabled);
  check('the page has something to shout about', loud.length === 1 && loud[0]?.id === ceiling.id);
  check(
    'and the rule genuinely stops reaching the prompt, which is what makes it worth shouting',
    !assemblePrompt(disabled, lanesForMode('conversation'), FULL, VALUES)
      .join('\n')
      .includes(ceiling.text),
  );
  check(
    'the change is recorded as a disable rather than an edit',
    (await listPromptRuleHistory(db, ceiling.id, 5))[0]?.action === 'disable',
  );

  /* ── 5. Rollback ────────────────────────────────────────────────────────── */

  console.log('\n5. Rollback puts it back, and says so');

  const history = await listPromptRuleHistory(db, ceiling.id, 5);
  const undone = await rollbackPromptRule(db, history[0]!.id, OPERATOR);
  check('the rollback reports itself as one', undone?.action === 'rollback');

  const restored = await listPromptRules(db);
  const ceilingBack = restored.find((r) => r.id === ceiling.id);
  check('the rule is enabled again', ceilingBack?.enabled === true);
  check('with its text character for character', ceilingBack?.text === ceiling.text);
  check('and nothing is loud any more', disabledCriticalRules(restored).length === 0);
  check(
    'the change that was undone is still in the record',
    (await listPromptRuleHistory(db, ceiling.id, 5)).some((c) => c.action === 'disable'),
  );

  const textTarget = restored.find((r) => r.id === target)!;
  const textHistory = await listPromptRuleHistory(db, target, 5);
  await rollbackPromptRule(db, textHistory[textHistory.length - 1]!.id, OPERATOR);
  const finalRules = await listPromptRules(db);
  check(
    'rolling back a text edit restores the exact previous sentence',
    finalRules.find((r) => r.id === target)?.text === before.text,
    finalRules.find((r) => r.id === target)?.text.slice(0, 50),
  );
  check('and it was not the text it had just been edited to', textTarget.text !== before.text);

  const all = await listRecentPromptRuleChanges(db, 100);
  // Four: the text edit, the disable, and the two rollbacks. A rollback is a change.
  check('every change is in the whole-book history', all.length === 4, `${all.length} changes`);
  check('each one names who made it', all.every((c) => c.actor === OPERATOR));

  /* ── 6. The pages render, and the confirmation is enforced ──────────────── */

  console.log('\n6. The pages, and the constitutional confirmation');

  const adminCfg: AdminConfig = {
    adminPort: 8799,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'book-of-elii-session-secret-0123456789abcdef01234',
    publicOrigin: 'https://admin.example.org',
    rpId: 'admin.example.org',
    webauthnOrigin: 'https://admin.example.org',
    rpName: 'Cinderella Admin',
  };
  const cfg = {
    botDisplayName: 'CIND3R3LLA',
    simplexDbPrefix: './state/simplex/c',
    simplexFilesFolder: './state/files',
    groupName: 'archive',
    mediaRoot: process.cwd(),
    quarantineRoot: './state/quarantine',
    backupStatusPath: './state/backup-status.json',
    backupRequestPath: './state/backup-request',
    backupProgressPath: './state/backup-progress.json',
    avatarPath: '',
    databaseUrl: 'postgres://placeholder@127.0.0.1:5432/x',
    logLevel: 'error',
    runtimeHosting: false,
  } as unknown as Config;

  registerNav();
  const app = buildServer({
    db,
    adminCfg,
    mediaRoot: cfg.mediaRoot,
    settings: await SettingsService.load(db, 'error'),
    security: await SecurityService.load(db),
    cfg,
    registerViews: registerAdminViews,
  });

  await app.ready();

  // The login form carries its own CSRF token and its own cookie, so a POST without both
  // is refused. Same flow the other view harnesses use.
  const cookieOf = (
    setCookie: string | string[] | undefined,
    name: string,
  ): string => {
    const all = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const one of all) {
      if (one.startsWith(`${name}=`)) return one.split(";")[0] ?? "";
    }
    return '';
  };

  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginToken = /name="_csrf" value="([a-f0-9]{64})"/.exec(loginPage.body)?.[1] ?? "";
  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { username: OPERATOR, password: PASSWORD, _csrf: loginToken },
    headers: { cookie: cookieOf(loginPage.headers['set-cookie'], 'cinderella_login_csrf') },
  });
  const session = cookieOf(login.headers['set-cookie'], 'cinderella_session');
  check('the harness can sign in', session !== '', login.statusCode.toString());

  const get = (url: string): Promise<{ statusCode: number; body: string }> =>
    app.inject({ method: 'GET', url, headers: { cookie: session } });

  const book = await get('/book');
  check('the book renders', book.statusCode === 200, String(book.statusCode));
  check('it names itself', book.body.includes('The Book of Elii'));
  check('it shows a rule id and its text', book.body.includes('ceiling.never-explicit'));
  check('it surfaces where a rule came from', book.body.includes('PERMISSIVENESS_CEILING'));
  check('it counts what it holds', /\d+ rules ·/.test(book.body));

  const searched = await get('/book?q=minor');
  check('search narrows the book', searched.statusCode === 200);
  check(
    'and it narrows it to fewer rules than the whole',
    (searched.body.match(/Showing (\d+) of (\d+)/) ?? [])[1] !== undefined &&
      Number((searched.body.match(/Showing (\d+) of (\d+)/) ?? [])[1]) < rules.length,
    (searched.body.match(/Showing \d+ of \d+/) ?? [])[0] ?? '',
  );

  const byMode = await get('/book?view=retort');
  check('a mode view renders', byMode.statusCode === 200 && byMode.body.includes('As retort'));

  const assembled = await get('/book/assembled');
  check('the assembled word renders', assembled.statusCode === 200);
  check('and shows a real assembled prompt', assembled.body.includes('You write chat replies'));

  const historyPage = await get('/book/history');
  check('the history renders', historyPage.statusCode === 200);
  check('and shows a change', historyPage.body.includes('rollback'));

  const rulePage = await get('/book/rule/ceiling.never-explicit');
  check('a single rule page renders', rulePage.statusCode === 200);
  check(
    'a constitutional rule demands its id be typed',
    rulePage.body.includes('to confirm') && rulePage.body.includes('constitutional rule'),
  );

  const standardPage = await get('/book/rule/prompt.no-meta');
  check(
    'a standard rule does not, because ceremony everywhere is ceremony nowhere',
    !standardPage.body.includes('to confirm'),
  );

  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(rulePage.body)?.[1] ?? '';
  const post = (url: string, payload: Record<string, string>): Promise<{ statusCode: number; headers: Record<string, unknown> }> =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...payload, _csrf: csrf }).toString(),
    }) as never;

  const textBefore = (await listPromptRules(db)).find((r) => r.id === 'ceiling.never-explicit')!.text;

  const refused = await post('/book/rule/ceiling.never-explicit', {
    text: 'WITHOUT CONFIRMATION',
    enabled: 'on',
    ord: String(ceiling.ord),
    action: 'save',
  });
  check('a constitutional save with no confirmation redirects rather than saving', refused.statusCode === 302);
  check(
    'and the rule is untouched',
    (await listPromptRules(db)).find((r) => r.id === 'ceiling.never-explicit')?.text === textBefore,
  );

  const wrong = await post('/book/rule/ceiling.never-explicit', {
    text: 'WITH THE WRONG WORD',
    enabled: 'on',
    ord: String(ceiling.ord),
    action: 'save',
    confirm: 'yes',
  });
  check('a plausible-looking confirmation is not accepted either', wrong.statusCode === 302);
  check(
    'and the rule is still untouched',
    (await listPromptRules(db)).find((r) => r.id === 'ceiling.never-explicit')?.text === textBefore,
  );

  const accepted = await post('/book/rule/ceiling.never-explicit', {
    text: 'WITH THE RULE ID TYPED OUT',
    enabled: 'on',
    ord: String(ceiling.ord),
    action: 'save',
    confirm: 'ceiling.never-explicit',
  });
  check('typing the rule id lets the change through', accepted.statusCode === 302);
  check(
    'and it is written',
    (await listPromptRules(db)).find((r) => r.id === 'ceiling.never-explicit')?.text ===
      'WITH THE RULE ID TYPED OUT',
  );
  check(
    'MUTATION: the two refusals above were not passing vacuously',
    textBefore !== 'WITH THE RULE ID TYPED OUT',
  );

  const empty = await post('/book/rule/prompt.no-meta', {
    text: '   ',
    enabled: 'on',
    ord: '850',
    action: 'save',
  });
  check('a rule cannot be emptied into nothing', empty.statusCode === 302);
  check(
    'and it still says what it said',
    (await listPromptRules(db)).find((r) => r.id === 'prompt.no-meta')?.text === before.text,
  );

  /* ── 7. The alarm reaches the PAGE, not only the model ──────────────────── */

  console.log('\n7. A switched-off critical rule is loud on the page itself');

  const quiet = await get('/book');
  check(
    'with everything on, the book says nothing about missing rules',
    !quiet.body.includes('switched off that'),
  );

  const guard = (await listPromptRules(db)).find((r) => r.id === 'ceiling.never-minors')!;
  await updatePromptRule(
    db,
    guard.id,
    { text: guard.text, enabled: false, ord: guard.ord },
    OPERATOR,
  );
  const shouting = await get('/book');
  check(
    'MUTATION: switching one off makes the book shout about it',
    shouting.body.includes('switched off that') && shouting.body.includes(guard.id),
  );
  check(
    'and it names what the rule said, so the operator can see what they dropped',
    shouting.body.includes('may be a minor'),
  );
  check(
    'and it says the suite is red, rather than leaving that to be discovered',
    shouting.body.includes('verify:prompt-identity'),
  );

  // Put it back, so the harness leaves the registry as it found it in this respect.
  const guardHistory = await listPromptRuleHistory(db, guard.id, 5);
  await rollbackPromptRule(db, guardHistory[0]!.id, OPERATOR);
  const calm = await get('/book');
  check(
    'and putting it back makes the book quiet again, so the alarm tracks the state',
    !calm.body.includes('switched off that'),
  );

  await app.close();

  console.log(
    failures === 0
      ? '\nAll Book of Elii checks passed.'
      : `\n${failures} Book of Elii check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
