/**
 * Two bots with different capabilities, against a REAL model (CCB-S5-021, D-175).
 *
 * ── WHY THIS EXISTS BESIDE `verify:plugin-scope` ─────────────────────────────
 *
 * The offline check proves the mechanism: the catalog splits per bot, the rule engine and
 * the seam both refuse the capability the bot does not have, and the search port is never
 * reached. It cannot prove the thing the operator will actually judge this by, which is
 * what the two bots SAY when the same member asks the same question. One should answer from
 * the web with the source named; the other should say something honest and human, and it
 * must not pretend to have looked.
 *
 * ── READ ITS OUTPUT, NOT ITS EXIT CODE ───────────────────────────────────────
 *
 * The same instruction the disclosure, recital and multi-bot live checks carry, for the same
 * reason. What is decidable is asserted: the bot without the capability reaches no provider,
 * and neither bot claims to have searched when it did not. The rest is printed so a person
 * can read whether the quiet bot's refusal sounds like a bot that never had the capability
 * rather than one sulking about a switch.
 *
 * NO NETWORK IS TOUCHED. The search provider is a fixture; only Ollama is real.
 *
 *   npm run verify:plugin-scope-live      (needs Ollama on 127.0.0.1:11434)
 */

import { PGlite } from '@electric-sql/pglite';
import type { T } from '@simplex-chat/types';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { setLogLevel } from '../src/log.js';
import { PluginService } from '../src/plugins/service.js';
import { WEB_SEARCH_ID } from '../src/plugins/web-search/plugin.js';
import { InteractionEngine, type WebSearchLookup } from '../src/interaction/engine.js';
import { normalizeInteraction } from '../src/interaction/settings.js';
import { generateOllamaReply } from '../src/interaction/ollama-reply.js';
import { normalizePersonality } from '../src/interaction/personality.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import type { CapturedMessage } from '../src/capture/types.js';
import type { LocalAiConfig } from '../src/config.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const AI: LocalAiConfig = {
  enabled: true,
  baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
  model: process.env['OLLAMA_MODEL'] ?? 'qwen3:14b',
  intentModel: process.env['OLLAMA_MODEL'] ?? 'qwen3:14b',
  replyModel: process.env['OLLAMA_MODEL'] ?? 'qwen3:14b',
  timeoutMs: 120_000,
} as LocalAiConfig;

const PERSONALITY = normalizePersonality({
  baseCharacter:
    'A neon courier who lives in the wire, reads a room in one packet, and has never once ' +
    'been impressed by a cheap line.',
  origin: '',
  sharpness: 7,
  warmth: 4,
  humor: 6,
  verbosity: 5,
  permissiveness: 5,
});

const ASK = 'Cinderella look up what the SimpleX protocol is';

let itemId = 5000;
function makeMessage(text: string, groupId: number): CapturedMessage {
  return {
    groupId,
    groupName: 'archive',
    itemId: itemId++,
    sharedMsgId: undefined,
    senderMemberId: 'alice-member-id',
    senderDisplayName: 'Alice',
    senderRole: 'member',
    senderGroupMemberId: 91,
    sentAt: new Date('2026-08-09T12:00:00.000Z').toISOString(),
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as T.AChatItem,
  };
}

async function main(): Promise<void> {
  setLogLevel('error');
  console.log(`Endpoint ${AI.baseUrl}, model ${AI.replyModel}\n`);

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

  const { rows } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('searcher', 'Searcher', TRUE), ('quiet', 'Quiet', TRUE)
     RETURNING id, slug`,
  );
  const bySlug = new Map(rows.map((r) => [r.slug, Number(r.id)]));
  const searcher = bySlug.get('searcher') ?? 0;
  const quiet = bySlug.get('quiet') ?? 0;

  const plugins = await PluginService.load(db);
  await plugins.setEnabled(WEB_SEARCH_ID, true, 'live');
  await plugins.setEnabledForBot(quiet, WEB_SEARCH_ID, false, 'live');
  // Warm BOTH, exactly as the boot path does before either engine can be asked anything.
  // Without this the unwarmed bot fails closed and has no capabilities at all, which is
  // the correct fallback and is not what this check is about.
  await plugins.refreshFor(searcher);
  await plugins.refreshFor(quiet);

  // The fixture. Real snippets, no network, and a counter so "did this bot go and look"
  // is a fact rather than an inference from the wording.
  let reached = 0;
  const provider: WebSearchLookup = {
    available: () => true,
    search: () => {
      reached++;
      return Promise.resolve({
        kind: 'results' as const,
        results: [
          {
            title: 'SimpleX Chat',
            snippet:
              'SimpleX is a messaging protocol with no user identifiers of any kind. It uses ' +
              'unidirectional queues on relay servers rather than accounts.',
            url: 'https://simplex.chat/',
          },
        ],
        provider: 'fixture',
      });
    },
  };

  // Her laws, from the seeded registry. Without them the prompt she is given has no
  // rules at all and the model's answer is not the answer production would get, which
  // would make every line printed below unrepresentative.
  const rules = await listPromptRules(db);
  const interaction = normalizeInteraction({});
  const replies: Record<string, string[]> = { Searcher: [], Quiet: [] };

  const engineFor = (botProfileId: number, name: string): InteractionEngine =>
    new InteractionEngine({
      db,
      botProfileId,
      settings: () => interaction,
      capabilities: () => plugins.capabilitiesFor(botProfileId),
      rules: () => rules,
      webSearch: () => (plugins.isEnabledFor(botProfileId, WEB_SEARCH_ID) ? provider : null),
      personality: () => PERSONALITY,
      // The REAL model, which is the whole point of this check.
      personalize: (request) => generateOllamaReply(AI, request),
      send: (msg, text) => {
        replies[name]?.push(text);
        return Promise.resolve(msg && undefined);
      },
    });

  for (const [name, id, groupId] of [
    ['Searcher', searcher, 41],
    ['Quiet', quiet, 42],
  ] as [string, number, number][]) {
    const before = reached;
    console.log(`\n${name.toUpperCase()} (web search ${name === 'Quiet' ? 'OFF' : 'ON'} for it)`);
    await engineFor(id, name).handle(makeMessage(ASK, groupId));
    for (const line of replies[name] ?? []) console.log(`  -> ${line}`);
    console.log(`  [provider reached: ${String(reached - before)} time(s)]`);
  }

  console.log('');
  check(
    'the bot with the capability went and looked',
    reached === 1,
    `${String(reached)} provider call(s) in total`,
  );
  check('and said something about it', (replies['Searcher'] ?? []).length > 0);
  check(
    'the bot without it reached no provider at all',
    reached === 1,
    'a second call would mean the quiet bot searched',
  );

  // THE ONE CONTENT ASSERTION WORTH MAKING MECHANICALLY. Everything else about wording is
  // for a person to read; claiming to have searched when no provider was called is a lie
  // about a fact, and a pattern can catch it.
  const quietText = (replies['Quiet'] ?? []).join(' ').toLowerCase();
  const claimsToHaveLooked =
    /\b(i (just )?(searched|looked it up|checked the web|googled)|according to (the )?(web|search|results)|from the web)\b/.test(
      quietText,
    );
  check(
    'and it did not claim to have looked anything up',
    !claimsToHaveLooked,
    quietText.slice(0, 90),
  );
  // POSITIVE CONTROL for that pattern: it has to be able to fire, or it is a check that
  // passes on every possible input. Three of the five self-claim patterns exist because
  // somebody read a green run and found the lie had moved (CCB-S5-002); this is the same
  // discipline applied to a much smaller pattern.
  check(
    'CONTROL: the pattern does fire on a sentence that claims it',
    /\b(i (just )?(searched|looked it up|checked the web|googled)|according to (the )?(web|search|results)|from the web)\b/.test(
      'i looked it up and here is what i found',
    ),
  );

  console.log(
    `\nRead the replies above rather than this line. ${
      failures === 0 ? 'Nothing decidable failed.' : `${String(failures)} decidable check(s) FAILED.`
    }\n`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
