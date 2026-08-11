/**
 * The lines the application writes, and which she may not (CCB-S5-027, D-180).
 *
 * ── WHAT THIS IS GUARDING ────────────────────────────────────────────────────
 *
 * In production one knowledge-base answer carried TWO attribution lines: hers, inline at
 * the end of her prose, naming one document; and the application's, underneath it, naming
 * two. Hers was a forgery in the application's own format, and it disagreed with the real
 * one. She had learned the shape from her own memory, because the application appends its
 * lines after she writes and memory hands the whole message back.
 *
 * The fix has four layers and this drives all of them, because three of them are silent
 * when they work:
 *
 *   1. she is never handed a document NAME beside a passage;
 *   2. she is never shown an application line in her memory;
 *   3. anything she writes that imitates one is removed before the message is composed;
 *   4. the application's own line is unchanged and is still the only one printed.
 *
 * ── EVERY NEGATIVE HAS A POSITIVE CONTROL ────────────────────────────────────
 *
 * "No forged source line reached the member" passes trivially against a guard that eats
 * every reply, and "no document name reached the prompt" passes against a prompt with no
 * passages in it. So each absence is asserted beside the presence that makes it meaningful:
 * the answer survives, the passage text is there, the real source line is there.
 *
 *   npx tsx scripts/verify-protected-text.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { upsertMessage } from '../src/db/messages.js';
import { insertBotMessage } from '../src/db/bot-messages.js';
import { recordOptIn } from '../src/db/consent.js';
import {
  MIN_MARKER_CHARS,
  markersFromTemplates,
  stripProtectedLines,
} from '../src/interaction/protected-text.js';
import {
  clearForgedLines,
  forgedLineCount,
  recentForgedLines,
} from '../src/interaction/forgery-log.js';
import {
  KNOWLEDGE_FENCE,
  generateOllamaReply,
  type AiReplyRequest,
} from '../src/interaction/ollama-reply.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { CORE_INTENTS } from '../src/interaction/intent.js';
import type { CapturedMessage } from '../src/capture/message.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';
import type { LocalAiConfig } from '../src/config.js';
import { seededPromptRules } from './seeded-rules.js';
import { setLogLevel } from '../src/log.js';
import { readFile } from 'node:fs/promises';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP = 1;
const ALICE = 'alice-member-id';
const SOURCE_LINE = '📄 From what you gave me: SEC-05 Handover';
const WARNING_LINE = '⚠️ That is warning 4 of 5, and it is on the record.';

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

let nextReply = '';
const fakeFetch: FetchLike = (input) => {
  const url = new URL(String(input));
  if (url.pathname !== '/v1/chat/completions') {
    return Promise.resolve(new Response('not found', { status: 404 }));
  }
  return Promise.resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: nextReply }) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
};

async function main(): Promise<void> {
  setLogLevel('error');
  const rules = await seededPromptRules();
  const persona = normalizeInteraction({ ...DEFAULT_INTERACTION }).persona;
  const shippedTemplates = Object.values(persona).flatMap((strings) =>
    Object.values(strings as Record<string, string>).filter(
      (value): value is string => typeof value === 'string',
    ),
  );

  /* ── 1. The markers are derived, not listed ──────────────────────────────── */

  console.log('\n1. Which lines are protected, and why');

  const derived = markersFromTemplates(shippedTemplates);
  const has = (marker: string): boolean => derived.markers.includes(marker);

  check(
    'the knowledge source line is protected',
    has('📄 From what you gave me:') && has('📄 Aus deinen Unterlagen:'),
  );
  check(
    'the web source line is protected',
    has('🔎 From the web:') && has('🔎 Aus dem Netz:'),
  );
  check(
    'the moderation warning is protected, both languages',
    has('⚠️ That is warning') && has('⚠️ Das ist Verwarnung'),
  );
  check(
    'and so is the sanction announcement, which carries the same shape',
    has('🔒 That is a') && has('🔒 Das ist jetzt'),
  );
  // The property that makes the set survive a briefing nobody remembers to update here.
  check(
    'a persona line with NO placeholder yields no marker, because it states no fact',
    !derived.markers.some((m) => m.startsWith('🕯️ I did not quite catch')),
  );
  check(
    'a template whose placeholder comes first yields no marker rather than a useless one',
    markersFromTemplates(['💰 *{amount} {base}* are about {value}']).markers.length === 0,
  );
  check(
    '  and that hole is REPORTED rather than passed over',
    markersFromTemplates(['💰 *{amount} {base}*']).unguarded.length === 1,
  );
  check(
    'the archive count is protected too, because a count is exactly this class of fact',
    has('🔍 I count') && has('🔍 Ich zähle'),
    derived.markers.filter((m) => m.startsWith('🔍')).join(' | '),
  );
  // PINNED BY NAME, not by a property that is true by construction. An earlier draft asserted
  // that every unguarded template's prefix is shorter than the minimum, which is the
  // definition of unguarded and could never fail. What matters is WHICH lines are in there,
  // and the answer must stay "the price lines, whose leading literal is an emoji and an
  // asterisk". Anything else appearing here means somebody moved a placeholder to the front
  // of a line that states a fact, which is how this reword lost its own guard for an hour.
  const unguardedKeys = Object.entries(persona)
    .flatMap(([lang, strings]) =>
      Object.entries(strings as Record<string, string>)
        .filter(([, template]) => derived.unguarded.includes(template))
        .map(([key]) => `${lang}.${key}`),
    )
    .sort();
  check(
    'the only unguarded protected lines are the price quotes, which open with an emoji and an asterisk',
    unguardedKeys.join(',') ===
      'de.conversion,de.price,de.priceUnknownAsset,en.conversion,en.price',
    unguardedKeys.join(',') || '(none)',
  );
  check(
    '  and MIN_MARKER_CHARS is what decides that, rather than a hand-kept exemption list',
    MIN_MARKER_CHARS === 8,
  );

  /* ── 2. The strip, in every placement production produced ────────────────── */

  console.log('\n2. What the strip does with a forgery');

  const markers = derived.markers;

  const own = stripProtectedLines(`Here is the answer.\n${SOURCE_LINE}`, markers);
  check(
    'a forged line on its own is dropped whole',
    own.text === 'Here is the answer.' && own.removed[0]?.where === 'line',
    own.text,
  );

  const inline = stripProtectedLines(
    `The scheduler serializes commands. 📄 From what you gave me: SEC-05`,
    markers,
  );
  check(
    'a forgery tacked onto the end of a sentence is CUT, and the sentence survives',
    inline.text === 'The scheduler serializes commands.' && inline.removed[0]?.where === 'inline',
    inline.text,
  );

  check(
    'decoration in front of it does not hide it',
    stripProtectedLines(`Answer.\n  - ${SOURCE_LINE}`, markers).text === 'Answer.',
  );
  check(
    'nor does different case or spacing',
    stripProtectedLines('Answer.\n📄  from   WHAT you gave me: X', markers).text === 'Answer.',
  );
  check(
    'nor does dropping the variation selector from the emoji',
    stripProtectedLines('Answer.\n⚠ That is warning 4 of 5', markers).text === 'Answer.',
  );
  check(
    'a bare "Source:" line is caught by the floor even with the persona reworded',
    stripProtectedLines('Answer.\nSource: SEC-05', []).text === 'Answer.',
  );
  check(
    '  but "sources:" INSIDE a sentence is prose and is left alone',
    stripProtectedLines('I have no sources: I am guessing.', markers).removed.length === 0,
  );

  // THE POSITIVE CONTROL. A guard that returned an empty string would pass everything above.
  const ordinary = 'The scheduler serializes every command through one queue. That is all.';
  check(
    'an ordinary answer is returned character for character unchanged',
    stripProtectedLines(ordinary, markers).text === ordinary,
  );
  check(
    '  and reports nothing removed, so the log cannot fill up with clean replies',
    stripProtectedLines(ordinary, markers).removed.length === 0,
  );

  /* ── 3. A draft she was given is not a forgery ───────────────────────────── */

  console.log('\n3. A line the application handed her is hers to carry');

  const draft = '📜 I keep 216 of your messages. 108 of them shine publicly.';
  check(
    'rewriting a draft that contains a protected line keeps it',
    stripProtectedLines(draft, markers, draft).removed.length === 0,
  );
  check(
    '  and the SAME text with no draft behind it is stripped',
    stripProtectedLines(draft, markers).removed.length === 1,
  );

  /* ── 4. Through the real transport ───────────────────────────────────────── */

  console.log('\n4. Through generateOllamaReply, which is the one door model text enters by');

  const conversation = (extra: Partial<AiReplyRequest> = {}): AiReplyRequest => ({
    kind: 'conversation',
    lang: 'en',
    memberMessage: 'what does SEC-05 say about the scheduler?',
    deterministicDraft: '',
    mode: 'conversation',
    rules,
    personality: { ...DEFAULT_PERSONALITY },
    protectedMarkers: markers,
    ...extra,
  });

  clearForgedLines();
  nextReply = `The scheduler serializes every command.\n${SOURCE_LINE}`;
  const guarded = await generateOllamaReply(config, conversation(), fakeFetch);
  check(
    'a forged source line does not come back out of the transport',
    !guarded.includes('From what you gave me'),
    guarded,
  );
  check('  and the answer itself does', guarded.includes('serializes every command'));
  check('  and the removal is counted for the console', forgedLineCount() === 1);
  check(
    '  with what was removed, so an operator can judge it',
    recentForgedLines()[0]?.text.includes('SEC-05') === true,
    recentForgedLines()[0]?.text ?? '(nothing)',
  );

  clearForgedLines();
  nextReply = `Charming.\n${WARNING_LINE}`;
  const warned = await generateOllamaReply(config, conversation({ kind: 'retort' }), fakeFetch);
  check(
    'a forged WARNING COUNT is removed by the same guard',
    !warned.includes('warning 4 of 5') && warned.includes('Charming'),
    warned,
  );

  clearForgedLines();
  nextReply = ordinary;
  const clean = await generateOllamaReply(config, conversation(), fakeFetch);
  check('an ordinary reply passes through untouched', clean === ordinary, clean);
  check('  and nothing is counted', forgedLineCount() === 0);

  // MUTATION. The guard is only wired because the engine sets `protectedMarkers`; a request
  // without it must show the forgery surviving, or these assertions prove nothing about the
  // guard and only about this fake model.
  clearForgedLines();
  nextReply = `The scheduler serializes every command.\n${SOURCE_LINE}`;
  const unguarded = await generateOllamaReply(
    config,
    conversation({ protectedMarkers: [] }),
    fakeFetch,
  );
  check(
    'MUTATION: with the markers removed the forgery survives, so the guard is what stops it',
    unguarded.includes('From what you gave me'),
  );

  // AND THE WIRING ITSELF, read from the source. There is exactly one production path into
  // `generateOllamaReply` and it must set the field AFTER spreading the caller's request, so
  // no lane can drop it. This is the same shape `verify:runtime-host` uses for `host.ts`.
  const engineSource = await readFile('src/interaction/engine.ts', 'utf8');
  const seam = /return \(request\) =>\s*inner\(\{[\s\S]*?\}\);/.exec(engineSource)?.[0] ?? '';
  check(
    'the engine seam sets protectedMarkers on every model call',
    seam.includes('protectedMarkers: this.protectedMarkers()'),
  );
  check(
    '  AFTER the spread, so no call site can drop it',
    seam.indexOf('...request') < seam.indexOf('protectedMarkers') && seam.includes('...request'),
  );

  /* ── 5. She is never shown one ───────────────────────────────────────────── */

  console.log('\n5. Her own memory no longer teaches her the format');

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  } as Queryable;
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);

  const now = Date.parse('2026-08-11T10:00:00Z');
  const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
  await recordOptIn(db, ALICE, at(120));

  await upsertMessage(db, {
    groupId: GROUP,
    groupMsgId: 10,
    sharedMsgId: null,
    senderMemberId: ALICE,
    senderDisplayName: 'Alice',
    sentAt: at(6),
    type: 'text',
    textBody: 'what does the handover say about the scheduler?',
    linksText: null,
    rawJson: {},
  });
  // HER OWN REPLY, exactly as it was sent: her prose with the application's line appended.
  // This row is the teacher.
  const herReply = `It serializes every command through one queue.\n${SOURCE_LINE}`;
  await insertBotMessage(db, {
    groupId: GROUP,
    groupMsgId: 11,
    sharedMsgId: null,
    senderMemberId: 'cinderella-member-id',
    senderDisplayName: 'CIND3R3LLA',
    sentAt: at(5),
    text: herReply,
    searchBody: herReply,
    category: 'conversation',
    lang: 'en',
    mentions: [],
    rawJson: {},
  });

  const interaction = normalizeInteraction({ ...DEFAULT_INTERACTION });
  let seenHistory: { speaker: string; text: string }[] = [];
  let seenPassages: readonly { text: string }[] = [];
  const sent: string[] = [];

  const engine = new InteractionEngine({
    capabilities: () => [...CORE_INTENTS],
    db,
    settings: () => interaction,
    rules: () => rules,
    now: () => now,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    knowledge: () => ({
      query: () =>
        Promise.resolve({
          outcome: { candidates: [], selected: [], charsUsed: 0, emptyBecauseOfFloor: false },
          passages: [{ title: 'SEC-05 Handover', text: 'The scheduler serializes commands.' }],
          sources: ['SEC-05 Handover'],
        }),
    }),
    botProfileId: 1,
    personalize: (req) => {
      seenHistory = [...(req.history ?? [])];
      seenPassages = req.knowledgePassages ?? [];
      return Promise.resolve('It serializes every command through one queue.');
    },
    send: (_msg, text) => {
      sent.push(text);
      return Promise.resolve();
    },
  });

  await engine.handle({
    groupId: GROUP,
    groupName: 'archive',
    itemId: 12,
    sharedMsgId: undefined,
    senderMemberId: ALICE,
    senderDisplayName: 'Alice',
    sentAt: new Date(now).toISOString(),
    type: 'text',
    text: 'Cinderella, and what about the queue depth?',
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as never,
  } as CapturedMessage);

  const remembered = seenHistory.map((h) => h.text).join(' | ');
  check(
    'her own reply reached the prompt, so this section is not vacuous',
    remembered.includes('serializes every command'),
    remembered.slice(0, 80),
  );
  check(
    'but the source line she wrote it under did NOT',
    !remembered.includes('From what you gave me') && !remembered.includes('SEC-05'),
    remembered.slice(0, 120),
  );

  /* ── 6. And never a document name ────────────────────────────────────────── */

  console.log('\n6. The passage she is handed carries no name to cite');

  check(
    'the passage text reached the prompt, so this section is not vacuous either',
    seenPassages.some((p) => p.text.includes('serializes commands')),
  );
  check(
    'and the document title did not travel with it',
    !JSON.stringify(seenPassages).includes('SEC-05'),
    JSON.stringify(seenPassages).slice(0, 100),
  );
  check(
    'the fence carries the text and nothing else',
    !`${KNOWLEDGE_FENCE}The scheduler serializes commands.${KNOWLEDGE_FENCE}`.includes('SEC-05'),
  );

  /* ── 7. The application still prints its own line ────────────────────────── */

  console.log('\n7. The line that IS hers to print');

  check(
    'the member still gets the real attribution, written by the application',
    sent.some((t) => t.includes('From what you gave me: SEC-05 Handover')),
    sent.join(' || ').slice(0, 140),
  );
  check(
    '  exactly once',
    sent.join('\n').split('From what you gave me').length - 1 === 1,
  );

  console.log(
    failures === 0
      ? '\nShe is never shown an application line, never handed a document name, and anything ' +
          'she writes that imitates one is removed and counted.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
