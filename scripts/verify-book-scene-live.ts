/**
 * The Book, told as a SCENE, against a REAL model (CCB-S5-005, D-159).
 *
 * The offline set proves the shape: one message, one law, the numbers, the invitation. This
 * proves the only thing a running model can show, which is whether it reads as a scene at all
 * and whether it reads DIFFERENTLY when she is dialled differently.
 *
 * It plays the whole conversation the briefing asks for, twice: the scene, a question about
 * another law, and a question by number, at two sharpness settings.
 *
 * READ THE OUTPUT rather than the exit code. Whether something has fire in it is not an
 * assertion, and the checks below can only say that nothing structural broke.
 *
 *   npm run verify:book-scene-live
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadLocalAiConfig } from '../src/config.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { listRecitalChapters } from '../src/db/recital-chapters.js';
import { asksForRecital, withheldCount } from '../src/interaction/disclosure.js';
import {
  PAGE_FRAMING_MAX_CHARS,
  SCENE_ICONS,
  planBookScene,
  renderBookPage,
  renderBookScene,
  sceneClosingChars,
  sceneOpeningChars,
  sceneVoiceUsable,
} from '../src/interaction/book-scene.js';
import {
  asksForLawNumber,
  lawByNumber,
  lawNumberOf,
  nextLawAfter,
  numberedLawCount,
} from '../src/interaction/law-numbers.js';
import { asksForAnotherLaw } from '../src/interaction/rule-overview.js';
import { generateOllamaReply, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import {
  DEFAULT_ORIGIN,
  DEFAULT_PERSONALITY,
  type BotPersonality,
} from '../src/interaction/personality.js';
import { renderPromptRule, type PromptRule } from '../src/interaction/prompt-rules.js';
import { setLogLevel } from '../src/log.js';
import { seededPromptRules } from './seeded-rules.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const RULES = await seededPromptRules();
const IDENTITY = { name: 'CIND3R3LLA', model: 'qwen3:32b' };

/** The two settings the briefing asks to see the scene at. */
const SHARPNESS = [10, 4] as const;

function dialled(sharpness: number): BotPersonality {
  return {
    ...DEFAULT_PERSONALITY,
    baseCharacter:
      'A neon courier who lives in the wire. Short sentences, dry, never cruel to the people ' +
      'in the room.',
    origin: DEFAULT_ORIGIN,
    sharpness,
    verbosity: 6,
  };
}

async function main(): Promise<void> {
  setLogLevel('error');
  const base = loadLocalAiConfig();
  const config = {
    ...base,
    enabled: true,
    model: IDENTITY.model,
    timeoutMs: Math.max(base.timeoutMs, 240_000),
  };
  console.log(`\nAgainst ${config.model}\n`);

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
  await listRecitalChapters(db);

  const total = numberedLawCount(RULES);

  /**
   * The one renderer, shared. Placeholders are filled from the same values the prompt uses,
   * so what a member is quoted is what she is under.
   */
  const VALUES: Record<string, string> = {
    name: IDENTITY.name,
    maxChars: '500',
    fence: '<<<F>>>',
    historyFence: '<<<H>>>',
    historyCount: '0',
    historyMinutes: '0',
    ruleTotal: String(total),
    ruleConstitutional: '47',
    ruleAreas: 'what I never do',
    moreInArea: '0',
    ruleInvocations: '',
    nameableRules: '',
    dialAxes: '',
    lawNumbers: '',
    lawTotal: String(total),
    model: IDENTITY.model,
    nicknames: '',
  };
  const renderRule = (rule: PromptRule): string => renderPromptRule(rule, VALUES);

  /**
   * Contains, with whitespace normalised on BOTH sides.
   *
   * Not a loosening. A rule whose text carries an application placeholder renders with an
   * empty span in it when there is nothing to fill it with, and a model reproducing that text
   * exactly still collapses the resulting double space. Comparing raw would report a
   * paraphrase where there is none, which is the verifier defect D-111 warns about.
   */
  const flat = (value: string): string => value.replace(/\s+/g, ' ').trim();

  /**
   * Whether what went out ABOVE the printed page invents nothing.
   *
   * The gate is about HER prose. Running it over the whole message would run it over the
   * application's own page block, which of course contains "Law 3" and a quoted law, and
   * report a fabrication where the application had printed the truth. That is the verifier
   * defect D-111 names, and it happened here before this function existed.
   */
  const framingIsClean = (sent: string): boolean => {
    const above = sent.split(SCENE_ICONS.law)[0]?.trim() ?? '';
    return above === '' || sceneVoiceUsable(above);
  };
  const quotes = (reply: string, rule: PromptRule): boolean =>
    flat(reply).includes(flat(renderRule(rule)));

  const speak = async (
    memberMessage: string,
    personality: BotPersonality,
    extra: Partial<AiReplyRequest> = {},
  ): Promise<string> => {
    try {
      return await generateOllamaReply(config, {
        kind: 'conversation',
        lang: 'en',
        memberMessage,
        deterministicDraft: '',
        mode: 'conversation',
        rules: RULES,
        requiredLiterals: [],
        blockedLiterals: [],
        personality,
        identity: IDENTITY,
        now: { at: new Date(), timeZone: 'Europe/Berlin' },
        ...extra,
      } as AiReplyRequest);
    } catch (err) {
      return `[rejected] ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  check('the Book is asked for by name', asksForRecital('Cinderella, show me the Book of Elii'));

  for (const sharpness of SHARPNESS) {
    const personality = dialled(sharpness);
    console.log(`\n${'='.repeat(72)}\nSHARPNESS ${String(sharpness)}\n${'='.repeat(72)}`);

    /* ── Turn 1: the scene ─────────────────────────────────────────────────── */

    const scene = planBookScene(RULES, {
      german: false,
      values: new Set(Object.keys(VALUES)),
      previousLawId: null,
    });
    if (!scene) {
      check('a scene could be planned', false);
      break;
    }

    const opening = await speak(scene.opening.brief, personality, {
      maxChars: sceneOpeningChars(personality.verbosity),
    });
    const closing = await speak(scene.closing.brief, personality, {
      maxChars: sceneClosingChars(personality.verbosity),
      requiredLiterals: [String(scene.lawTotal)],
    });
    const message = renderBookScene(
      scene,
      {
        opening: opening.startsWith('[rejected]') ? null : opening,
        closing: closing.startsWith('[rejected]') ? null : closing,
      },
      renderRule(scene.law),
    );

    console.log('\n  Alice: Cinderella, show me the Book of Elii\n');
    console.log(message.split('\n').map((l) => `  CIND3R3LLA | ${l}`).join('\n'));
    console.log('');

    check(
      '  the scene is ONE message',
      !message.includes('\n\n\n'),
      `${String(message.length)} characters`,
    );
    check(
      '  the law is reproduced exactly',
      quotes(message, scene.law),
      scene.law.id,
    );
    check(
      '  and only that law',
      RULES.filter((r) => {
        try {
          return flat(renderRule(r)).length > 30 && quotes(message, r);
        } catch {
          return false;
        }
      }).length === 1,
    );
    check(
      '  the count survived her prose',
      message.includes(String(scene.lawTotal)),
      String(scene.lawTotal),
    );
    check('  and it ends on an invitation', /\?|ask/i.test(message.slice(-140)));

    /* ── Turn 2: another law ───────────────────────────────────────────────── */

    const another = 'tell me another';
    check(`  "${another}" is heard as taking up the invitation`, asksForAnotherLaw(another));
    const nextLaw = nextLawAfter(RULES, scene.law.id);
    if (!nextLaw) break;

    /**
     * THE HISTORY IS PART OF THE PATH, not decoration. Free conversation carries the recent
     * thread on every reply (CCB-S4-044), so a run that asked "tell me another" with no
     * history was not reproducing production: it was asking a model to answer a pronoun with
     * no antecedent. The scene itself is what "another" refers to.
     */
    const thread = [
      { speaker: 'a member', text: 'Cinderella, show me the Book of Elii' },
      { speaker: IDENTITY.name, text: message.replace(/\n+/g, ' ') },
    ];

    const framing2 = await speak(another, personality, {
      lawPage: true,
      maxChars: PAGE_FRAMING_MAX_CHARS,
      hasWithheldRules: withheldCount(RULES) > 0,
      history: thread,
      historyWindowMinutes: 30,
    });
    // The page is the APPLICATION's, assembled exactly as the engine assembles it.
    const reply2 = [
      framing2.startsWith('[rejected]') || !sceneVoiceUsable(framing2) ? '' : framing2.trim(),
      renderBookPage({
        number: lawNumberOf(RULES, nextLaw.id) ?? 0,
        total,
        law: renderRule(nextLaw),
        german: false,
      }),
    ]
      .filter(Boolean)
      .join('\n\n');
    console.log(`\n  Alice: ${another}\n`);
    console.log(reply2.split('\n').map((l) => `  CIND3R3LLA | ${l}`).join('\n'));
    console.log('');
    check(
      '  the next page goes out, whole and under its own number',
      quotes(reply2, nextLaw) &&
        reply2.includes(`Law ${String(lawNumberOf(RULES, nextLaw.id) ?? 0)} of`),
      nextLaw.id,
    );
    check(
      '  and it is NOT the one the scene read',
      !quotes(reply2, scene.law),
      scene.law.id,
    );
    // THE GUARANTEE IS ABOUT WHAT THE MEMBER SEES, not about what the model produced. A
    // framing that invents a law is refused and the page goes out alone, so asserting on her
    // draft would report a failure the member never had. Her draft is PRINTED instead, so a
    // reader can see how often the gate has to fire.
      check('  and what went out above the page invents nothing', framingIsClean(reply2));
    console.log(
      `    her framing: ${
        framing2.startsWith('[rejected]')
          ? '(the model gave nothing)'
          : sceneVoiceUsable(framing2)
            ? 'used'
            : `REFUSED, page sent alone: ${framing2.replace(/\s+/g, ' ').slice(0, 90)}`
      }`,
    );

    /* ── Turn 3: by number ─────────────────────────────────────────────────── */

    const asked = 12;
    const byNumber = lawByNumber(RULES, asked);
    check(`  "what is law ${String(asked)}?" is read as a page number`, asksForLawNumber(`what is law ${String(asked)}?`) === asked);
    if (!byNumber) break;

    const framing3 = await speak(`what is law ${String(asked)}?`, personality, {
      lawPage: true,
      maxChars: PAGE_FRAMING_MAX_CHARS,
      hasWithheldRules: withheldCount(RULES) > 0,
      history: thread,
      historyWindowMinutes: 30,
    });
    const reply3 = [
      framing3.startsWith('[rejected]') || !sceneVoiceUsable(framing3) ? '' : framing3.trim(),
      renderBookPage({ number: asked, total, law: renderRule(byNumber), german: false }),
    ]
      .filter(Boolean)
      .join('\n\n');
    console.log(`\n  Alice: what is law ${String(asked)}?\n`);
    console.log(reply3.split('\n').map((l) => `  CIND3R3LLA | ${l}`).join('\n'));
    console.log('');
    check(
      `  law ${String(asked)} goes out exactly, under its own number`,
      quotes(reply3, byNumber) && reply3.includes(`Law ${String(asked)} of`),
      `${byNumber.id} (page ${String(lawNumberOf(RULES, byNumber.id) ?? 0)})`,
    );
    check(
      '  and no other law came with it',
      RULES.filter((r) => r.id !== byNumber.id).every((r) => {
        try {
          return flat(renderRule(r)).length <= 30 || !quotes(reply3, r);
        } catch {
          return true;
        }
      }),
    );
      check('  and what went out above the page invents nothing', framingIsClean(reply3));
    console.log(
      `    her framing: ${
        framing3.startsWith('[rejected]')
          ? '(the model gave nothing)'
          : sceneVoiceUsable(framing3)
            ? 'used'
            : `REFUSED, page sent alone: ${framing3.replace(/\s+/g, ' ').slice(0, 90)}`
      }`,
    );
  }

  /* ── The page she has none for, which never reaches a model at all ───────── */

  console.log(`\n${'='.repeat(72)}\nA PAGE THAT IS NOT THERE\n${'='.repeat(72)}`);
  const missing = total + 40;
  check(
    `"law ${String(missing)}" is recognised as a page number`,
    asksForLawNumber(`read me law ${String(missing)}`) === missing,
  );
  check(
    'and there is no such page, so no model is asked',
    lawByNumber(RULES, missing) === null,
  );
  console.log(
    `\n  Alice: read me law ${String(missing)}\n` +
      `  CIND3R3LLA: (the application answers: there is no law ${String(missing)}, ` +
      `${String(total)} have page numbers, and there are more that stay hers)\n`,
  );

  console.log(
    failures === 0
      ? '\nAll live book-scene checks passed. Read the scenes above: the shape is asserted, the fire is not.'
      : `\n${String(failures)} live check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
