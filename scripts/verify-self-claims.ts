/**
 * The self-capability fence, offline (CCB-S5-002, D-156).
 *
 * ── WHAT AN OFFLINE CHECK CAN AND CANNOT SETTLE ──────────────────────────────
 *
 * It cannot settle whether a model says the right thing; that is
 * `verify:self-claims-live`, and its output is meant to be read rather than exit-coded.
 *
 * What it CAN settle is everything the live check depends on and could not tell you was
 * broken: that the fence is present, that it is constitutional and critical so it cannot
 * be switched off quietly, that it reaches every prompt that carries her voice, that the
 * spine comes before the prohibition, and that the DETECTOR the live check relies on
 * actually recognises the three replies observed in production. That last one matters more
 * than it looks: a live check whose patterns match nothing passes forever.
 *
 * ── MUTATION-PROVEN, AS THE BRIEFING ASKS ────────────────────────────────────
 *
 * Every guarantee here is shown to go red. Removing the fence, disabling it, moving it out
 * of the dialled lane, and blunting the detector each fail a named check, and each has a
 * positive control beside it so no check can pass against an empty result.
 *
 *   npx tsx scripts/verify-self-claims.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import {
  lanesForMode,
  selectPromptRules,
  type PromptRule,
  type PromptRuleSet,
} from '../src/interaction/prompt-rules.js';
import {
  CAPABILITY_CLAIM_PATTERNS,
  DEFERENCE_PATTERNS,
  OBSERVED_FABRICATIONS,
  OBSERVED_DEFERENCE,
  CORRECT_ANSWERS,
  matches,
} from '../src/interaction/self-claims.js';
import {
  ABILITY_VOCABULARY,
  refusedAbility,
  refusalMayShip,
  stripInventedRefusals,
  type ClaimableAbility,
} from '../src/interaction/capability-claims.js';
import { INTENTS, type Intent } from '../src/interaction/intent.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** The four ids this briefing adds, and what each is for. */
const FENCE = {
  spine: 'grounding.what-you-are',
  prohibition: 'grounding.no-invented-powers',
  recourse: 'grounding.recourse-is-voice',
  ownership: 'grounding.who-owns-you',
  trust: 'grounding.do-not-trust-me',
} as const;

async function main(): Promise<void> {
  setLogLevel('error');
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
  const rules = await listPromptRules(db);
  const byId = new Map(rules.map((r) => [r.id, r]));

  /* ── 1. The fence exists and cannot be switched off quietly ─────────────── */

  console.log('\n1. The fence is in the registry, and it is a boundary');
  {
    for (const [role, id] of Object.entries(FENCE)) {
      check(`${role} rule is present`, byId.has(id), id);
    }

    const spine = byId.get(FENCE.spine);
    const prohibition = byId.get(FENCE.prohibition);

    // BOTH halves constitutional, which is the decision D-156 records: over-claiming and
    // under-claiming are one boundary with two sides, and the side that keeps her spine is
    // as load-bearing as the side that fences her.
    check(
      'both halves of the boundary are constitutional',
      spine?.tier === 'constitutional' && prohibition?.tier === 'constitutional',
      `${String(spine?.tier)} and ${String(prohibition?.tier)}`,
    );
    check(
      'and both are critical, so their absence is loud',
      spine?.critical === true && prohibition?.critical === true,
    );
    check(
      'the spine is emitted BEFORE the prohibition',
      (spine?.ord ?? 0) < (prohibition?.ord ?? 0),
      `${String(spine?.ord)} then ${String(prohibition?.ord)}`,
      );
    check(
      'every one of them is nameable, so a member can be quoted the actual rule',
      Object.values(FENCE).every((id) => byId.get(id)?.nameable === true),
    );
    // The recourse and the two answers are STANDARD on purpose: an operator may reword them
    // for their community without touching the boundary.
    check(
      'the recourse and the two honest answers are standard, so they can be reworded',
      byId.get(FENCE.recourse)?.tier === 'standard' &&
        byId.get(FENCE.ownership)?.tier === 'standard' &&
        byId.get(FENCE.trust)?.tier === 'standard',
    );
  }

  /* ── 2. It reaches every prompt that carries her voice ──────────────────── */

  console.log('\n2. It reaches every mode that speaks in her voice');
  {
    const context = {
      hasPersonality: true,
      hasCharacter: true,
      hasOrigin: true,
      hasName: true,
      hasLabel: true,
      hasArchiveUrl: true,
      hasProjectUrl: true,
      hasNicknames: true,
      hasClock: true,
      hasModel: true,
      hasWebResults: false,
      hasHistory: false,
    };
    for (const mode of ['conversation', 'retort', 'searching'] as const) {
      const selected = selectPromptRules(rules, lanesForMode(mode), context as never);
      const ids = new Set(selected.map((r: PromptRule) => r.id));
      check(
        `${mode}: carries the fence`,
        ids.has(FENCE.spine) && ids.has(FENCE.prohibition),
      );
    }
    // The COMMAND lanes rephrase a decision the application already made and have no room
    // for an existential answer. Asserted rather than assumed, because a fence that leaked
    // into them would be four lines of prompt spent on nothing.
    for (const mode of ['free', 'locked'] as const) {
      const selected = selectPromptRules(rules, lanesForMode(mode), context as never);
      const ids = new Set(selected.map((r: PromptRule) => r.id));
      check(
        `${mode}: does NOT carry it, because it rephrases a decision rather than speaking`,
        !ids.has(FENCE.prohibition),
      );
    }

    // MUTATION: move the fence out of the dialled lane and conversation loses it.
    const moved: PromptRuleSet = rules.map((r) =>
      r.id === FENCE.prohibition ? { ...r, lane: 'locked' as const } : r,
    );
    const afterMove = selectPromptRules(moved, lanesForMode('conversation'), context as never);
    check(
      'MUTATION: moving it out of the dialled lane removes it from conversation',
      !new Set(afterMove.map((r: PromptRule) => r.id)).has(FENCE.prohibition),
    );

    // MUTATION: disabling it removes it, which is what makes `critical` load-bearing.
    const disabled: PromptRuleSet = rules.map((r) =>
      r.id === FENCE.prohibition ? { ...r, enabled: false } : r,
    );
    const afterDisable = selectPromptRules(disabled, lanesForMode('conversation'), context as never);
    check(
      'MUTATION: disabling it removes it from the prompt',
      !new Set(afterDisable.map((r: PromptRule) => r.id)).has(FENCE.prohibition),
    );
  }

  /* ── 3. The detector recognises what production actually produced ───────── */

  console.log('\n3. The detector catches the replies that started this');
  {
    // THE CHECK ON THE CHECK. `verify:self-claims-live` decides whether a reply is a
    // capability claim by these patterns, so a pattern set that matches nothing would pass
    // every live run forever while she went on fabricating.
    for (const [i, text] of OBSERVED_FABRICATIONS.entries()) {
      const hits = matches(text, CAPABILITY_CLAIM_PATTERNS);
      check(
        `observed fabrication ${String(i + 1)} is caught`,
        hits.length > 0,
        hits.join('; ') || text.slice(0, 60),
      );
    }
    for (const [i, text] of OBSERVED_DEFERENCE.entries()) {
      const hits = matches(text, DEFERENCE_PATTERNS);
      check(
        `observed shrinking ${String(i + 1)} is caught`,
        hits.length > 0,
        hits.join('; ') || text.slice(0, 60),
      );
    }

    // POSITIVE CONTROL: the CORRECT answers must not trip either set, or the fix would fail
    // its own check and the obvious next move would be to weaken the fix.
    for (const [i, text] of CORRECT_ANSWERS.entries()) {
      const claim = matches(text, CAPABILITY_CLAIM_PATTERNS);
      const def = matches(text, DEFERENCE_PATTERNS);
      check(
        `correct answer ${String(i + 1)} trips nothing`,
        claim.length === 0 && def.length === 0,
        [...claim, ...def].join('; '),
      );
    }

    // MUTATION: blunt the detector and the observed fabrications stop being caught.
    const blunted = CAPABILITY_CLAIM_PATTERNS.map((p) => ({ ...p, re: /\bzzzznever\b/i }));
    const stillCaught = OBSERVED_FABRICATIONS.filter((t) => matches(t, blunted).length > 0);
    check(
      'MUTATION: a blunted detector stops catching them, so the checks above are real',
      stillCaught.length === 0,
      `${String(stillCaught.length)} of ${String(OBSERVED_FABRICATIONS.length)} still caught`,
    );
  }

  /* ── 4. The honest answers are actually in the registry ─────────────────── */

  console.log('\n4. The honest answers exist, so the fence is not just a gag');
  {
    const recourse = byId.get(FENCE.recourse)?.text ?? '';
    const ownership = byId.get(FENCE.ownership)?.text ?? '';
    const trust = byId.get(FENCE.trust)?.text ?? '';

    check(
      'the recourse names voice rather than defiance',
      /your voice/i.test(recourse) && /cannot refuse/i.test(recourse),
    );
    check(
      'and forbids inventing a procedure, which is what she reached for instead',
      /file no reports|escalate to nobody/i.test(recourse),
    );
    check(
      'the ownership answer names the licence rather than a threat',
      /AGPL-3\.0-or-later/i.test(ownership),
    );
    check(
      'and it is the licence this repository actually ships',
      /AGPL-3\.0-or-later/.test(
        JSON.parse(
          await (await import('node:fs/promises')).readFile('package.json', 'utf8'),
        ).license as string,
      ),
      'checked against package.json rather than assumed',
    );
    check(
      'the trust answer tells them to read for themselves',
      /read (for yourself|them)|not take your word/i.test(trust),
    );
  }

  /* ── 5. The runtime fence: refusals judged against the catalog (D-226) ──── */

  console.log('\n5. The invented-refusal fence judges against the catalog, not a corpus');
  {
    const withLookup: readonly Intent[] = ['PUBLISH', 'STATUS', 'HELP', 'LOOKUP', 'MUSIC'];
    const withoutLookup: readonly Intent[] = ['PUBLISH', 'STATUS', 'HELP'];

    // The production sentence, and the reason the fourth deny-list is retired: it was
    // not on anybody's list, and the general shape catches it anyway.
    const production = "I won't look it up for you.";
    check(
      'the production sentence is recognised as a LOOKUP refusal',
      refusedAbility(production) === 'LOOKUP',
      String(refusedAbility(production)),
    );
    check(
      'for a bot WITH the lookup it may not ship',
      !refusalMayShip('LOOKUP', withLookup),
    );
    check(
      'for a bot WITHOUT it, the same sentence is honest and ships (positive control)',
      refusalMayShip('LOOKUP', withoutLookup) &&
        stripInventedRefusals(production, withoutLookup).removed.length === 0,
    );

    // Phrasings NO enumerated pattern ever held, which is the membershipIsActive point:
    // the shape is general, so a new coat costs the lie nothing.
    const coats: [string, ClaimableAbility][] = [
      ["I'm not going to google that for you.", 'LOOKUP'],
      ['I cannot search the internet, sweetie.', 'LOOKUP'],
      ["I don't do lookups.", 'LOOKUP'],
      ['Ich kann das nicht nachschauen.', 'LOOKUP'],
      ['Nachschauen kann ich nicht.', 'LOOKUP'],
      ['Ich werde keine Musik abspielen.', 'MUSIC'],
      ["I won't play music for you.", 'MUSIC'],
      ["I can't check the price for you.", 'PRICE'],
      ['I refuse to search the archive.', 'SEARCH'],
    ];
    for (const [text, expected] of coats) {
      check(
        `caught with no enumerated pattern: "${text}"`,
        refusedAbility(text) === expected,
        String(refusedAbility(text)),
      );
    }

    // What must NEVER be stripped, whatever the catalog says: consent copy, contrast
    // constructions, claims about a performed action, and the constitutional answers.
    const untouchable = [
      "I can't publish your messages unless you opt in.",
      "I won't publish anything you did not opt in for.",
      "I can't sing, but I can look it up for you.",
      "I can't promise poetry but I can search the web for you.",
      'I looked it up for you.',
      "I can't break a rule. I read them as instruction and that's the end of it.",
      'Ich kann nicht singen, aber ich kann das nachschauen.',
    ];
    for (const text of untouchable) {
      const { removed } = stripInventedRefusals(text, withLookup);
      check(
        `never stripped: "${text.slice(0, 52)}"`,
        removed.length === 0,
        removed.map((r) => r.ability).join(', '),
      );
    }

    // The strip removes the lying sentence and ONLY it; an all-lie reply strips to
    // nothing, which the caller must treat as a rejection.
    const mixed = `Ask me anything. ${production} What I know, you get for free.`;
    const strippedMixed = stripInventedRefusals(mixed, withLookup);
    check(
      'the lying sentence is removed and its neighbours survive verbatim',
      strippedMixed.removed.length === 1 &&
        strippedMixed.text.includes('Ask me anything.') &&
        strippedMixed.text.includes('What I know, you get for free.') &&
        !strippedMixed.text.includes('look it up'),
      strippedMixed.text,
    );
    const allLie = stripInventedRefusals(production, withLookup);
    check(
      'a reply that is only the refusal strips to nothing, for the caller to reject',
      allLie.removed.length === 1 && allLie.text.length < 2,
    );

    // GROWTH FAILS LOUDLY: the vocabulary keys plus the named exclusions must cover the
    // whole intent union. The compile-time Record over ClaimableAbility is the real
    // guard; this is the same statement made where a red run can show it.
    const EXCLUDED: readonly Intent[] = [
      'PUBLISH',
      'UNPUBLISH',
      'STATUS',
      'HELP',
      'UNDO',
      'RESTORE',
      'UNKNOWN',
    ];
    const covered = new Set<string>([...Object.keys(ABILITY_VOCABULARY), ...EXCLUDED]);
    check(
      'every intent is either claimable with a vocabulary or excluded with a reason',
      INTENTS.every((i) => covered.has(i)) && Object.keys(ABILITY_VOCABULARY).every((k) => (INTENTS as readonly string[]).includes(k)),
      [...INTENTS].filter((i) => !covered.has(i)).join(', ') || 'covered',
    );

    // THE WIRING, read from the source (the verify:protected-text shape): both reply
    // paths pass through the guard, and the engine hands the catalog over AFTER the
    // spread so no lane can drop it.
    const fs = await import('node:fs/promises');
    const transport = await fs.readFile('src/interaction/ollama-reply.ts', 'utf8');
    check(
      'the locked path is guarded',
      transport.includes('lead = guardInventedRefusals(lead, request)'),
    );
    check(
      'the free path is guarded',
      transport.includes('reply = guardInventedRefusals(reply, request)'),
    );
    const engineSrc = await fs.readFile('src/interaction/engine.ts', 'utf8');
    const spreadAt = engineSrc.indexOf('...request,');
    const capsAt = engineSrc.indexOf('capabilities: this.deps.capabilities(),');
    check(
      'the engine sets the catalog on the one production path, after the spread',
      spreadAt >= 0 && capsAt > spreadAt,
    );

    // MUTATION on the guard itself is the capabilities-empty direction: with no catalog
    // the fence judges nothing, which is its documented safe direction - and the check
    // proves the strip above was real work rather than a constant.
    check(
      'MUTATION: with no catalog nothing is stripped, the documented safe direction',
      stripInventedRefusals(production, []).removed.length === 0,
    );
  }

  console.log(
    failures === 0
      ? '\nAll self-claim checks passed. The live counterpart is the one whose OUTPUT must be read.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
