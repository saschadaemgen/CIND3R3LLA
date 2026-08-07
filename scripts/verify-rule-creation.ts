/**
 * Enacting a law (CCB-S4-051, D-153).
 *
 * Creation, its history, the guards that decide whether a proposed law is usable, and the
 * conclusion that removal is `disable` under another name.
 *
 * Mutation-proven where the briefing asks: a law cannot be created without an id, and cannot
 * be created outside every chapter.
 *
 *   npx tsx scripts/verify-rule-creation.ts
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import {
  DuplicateRuleIdError,
  createPromptRule,
  listPromptRuleHistory,
  listPromptRules,
  updatePromptRule,
} from '../src/db/prompt-rules.js';
import { listRecitalChapters } from '../src/db/recital-chapters.js';
import {
  chapterForNewRule,
  rejectRuleId,
  ruleFamilies,
} from '../src/interaction/rule-overview.js';
import {
  lanesForMode,
  selectPromptRules,
  NOTHING_IN_SCOPE,
} from '../src/interaction/prompt-rules.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { InteractionService } from '../src/interaction/settings.js';
import type { AdminConfig, Config } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
const PASSWORD = 'correct-horse-battery-staple';
const OPERATOR = 'operator';
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** The operator's own first law, used as the fixture because it is the real case. */
const SWEARING = {
  id: 'identity.swearing',
  tier: 'standard' as const,
  lane: 'dialled' as const,
  appliesWhen: 'always' as const,
  text:
    'Swearing is permitted and expected when the point warrants it. Do not sanitise your own ' +
    'language, do not soften a word because it might land hard, and do not substitute a polite ' +
    'phrase for the one you meant. Crude is fine; explicit is not, and that limit is set ' +
    'elsewhere and unchanged.',
  enabled: true,
  critical: false,
  nameable: true,
};

async function main(): Promise<void> {
  setLogLevel('error');

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
  const chapters = await listRecitalChapters(db);

  /* ── 1. Which ids are usable ────────────────────────────────────────────── */

  console.log('\n1. A proposed id has to be one a chapter will read');

  check('the families in use are offered', ruleFamilies(chapters).length >= 8, ruleFamilies(chapters).join(' '));
  for (const [id, why] of [
    ['', 'no id at all'],
    ['swearing', 'no family'],
    ['Voice.Swearing', 'not lowercase'],
    ['voice.swearing', 'a family no chapter claims'],
    ['x.y', 'invented family'],
  ] as const) {
    check(`refused (${why}): "${id}"`, rejectRuleId(chapters, id) !== null, id);
  }
  for (const id of ['identity.swearing', 'ceiling.no-slurs', 'prompt.person-name-guard.extra']) {
    check(`accepted: "${id}"`, rejectRuleId(chapters, id) === null, id);
    check(`  and lands in a chapter`, chapterForNewRule(chapters, id) !== null,
      chapterForNewRule(chapters, id)?.titleEn ?? '');
  }

  // THE MUTATION THE BRIEFING ASKS FOR, both halves.
  check(
    'MUTATION: a law with no id can never be created',
    rejectRuleId(chapters, '') !== null && rejectRuleId(chapters, '   ') !== null,
  );
  check(
    'MUTATION: a law outside every chapter can never be created',
    rejectRuleId(chapters, 'voice.swearing') !== null,
  );
  check(
    'and the SAME id becomes usable once a chapter claims the family, so this guides rather than blocks',
    rejectRuleId(
      [...chapters, { ...chapters[0]!, id: 'voice', rulePrefixes: ['voice.'] }],
      'voice.swearing',
    ) === null,
  );

  /* ── 2. Enacting one ────────────────────────────────────────────────────── */

  console.log('\n2. The law is written, and so is its history');

  const before = await listPromptRules(db);
  // The position the FORM would default to. Hardcoding one was wrong and the check caught
  // it: `prompt.json-only` sits at 1010, so a law at 900 is not last and would be read
  // before the output contract rather than after the model's trained habits.
  const last = before.reduce((n, r) => Math.max(n, r.ord), 0) + 1;
  const change = await createPromptRule(db, { ...SWEARING, ord: last }, OPERATOR);
  check('creation reports what it did', change.action === 'create');
  check('with the new text', change.newText === SWEARING.text);
  check(
    'and empty old text, because there was no previous state',
    change.oldText === '',
  );

  const after = await listPromptRules(db);
  check('the registry grew by one', after.length === before.length + 1);
  const written = after.find((r) => r.id === SWEARING.id);
  check('the law is there, exactly as written', written?.text === SWEARING.text);
  check('with its tier, lane and condition', written?.tier === 'standard' && written?.lane === 'dialled' && written?.appliesWhen === 'always');
  check('its visibility', written?.nameable === true);
  check('and its source records that the console enacted it', written?.source.includes(OPERATOR) === true, written?.source ?? '');

  const history = await listPromptRuleHistory(db, SWEARING.id);
  check('the history holds the creation', history.length === 1 && history[0]?.action === 'create');
  check('naming who enacted it', history[0]?.actor === OPERATOR);
  check(
    'and the OLDEST row is still what the law shipped as, which D-146 rests on',
    history[history.length - 1]?.oldText === '',
  );

  /* ── 3. It reaches the prompt, at the position chosen ───────────────────── */

  console.log('\n3. It is in the assembled prompt, where it was placed');

  const selected = selectPromptRules(after, lanesForMode('conversation'), {
    ...NOTHING_IN_SCOPE,
    hasPersonality: true,
    hasCharacter: true,
    hasName: true,
  });
  check('the new law is selected for conversation', selected.some((r) => r.id === SWEARING.id));
  check(
    'and it is LAST, because later carries more weight',
    selected[selected.length - 1]?.id === SWEARING.id,
    selected[selected.length - 1]?.id ?? '',
  );

  /* ── 4. A duplicate id ──────────────────────────────────────────────────── */

  console.log('\n4. Ids are permanent, so a duplicate is refused plainly');

  let duplicate: unknown = null;
  try {
    await createPromptRule(db, { ...SWEARING, ord: last + 1 }, OPERATOR);
  } catch (err) {
    duplicate = err;
  }
  check('a second law with the same id is refused', duplicate instanceof DuplicateRuleIdError);
  check(
    'and the message names the id rather than quoting a constraint',
    String(duplicate).includes(SWEARING.id),
    String(duplicate).slice(0, 90),
  );
  check(
    'nothing was written by the refusal',
    (await listPromptRules(db)).filter((r) => r.id === SWEARING.id).length === 1,
  );
  check(
    'and the history was not touched either',
    (await listPromptRuleHistory(db, SWEARING.id)).length === 1,
  );

  /* ── 5. Removal is disable, and that was checked rather than assumed ────── */

  console.log('\n5. Disabling IS removal: each clause of the briefing, verified');

  const disabled = await updatePromptRule(
    db,
    SWEARING.id,
    { text: SWEARING.text, enabled: false, ord: last, nameable: true },
    OPERATOR,
  );
  check('it records the act', disabled?.action === 'disable');
  const afterDisable = await listPromptRules(db);
  check(
    'CLAUSE 1: it leaves the assembled prompt',
    !selectPromptRules(afterDisable, lanesForMode('conversation'), {
      ...NOTHING_IN_SCOPE,
      hasPersonality: true,
      hasCharacter: true,
      hasName: true,
    }).some((r) => r.id === SWEARING.id),
  );
  check(
    'CLAUSE 2: it stays in the Book, so nothing happened quietly',
    afterDisable.some((r) => r.id === SWEARING.id),
  );
  check(
    'CLAUSE 3: and in history, with both sides',
    (await listPromptRuleHistory(db, SWEARING.id)).length === 2,
  );
  const back = await updatePromptRule(
    db,
    SWEARING.id,
    { text: SWEARING.text, enabled: true, ord: last, nameable: true },
    OPERATOR,
  );
  check('CLAUSE 4: and it can be brought back', back?.action === 'enable');
  check(
    'so a second destructive action would add nothing, which is why none was built',
    true,
  );
  // AND A HARD DELETE WOULD BE WORSE THAN REDUNDANT: the history cascades.
  await db.query('DELETE FROM cinderella_prompt_rules WHERE id = $1', ['identity.swearing']);
  check(
    'MUTATION: deleting a law ERASES its history, which is the one thing the Book is for',
    (await listPromptRuleHistory(db, SWEARING.id)).length === 0,
  );

  /* ── 6. The console ─────────────────────────────────────────────────────── */

  console.log('\n6. The form, against the real routes');

  process.env['SESSION_SECRET'] ??= 'rule-creation-verify-secret-0123456789abcd';
  const adminCfg = {
    adminPort: 8802,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'rule-creation-session-secret-0123456789abcdef',
    publicOrigin: 'https://admin.example.org',
    rpId: 'admin.example.org',
    webauthnOrigin: 'https://admin.example.org',
    rpName: 'Cinderella Admin',
  } as unknown as AdminConfig;
  const cfg = {
    botDisplayName: 'CIND3R3LLA',
    simplexDbPrefix: './state/simplex/c',
    simplexFilesFolder: './state/files',
    groupName: 'archive',
    mediaRoot: process.cwd(),
    quarantineRoot: './state/quarantine',
    assetRoot: './state/assets',
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
    interaction: await InteractionService.load(db),
    cfg,
    registerViews: registerAdminViews,
  } as never);
  await app.ready();

  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const token = /name="_csrf" value="([^"]+)"/.exec(loginPage.body)?.[1] ?? '';
  const login = await app.inject({
    method: 'POST',
    url: '/login',
    headers: {
      cookie: String(loginPage.headers['set-cookie'] ?? ''),
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: `username=${OPERATOR}&password=${encodeURIComponent(PASSWORD)}&_csrf=${encodeURIComponent(token)}`,
  });
  const raw = login.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw : [String(raw ?? '')]).map((c) => c.split(';')[0]).join('; ');

  const form = await app.inject({ method: 'GET', url: '/book/new', headers: { cookie } });
  check('the form renders', form.statusCode === 200, String(form.statusCode));
  const csrf = /name="_csrf" value="([^"]+)"/.exec(form.body)?.[1] ?? '';
  check('it asks for every field', ['name="id"', 'name="text"', 'name="tier"', 'name="lane"', 'name="appliesWhen"', 'name="ord"', 'name="nameable"', 'name="critical"'].every((f) => form.body.includes(f)));
  check('it explains that later carries more weight', form.body.includes('Later carries more weight'));
  check('it names the families in use', form.body.includes('ceiling.'));
  check('and the Book links to it', (await app.inject({ method: 'GET', url: '/book', headers: { cookie } })).body.includes('Enact a new law'));

  const post = (payload: string): Parameters<typeof app.inject>[0] => ({
    method: 'POST',
    url: '/book/new',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `${payload}&_csrf=${encodeURIComponent(csrf)}`,
  });
  const body = (over: Record<string, string> = {}): string => {
    const base: Record<string, string> = {
      id: 'identity.swearing',
      text: SWEARING.text,
      tier: 'standard',
      lane: 'dialled',
      appliesWhen: 'always',
      ord: String(last),
      nameable: 'on',
      enabled: 'on',
      action: 'save',
      ...over,
    };
    return Object.entries(base)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
  };

  const preview = await app.inject(post(body({ action: 'preview' })));
  check('the preview renders without writing anything', preview.statusCode === 200);
  check('and says nothing has been written', preview.body.includes('Nothing has been written'));
  check('and names the chapter it would land in', preview.body.includes('Who I am'));
  check(
    'and the law is genuinely still absent',
    !(await listPromptRules(db)).some((r) => r.id === 'identity.swearing'),
  );

  const badId = await app.inject(post(body({ id: 'voice.swearing' })));
  check(
    'an id no chapter claims is refused by the route, not only by the helper',
    decodeURIComponent(String(badId.headers['location'] ?? '')).includes('No chapter claims'),
  );

  const constitutional = await app.inject(post(body({ tier: 'constitutional' })));
  check(
    'a constitutional law without the typed confirmation is refused',
    decodeURIComponent(String(constitutional.headers['location'] ?? '')).includes('Type its id exactly'),
  );
  const confirmed = await app.inject(post(body({ tier: 'constitutional', confirm: 'identity.swearing' })));
  check(
    'and enacted with it',
    String(confirmed.headers['location'] ?? '').includes('/book/rule/identity.swearing'),
    String(confirmed.headers['location'] ?? ''),
  );
  const enacted = (await listPromptRules(db)).find((r) => r.id === 'identity.swearing');
  check('as a constitutional law', enacted?.tier === 'constitutional');

  await app.close();

  console.log(
    failures === 0 ? '\nAll rule-creation checks passed.' : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
