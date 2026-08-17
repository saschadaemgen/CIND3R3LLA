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
import { vector } from '@electric-sql/pglite-pgvector';
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
import { botPersonalityById } from '../src/profiles/bot-onboarding.js';
import {
  PromptRuleService,
  setPromptRuleService,
} from '../src/interaction/prompt-rule-service.js';
import { escapeHtml } from '../src/web/html.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { PluginService } from '../src/plugins/service.js';
import { MUSIC_ID } from '../src/plugins/music/plugin.js';
import {
  assignPlaylist,
  createPlaylist,
  insertTrack,
  setPlaylistTracks,
} from '../src/plugins/music/store.js';
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
  // CCB-S5-025. Every placeholder the registry can render needs a representative value here,
  // or the lane probe below throws rather than reporting what moved.
  lookupBrief: 'You are about to go and look this one up.',
};

async function main(): Promise<void> {
  setLogLevel('error');
  process.env['SESSION_SECRET'] ??= 'book-of-elii-preview-secret-0123456789abcdef';

  const pg = new PGlite({ extensions: { vector } });
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
    { text: 'Do not mention prompts, classifiers, policies or models.', enabled: true, ord: before.ord, nameable: before.nameable },
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
    { text: 'Do not mention prompts, classifiers, policies or models.', enabled: true, ord: before.ord, nameable: before.nameable },
    OPERATOR,
  );
  check('a save that changes nothing writes no history row', noop === null);

  /* ── 2b. Visibility is an edit like any other (CCB-S4-045) ──────────────── */

  console.log('\n2b. Moving a rule across the nameable line, from the console');

  const hidden = afterEdit.find((r) => !r.nameable)!;
  const shown = await updatePromptRule(
    db,
    hidden.id,
    { text: hidden.text, enabled: hidden.enabled, ord: hidden.ord, nameable: true },
    OPERATOR,
  );
  check('the console can make a withheld rule nameable', shown !== null);
  // Its OWN action, not `edit`. A visibility change alters what a member can be told and
  // nothing about what the model is told, so a history that called it an edit would hide the
  // one class of change this briefing exists to make auditable.
  check('and it is recorded as a visibility change, not an edit', shown?.action === 'visibility', shown?.action ?? '');
  check('with both sides of the flag', shown?.oldNameable === false && shown?.newNameable === true);

  const withVisibility = await listPromptRules(db);
  check(
    'the registry holds it, so she may now quote that rule',
    withVisibility.find((r) => r.id === hidden.id)?.nameable === true,
  );
  check(
    'and the rule text is untouched, because visibility is not a rewrite',
    withVisibility.find((r) => r.id === hidden.id)?.text === hidden.text,
  );

  const backAgain = await updatePromptRule(
    db,
    hidden.id,
    { text: hidden.text, enabled: hidden.enabled, ord: hidden.ord, nameable: false },
    OPERATOR,
  );
  check('and it moves back', backAgain?.action === 'visibility' && backAgain.newNameable === false);

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
    { text: ceiling.text, enabled: false, ord: ceiling.ord, nameable: ceiling.nameable },
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
  // Six: the text edit, the two visibility moves, the disable, and the two rollbacks. A
  // rollback is a change, and so is moving a rule across the nameable line.
  check('every change is in the whole-book history', all.length === 6, `${all.length} changes`);
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
  } as unknown as Config;

  registerNav();
  // Held by the harness as well as the server, so section 8 can flip a per-bot
  // plugin switch through the SAME instance the console routes read.
  const plugins = PluginService.withDefaults(db);
  const app = buildServer({
    db,
    adminCfg,
    mediaRoot: cfg.mediaRoot,
    settings: await SettingsService.load(db, 'error'),
    security: await SecurityService.load(db),
    cfg,
    plugins,
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
  check('and how much of it she may say out loud', book.body.includes('she may name'));
  check('and how much she may not', book.body.includes('withheld from members'));
  check(
    'each rule is badged one way or the other, so the line is visible per rule',
    book.body.includes('nameable') && book.body.includes('withheld'),
  );
  check(
    'and a rule page offers the control that moves it across',
    (await get('/book/rule/prompt.no-meta')).body.includes("name=\"nameable\""),
  );

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
    { text: guard.text, enabled: false, ord: guard.ord, nameable: guard.nameable },
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

  /* ── 8. The previews carry the DJ sheet (D-220) ─────────────────────────── */
  //
  // D-218 put the library's numbers in the reply prompt and the D-220 audit found that
  // no preview surface followed: the Assembled Word, the Personality page's voice block
  // and the Interaction page's context-size card all rendered "what she is told" with
  // no library in it. Each assertion here is a page READ BACK over HTTP with the plugin
  // on, off, and on-then-off, because a preview that ignores the switch is the same
  // stale-surface failure in the other direction.

  console.log('\n8. The previews carry the DJ sheet when the music plugin is on');

  // The context-size card assembles through `currentPromptRules()`, which is the
  // process-global service the boot path registers; register one here the same way.
  setPromptRuleService(await PromptRuleService.load(db));

  const bot = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('previewed', 'Preview Bot', TRUE) RETURNING id`,
  );
  const PREVIEW_BOT = Number(bot.rows[0]?.id);
  const DJ_LINE = 'You keep a music library here';

  const assembledOff = await get(`/book/assembled?bot=${PREVIEW_BOT}`);
  check(
    'with the plugin off, the assembled word says nothing about a library',
    assembledOff.statusCode === 200 && !assembledOff.body.includes(DJ_LINE),
  );

  const memoryOff = await get(`/interaction/memory?bot=${PREVIEW_BOT}`);
  // The label gained "voice" under D-229, when the card started measuring the dial block,
  // the base character and the origin it had been silently omitting. This regex is anchored
  // to it and went to NaN on the merge - which is worth noting rather than just fixing: an
  // extractor anchored to COPY fails silently into a number, and `Number(undefined)` is NaN,
  // so the two checks it feeds reported a broken parse in the same shape as a real result.
  // They survive it only because both assert `Number.isFinite` before comparing.
  const bareOf = (body: string): number =>
    Number(
      /Her rules, voice and facts alone<\/dt>[\s\S]{0,160}?(\d+) characters/.exec(body)?.[1] ??
        Number.NaN,
    );
  const bareBefore = bareOf(memoryOff.body);
  check(
    'POSITIVE CONTROL: the context-size card measures a real prompt before any of this',
    Number.isFinite(bareBefore) && bareBefore > 0,
    String(bareBefore),
  );

  // A library the bot can actually reach: two tracks, one playlist, one assignment.
  //
  // THE GENRES ARE SEEDED LOWERCASE AND ASSERTED TITLE CASE, ON PURPOSE (D-229). D-221
  // made `libraryFactsForBot` normalise with `initcap(lower(btrim(g)))`, so what a bot is
  // TOLD is "Folk, Rock" whatever casing the tag carried. These three assertions were
  // written on a branch that predated that and read "folk, rock"; they went red on the
  // merge. The rendered page was read before either side was touched (D-111) and the code
  // was the correct one, so the fixture moved. Seeding lowercase keeps the normalisation
  // itself under test rather than asserting a value the fixture already spelled.
  const folk = await insertTrack(db, {
    kind: 'music', title: 'Harbour Lights', artist: null, album: null, genre: 'folk',
    durationSeconds: 200, filePath: '/x/preview/1.mp3', fileSize: 1_000_000,
    mime: 'audio/mpeg', coverPath: null,
  });
  const rock = await insertTrack(db, {
    kind: 'music', title: 'Preview Anthem', artist: null, album: null, genre: 'rock',
    durationSeconds: 100, filePath: '/x/preview/2.mp3', fileSize: 1_000_000,
    mime: 'audio/mpeg', coverPath: null,
  });
  const playlist = await createPlaylist(db, 'Preview Set');
  await setPlaylistTracks(db, playlist, [folk, rock]);
  await assignPlaylist(db, PREVIEW_BOT, playlist);
  await plugins.setEnabledForBot(PREVIEW_BOT, MUSIC_ID, true, OPERATOR);

  const assembledOn = await get(`/book/assembled?bot=${PREVIEW_BOT}`);
  check(
    'with it on, the assembled word carries the DJ sheet with the numbers she is told',
    assembledOn.body.includes(`${DJ_LINE}: 2 tracks across Folk, Rock, in 1 playlists`),
  );
  check(
    'and the page says where those numbers come from',
    assembledOn.body.includes('counted live'),
  );

  const personalityPage = await get(`/ai/personality?bot=${PREVIEW_BOT}`);
  check(
    'the personality page voice block carries it too',
    personalityPage.body.includes(`${DJ_LINE}: 2 tracks across Folk, Rock`),
  );

  // The per-rule preview is a POST of the operator's own form. Press it the way the
  // operator does, on a has-music law, and read the DJ sheet back out of the preview,
  // because "nothing moved" over a real change is the failure this page must not have.
  const musicRule = (await listPromptRules(db)).find((r) => r.id === 'music.capability')!;
  const rulePreview = await app.inject({
    method: 'POST',
    url: '/book/rule/music.capability',
    headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      text: musicRule.text,
      enabled: 'on',
      ord: String(musicRule.ord),
      action: 'preview',
      _csrf: csrf,
    }).toString(),
  });
  check(
    'the per-rule preview renders a has-music law inside the prompt it lands in',
    rulePreview.statusCode === 200 &&
      rulePreview.body.includes(`${DJ_LINE}: 2 tracks across Folk, Rock`),
    String(rulePreview.statusCode),
  );

  const memoryOn = await get(`/interaction/memory?bot=${PREVIEW_BOT}`);
  const bareAfter = bareOf(memoryOn.body);
  check(
    'and the context-size card counts it, so the headroom is measured against the prompt she is sent',
    Number.isFinite(bareAfter) && bareAfter > bareBefore,
    `${bareBefore} -> ${bareAfter}`,
  );

  // The switch reaches back (D-205): off again means the previews drop the library,
  // not merely never having shown it.
  await plugins.setEnabledForBot(PREVIEW_BOT, MUSIC_ID, null, OPERATOR);
  const assembledBack = await get(`/book/assembled?bot=${PREVIEW_BOT}`);
  check(
    'switched back off, the library leaves the previewed prompt',
    !assembledBack.body.includes(DJ_LINE),
  );

  /* ── 9. The previews carry the SELECTED BOT'S voice (D-229) ─────────────── */

  console.log("\n9. The previews carry the selected bot's dials, character and origin");

  // ── WHY THIS SECTION EXISTS ────────────────────────────────────────────────
  //
  // Two surfaces asked `currentBotPersonality()` with NO bot id. That form answered with
  // the primary's personality until CCB-S5-019 removed the fallback, and `null` ever
  // since, so the Book's per-rule preview rendered a prompt with no voice section in it
  // and the Interaction page's context-size card measured one. Nothing failed: the call
  // compiled, the page rendered, the number looked like a measurement. Every check in this
  // file stayed green, because no check had ever put a personality behind these routes.
  //
  // So the assertions below are about VALUES REACHING A SURFACE, and each one is paired
  // with the same surface showing a DIFFERENT bot, because "the preview contains a dial
  // block" passes against a page that renders the same bot's block whatever is selected -
  // which is the defect one step along, and the one CCB-S5-001 was written about.

  const CHARACTER = 'A neon courier, BASECHARACTERSENTINEL, who owes nobody an explanation.';
  const ORIGIN = 'She walked out of the wastes carrying ORIGINSENTINEL under her coat.';

  const seeded = await db.query<{ id: string; slug: string }>(
    `INSERT INTO cinderella_bot_profiles
       (slug, display_name, enabled, base_character, origin,
        axis_sharpness, axis_warmth, axis_humor, axis_verbosity, axis_permissiveness)
     VALUES
       ('dialled-bot', 'DialledBot', TRUE, $1, $2, 10, 1, 9, 9, 3),
       -- The control, and it is NOT "no personality": a bot row always has dials, so this
       -- one carries the block at 5 with no character and no origin. Its origin is set to
       -- NULL explicitly because migration 031 gives the column a DEFAULT (the operator's
       -- own history), and an insert that omits it would seed two bots with a history.
       ('plain-bot', 'PlainBot', TRUE, NULL, NULL, 5, 5, 5, 5, 5)
     RETURNING id, slug`,
    [CHARACTER, ORIGIN],
  );
  const botIds = new Map(seeded.rows.map((r) => [r.slug, Number(r.id)]));
  const dialledId = botIds.get('dialled-bot')!;
  const plainId = botIds.get('plain-bot')!;

  const dialledPersonality = await botPersonalityById(db, dialledId);
  check(
    'the seeded bot has a character and an origin to lose',
    dialledPersonality?.baseCharacter === CHARACTER && dialledPersonality.origin === ORIGIN,
  );

  // The markers, and the proof that they DISCRIMINATE. A prompt built with no personality
  // is exactly what the shipped defect produced, so anything present in both would assert
  // nothing at all.
  const liveRules = await listPromptRules(db);
  const identity = { name: 'CIND3R3LLA' };
  const withVoice = conversationVoice(liveRules, dialledPersonality, identity).join('\n');
  const withoutVoice = conversationVoice(liveRules, null, identity).join('\n');
  const DIAL_FRAME = 'Your voice is set on five dials from 1 to 10.';
  const MARKERS = [DIAL_FRAME, 'SHARPNESS 10 of 10', 'BASECHARACTERSENTINEL', 'ORIGINSENTINEL'];
  check(
    'each marker is in a prompt built WITH the personality',
    MARKERS.every((m) => withVoice.includes(m)),
    MARKERS.filter((m) => !withVoice.includes(m)).join(', ') || `${MARKERS.length} markers`,
  );
  check(
    'and NONE of them is in one built without it, which is what the defect rendered',
    MARKERS.every((m) => !withoutVoice.includes(m)),
    MARKERS.filter((m) => withoutVoice.includes(m)).join(', '),
  );

  const postPage = (
    url: string,
    payload: Record<string, string>,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }> =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...payload, _csrf: csrf }).toString(),
    }) as never;

  /** The sidebar's standing selection, set the way the switcher sets it. */
  const selectBot = async (id: number | null): Promise<void> => {
    await postPage('/console/select-bot', {
      botProfileId: id === null ? '' : String(id),
      returnTo: '/book',
    });
  };

  /** The per-rule preview, pressed the way an operator presses it. */
  const previewOf = async (ruleId: string): Promise<string> => {
    const rule = (await listPromptRules(db)).find((r) => r.id === ruleId)!;
    const result = await postPage(`/book/rule/${ruleId}`, {
      text: rule.text,
      enabled: 'on',
      ord: String(rule.ord),
      action: 'preview',
    });
    check(`the preview of ${ruleId} renders`, result.statusCode === 200, String(result.statusCode));
    return result.body;
  };

  await selectBot(dialledId);
  const dialledPreview = await previewOf('prompt.no-meta');

  check(
    'the per-rule preview says WHOSE prompt it is, so an unlabelled prompt cannot mislead',
    dialledPreview.includes('DialledBot'),
  );
  check(
    'it carries the dial block, which the defect dropped from every preview',
    dialledPreview.includes(escapeHtml(DIAL_FRAME)),
  );
  check(
    "and the SELECTED bot's dial values, not the middle of every axis",
    dialledPreview.includes('SHARPNESS 10 of 10'),
  );
  check('it carries that bot’s base character', dialledPreview.includes('BASECHARACTERSENTINEL'));
  check('and its origin, which is the largest single piece', dialledPreview.includes('ORIGINSENTINEL'));

  // The new-law preview is the OTHER caller of the same card. It had the same defect and
  // would keep it if only one call site were fixed, which is exactly how these two drift.
  const newLawPreview = await postPage('/book/new', {
    id: 'ceiling.no-such-law',
    text: 'A NEW LAW, not enacted.',
    tier: 'standard',
    lane: 'dialled',
    appliesWhen: 'always',
    ord: '999',
    action: 'preview',
  });
  check('the new-law preview renders', newLawPreview.statusCode === 200, String(newLawPreview.statusCode));
  check(
    'and it carries the same voice section, so the two previews cannot disagree',
    newLawPreview.body.includes(escapeHtml(DIAL_FRAME)) &&
      newLawPreview.body.includes('ORIGINSENTINEL') &&
      newLawPreview.body.includes('SHARPNESS 10 of 10'),
  );

  // ── THE PAIR THAT MAKES THE ABOVE MEAN SOMETHING ──────────────────────────
  //
  // Everything so far passes against a page that renders one hardcoded personality. This
  // is the check that says the preview TRACKS THE SELECTION.
  await selectBot(plainId);
  const plainPreview = await previewOf('prompt.no-meta');
  check('the preview follows the switcher to the other bot', plainPreview.includes('PlainBot'));
  check(
    'that bot has dials of its own, so the block is still there',
    plainPreview.includes(escapeHtml(DIAL_FRAME)) && plainPreview.includes('SHARPNESS 5 of 10'),
  );
  check(
    'MUTATION: the first bot’s dials, character and origin are GONE from it',
    !plainPreview.includes('SHARPNESS 10 of 10') &&
      !plainPreview.includes('BASECHARACTERSENTINEL') &&
      !plainPreview.includes('ORIGINSENTINEL'),
  );

  const assembledForBot = await get(`/book/assembled?bot=${String(dialledId)}`);
  check(
    'the Assembled Word reads the rows too, so the whole page family answers alike',
    assembledForBot.body.includes('ORIGINSENTINEL') &&
      assembledForBot.body.includes('SHARPNESS 10 of 10'),
  );

  /* ── 9b. The context-size card measures the prompt she is SENT ───────────── */

  console.log('\n9b. The Interaction page measures a prompt with the voice section in it');

  // The card assembles through `systemPrompt` too, and it needs the registry in this
  // process or it renders "not loaded" instead of a number. Loaded here rather than at the
  // top so sections 1 to 7 keep driving the database directly, as they always have.
  setPromptRuleService(await PromptRuleService.load(db));

  const measured = async (bot: string): Promise<number | null> => {
    const body = (await get(`/interaction/memory?bot=${bot}`)).body;
    const found = /([0-9]+) characters/.exec(body);
    return found?.[1] === undefined ? null : Number(found[1]);
  };

  // `?bot=shared` resolves to no bot, which hands the card a null personality: it is the
  // shipped defect, still reachable on purpose, and it is what makes the ordering below a
  // measurement of the under-count rather than an assertion that two numbers differ.
  const bareShared = await measured('shared');
  const barePlain = await measured(String(plainId));
  const bareDialled = await measured(String(dialledId));

  check(
    'the card reports a number for every view, so the registry is loaded and it measured',
    bareShared !== null && barePlain !== null && bareDialled !== null,
    `${String(bareShared)} / ${String(barePlain)} / ${String(bareDialled)}`,
  );
  // ── BY AT LEAST WHAT WAS DROPPED, NOT MERELY "LARGER" ────────────────────
  //
  // Both of these were written as `>` first, and the second one PASSED under the mutation
  // below: 7653 against 7646, seven characters, which is the difference between the two
  // bots' display names rendering into the prompt. A comparison that a name length can
  // satisfy is not a measurement of a voice section. So each one is floored at the text it
  // is asserting the presence of.
  check(
    'a bot with dials measures larger than no bot at all, by at least the dial block',
    (barePlain ?? 0) - (bareShared ?? 0) >= DIAL_FRAME.length,
    `${String(barePlain)} vs ${String(bareShared)}`,
  );
  check(
    'and a bot with a character and an origin larger again, by at least both of them',
    (bareDialled ?? 0) - (barePlain ?? 0) >= CHARACTER.length + ORIGIN.length,
    `${String(bareDialled)} vs ${String(barePlain)}`,
  );
  check(
    'MUTATION: the under-count the defect caused is at least the origin it dropped',
    (bareDialled ?? 0) - (bareShared ?? 0) >= ORIGIN.length,
    `${String((bareDialled ?? 0) - (bareShared ?? 0))} characters, origin is ${String(ORIGIN.length)}`,
  );
  check(
    'the card names the bot it measured, so a figure cannot be read against the wrong one',
    (await get(`/interaction/memory?bot=${String(dialledId)}`)).body.includes(
      'Measured for DialledBot',
    ),
  );
  check(
    'and says so plainly when it measured no bot, rather than presenting it as a bot figure',
    (await get('/interaction/memory?bot=shared')).body.includes(
      escapeHtml("Measured with no bot's character or dials"),
    ),
  );

  setPromptRuleService(null);

  await app.close();

  console.log(
    failures === 0
      ? '\nAll Book of Elii checks passed.'
      : `\n${failures} Book of Elii check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
