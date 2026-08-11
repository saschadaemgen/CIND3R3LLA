/**
 * More than one of her (CCB-S5-001, D-155).
 *
 * The three things the briefing asks to be PROVEN rather than asserted, and one it asks to
 * be impossible:
 *
 *   1. Per-bot state is genuinely per bot: memory, moderation counters and rate limits do
 *      not merge when two bots answer at the same time.
 *   2. A standard law can be on for one bot and off for another, and reworded for a third.
 *   3. A constitutional law cannot be set per bot, at any layer.
 *   4. The scope of every law is readable: shared, per bot, or constitutional.
 *
 * And one CCB-S5-027 added (D-182), because production found it: a slash command names no
 * bot, so every hosted bot in the group runs it. Exactly one now answers, the election is
 * derivable by all of them from one index, and the stand-down is driven through the real
 * engine and the real consent handler rather than left as a computable predicate.
 *
 * Mutation-proven where it matters, because each of these passes trivially against an
 * implementation that does nothing: a counter check passes if nothing is ever counted, and
 * an isolation check passes if neither bot ever answers. Every guarantee here has a
 * positive control beside it that goes red when the guarantee is removed.
 *
 *   npx tsx scripts/verify-multi-bot.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import {
  clearOverride,
  listAllOverrides,
  listOverridesForBot,
  setOverride,
} from '../src/db/prompt-rule-overrides.js';
import {
  applyOverrides,
  canOverride,
  describeScopes,
  CONSTITUTIONAL_SCOPE_REASON,
} from '../src/interaction/rule-scope.js';
import { countViolations, recordViolation } from '../src/moderation/store.js';
import { ConversationState } from '../src/interaction/state.js';
import { GroupOwnership, UnknownGroupOwnerError } from '../src/bot/runtime/ownership.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { makeConsentHandler } from '../src/consent/commands.js';
import { CORE_INTENTS } from '../src/interaction/intent.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import type { CapturedMessage } from '../src/capture/message.js';
import { resolveProfileSpecs, type ProfileDirectory } from '../src/bot/runtime/profiles.js';
import { toRuntimeSpecs, type HostedBotConfig } from '../src/profiles/hosted-bots.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** Two bots with opposite dials, which is the arrangement the briefing asks to see. */
async function seedTwoBots(db: Queryable): Promise<{ sharp: number; warm: number }> {
  const { rows } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO cinderella_bot_profiles
       (slug, display_name, enabled,
        axis_sharpness, axis_warmth, axis_humor, axis_verbosity, axis_permissiveness)
     VALUES
       ('sharp-bot', 'SharpBot', TRUE, 10, 1, 9, 8, 7),
       ('warm-bot',  'WarmBot',  TRUE,  1, 10, 2, 3, 2)
     RETURNING id, slug`,
  );
  const bySlug = new Map(rows.map((r) => [r.slug, Number(r.id)]));
  const sharp = bySlug.get('sharp-bot');
  const warm = bySlug.get('warm-bot');
  if (sharp === undefined || warm === undefined) throw new Error('seed failed');
  return { sharp, warm };
}

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
  // `exec`, not `query`: a migration is many statements and `query` takes one.
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);
  const { sharp, warm } = await seedTwoBots(db);

  /* ── 1. Which bot owns which group ─────────────────────────────────────── */

  console.log('\n1. A group belongs to exactly one bot');
  {
    const own = new GroupOwnership();
    own.adopt(101, [
      { groupId: 5, localDisplayName: 'cyberpunk', sharedKey: 'pub:AAA' },
      { groupId: 6, localDisplayName: 'lounge', sharedKey: null },
    ]);
    own.adopt(202, [{ groupId: 9, localDisplayName: 'support', sharedKey: 'pub:BBB' }]);

    check('a group id resolves to its own bot', own.owner(5) === 101 && own.owner(9) === 202);
    check(
      'a group nobody hosts resolves to nobody, rather than to whoever is active',
      own.owner(77) === undefined,
    );
    check(
      'refusing to route names the group and says why guessing is worse',
      new UnknownGroupOwnerError(77).message.includes('succeed silently while doing nothing'),
    );

    // Re-adopting REPLACES that bot's entries. A bot that left a group must lose it, or
    // an erasure would be routed at a group it can no longer act in.
    own.adopt(101, [{ groupId: 5, localDisplayName: 'cyberpunk', sharedKey: 'pub:AAA' }]);
    check('a bot that leaves a group loses it from the index', own.owner(6) === undefined);
    check('and the other bot is untouched by that refresh', own.owner(9) === 202);

    // Co-tenancy: same real group, two profiles, two different core group ids.
    own.adopt(202, [
      { groupId: 9, localDisplayName: 'support', sharedKey: 'pub:BBB' },
      { groupId: 12, localDisplayName: 'cyberpunk', sharedKey: 'pub:AAA' },
    ]);
    const shared = own.sharedGroups();
    check(
      'two bots in ONE real group are detected through the shared key, not the group id',
      shared.length === 1 && shared[0]?.members.length === 2,
      shared[0] ? `group ids ${shared[0].members.map((m) => m.groupId).join(' and ')}` : '',
    );
    check(
      'a group with no shared identity is reported as unknown, never as "not shared"',
      own.unidentifiedGroups().length === 0 &&
        own.sharedGroups().every((g) => g.sharedKey.length > 0),
    );

    /* ── ONE BOT ANSWERS A COMMAND THAT NAMES NOBODY (CCB-S5-027, D-182) ── */
    //
    // `/search`, `/help`, `/publish` and `/unpublish` carry no wake word, so every bot in
    // the group runs them. Production answered one `/search` twice with two different
    // counts, and the same shape on `/publish` would put two actors on the consent path.
    check(
      'in a shared group exactly one of the two answers a command that names nobody',
      [own.answersCommands(5), own.answersCommands(12)].filter(Boolean).length === 1,
      `group 5 -> ${String(own.answersCommands(5))}, group 12 -> ${String(own.answersCommands(12))}`,
    );
    check(
      '  and it is the lowest SimpleX user id, which every bot computes the same way',
      own.answersCommands(5) && !own.answersCommands(12),
    );
    // POSITIVE CONTROL. An election that answered no to everything satisfies "exactly one"
    // only by accident of the pair above; a bot alone in its group must always answer.
    check(
      'a bot alone in a group always answers',
      own.answersCommands(9),
    );
    check(
      'an unknown shared key answers YES rather than going silent on a consent command',
      (() => {
        const solo = new GroupOwnership();
        solo.adopt(101, [{ groupId: 42, localDisplayName: 'lounge', sharedKey: null }]);
        solo.adopt(202, [{ groupId: 43, localDisplayName: 'lounge', sharedKey: null }]);
        return solo.answersCommands(42) && solo.answersCommands(43);
      })(),
    );
    check(
      'and so does a group the index has never heard of',
      own.answersCommands(9999),
    );
    // MUTATION: the election must follow the SHARED KEY, not the group id. Swapping which
    // profile holds the lower id must move the answer.
    check(
      'MUTATION: the elected bot moves when the lower id moves',
      (() => {
        const flipped = new GroupOwnership();
        flipped.adopt(300, [{ groupId: 5, localDisplayName: 'cyberpunk', sharedKey: 'pub:AAA' }]);
        flipped.adopt(202, [{ groupId: 12, localDisplayName: 'cyberpunk', sharedKey: 'pub:AAA' }]);
        return !flipped.answersCommands(5) && flipped.answersCommands(12);
      })(),
    );
  }

  /* ── 2. Two bots never resolve to one SimpleX profile ──────────────────── */

  console.log('\n2. One SimpleX profile cannot carry two characters');
  {
    const users = [
      { user: { userId: 1, profile: { displayName: 'SharpBot' } } },
      { user: { userId: 2, profile: { displayName: 'WarmBot' } } },
    ];
    const dir: ProfileDirectory = {
      listUsers: async () => users as never,
      getActiveUser: async () => users[0]?.user as never,
      createUser: async (p) => ({ userId: 99, profile: p }) as never,
    };

    const bots: HostedBotConfig[] = [
      { botProfileId: sharp, slug: 'sharp-bot', displayName: 'SharpBot', simplexUserId: null, avatarPath: null },
      { botProfileId: warm, slug: 'warm-bot', displayName: 'WarmBot', simplexUserId: null, avatarPath: null },
    ];
    //  since CCB-S5-012: false here, which is this section's premise (two fresh
    // bots, nothing bound), and the case  owns in full.
    // `anyBound` since CCB-S5-012. False here, which is this section's own premise: two
    // fresh bots with nothing bound. Every other combination is `verify:adoption`'s.
    const specs = toRuntimeSpecs(bots, false);
    check(
      'exactly one unbound bot adopts the active user; the rest create',
      specs[0]?.adopt === 'activeUser' && specs[1]?.adopt === 'create',
      `${String(specs[0]?.adopt)} then ${String(specs[1]?.adopt)}`,
    );

    const resolved = await resolveProfileSpecs(specs, dir);
    check(
      'so the two bots land on two different SimpleX profiles',
      resolved[0]?.user.userId !== resolved[1]?.user.userId,
      `${String(resolved[0]?.user.userId)} and ${String(resolved[1]?.user.userId)}`,
    );

    // MUTATION: hand both specs the adoption and the resolver must refuse.
    let refused = '';
    try {
      await resolveProfileSpecs(
        [
          { displayName: 'SharpBot', adopt: 'activeUser' },
          { displayName: 'WarmBot', adopt: 'activeUser' },
        ],
        dir,
      );
    } catch (err) {
      refused = err instanceof Error ? err.message : String(err);
    }
    check(
      'two bots adopting the same profile is refused, not silently hosted twice',
      refused.includes('both resolved to SimpleX user'),
      refused.slice(0, 70),
    );
  }

  /* ── 3. Moderation counters are per bot ────────────────────────────────── */

  console.log('\n3. Two bots never share a moderation counter');
  {
    // The real clock, because the rows are written with `now()`. A fixed date here would
    // put the window's cutoff in the future of every row and count nothing, which reads
    // as isolation and is actually an empty result.
    const at = new Date();
    const groupId = 5;
    const memberId = 'member-abc';
    const type = 'nickname' as const;

    // Both bots see the same member misbehave, in what is for this test the same chat.
    for (const botProfileId of [sharp, sharp, sharp, warm]) {
      await recordViolation(db, {
        botProfileId,
        groupId,
        memberId,
        memberDisplayName: 'Someone',
        memberRole: 'member',
        type,
      });
    }

    const sharpCount = await countViolations(db, { botProfileId: sharp, groupId, memberId, type }, 3600, at);
    const warmCount = await countViolations(db, { botProfileId: warm, groupId, memberId, type }, 3600, at);
    check('each bot counts only what it saw', sharpCount === 3 && warmCount === 1, `${sharpCount} and ${warmCount}`);

    // POSITIVE CONTROL: without the bot dimension the two would add up to four, so a
    // check that merely saw "3" could be passing on an empty table.
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM cinderella_violations
        WHERE group_id = $1 AND member_id = $2 AND type = $3`,
      [groupId, memberId, type],
    );
    check(
      'and the rows really are all there, so the split is a split and not an empty table',
      Number(rows[0]?.n) === 4,
      `${String(rows[0]?.n)} rows total`,
    );
    check(
      'MUTATION: counting without the bot dimension merges them, which is the defect',
      Number(rows[0]?.n) === sharpCount + warmCount && Number(rows[0]?.n) !== sharpCount,
    );
  }

  /* ── 4. Conversation state and reply budgets are per bot ───────────────── */

  console.log('\n4. Two bots never share a follow-up window or a reply budget');
  {
    // Each bot's engine builds its own. The isolation is structural: two instances.
    const sharpState = new ConversationState();
    const warmState = new ConversationState();
    const groupId = 5;
    const memberId = 'member-abc';
    const now = 1_770_000_000_000;

    sharpState.openFollowUp(groupId, memberId, now, 120_000);
    check(
      'a follow-up window opened by one bot is not open on the other',
      sharpState.inFollowUp(groupId, memberId, now + 1000) &&
        !warmState.inFollowUp(groupId, memberId, now + 1000),
    );

    // Spend one bot's per-chat reply budget entirely, then check the other still has one.
    const PER_MEMBER = 3;
    const PER_CHAT = 5;
    let spent = 0;
    for (let i = 0; i < 20; i++) {
      if (sharpState.allowReply(groupId, memberId, now + i, PER_MEMBER, PER_CHAT)) spent++;
    }
    check(
      'one bot spends its own reply budget and then goes quiet',
      spent === PER_MEMBER,
      `${spent} of ${PER_MEMBER} allowed`,
    );
    check(
      'and the other bot still has its full budget, so a busy group cannot mute a quiet bot',
      warmState.allowReply(groupId, memberId, now + 21, PER_MEMBER, PER_CHAT),
    );
    check(
      'CONTROL: the exhausted bot really is exhausted, so the check above is not vacuous',
      !sharpState.allowReply(groupId, memberId, now + 21, PER_MEMBER, PER_CHAT),
    );
  }

  /* ── 5. A standard law, on for one bot and off for another ─────────────── */

  console.log('\n5. A standard law can differ per bot');
  {
    const rules = await listPromptRules(db);
    const standard = rules.find((r) => r.tier === 'standard' && r.enabled);
    if (!standard) throw new Error('no enabled standard rule in the registry to test with');

    // Off for WarmBot, reworded for SharpBot: the two deviations the briefing names,
    // through the one mechanism.
    await setOverride(db, { botProfileId: warm, ruleId: standard.id, enabled: false, text: null });
    await setOverride(db, {
      botProfileId: sharp,
      ruleId: standard.id,
      enabled: null,
      text: 'Swearing is permitted and expected when the point warrants it.',
    });

    const sharpBook = applyOverrides(rules, await listOverridesForBot(db, sharp));
    const warmBook = applyOverrides(rules, await listOverridesForBot(db, warm));
    const inSharp = sharpBook.find((r) => r.id === standard.id);
    const inWarm = warmBook.find((r) => r.id === standard.id);

    check(
      'the law is ON for one bot and OFF for the other',
      inSharp?.enabled === true && inWarm?.enabled === false,
    );
    check(
      'and reworded for the one that reworded it',
      inSharp?.text === 'Swearing is permitted and expected when the point warrants it.',
    );
    check(
      'while the bot that only switched it off still tracks the SHARED wording',
      inWarm?.text === standard.text,
      'a deviation on `enabled` does not freeze a copy of the text',
    );
    check(
      'the shared registry itself is untouched, so the law is still one row',
      (await listPromptRules(db)).find((r) => r.id === standard.id)?.text === standard.text,
    );

    // Everything that is NOT overridable stays put: those are contracts the assembler
    // implements in code, and a per-bot value for any of them would be a per-bot change
    // to how the prompt is BUILT.
    check(
      'the tier, lane, condition and order are the same for both bots',
      inSharp?.tier === standard.tier &&
        inSharp?.lane === standard.lane &&
        inSharp?.appliesWhen === standard.appliesWhen &&
        inSharp?.ord === standard.ord &&
        inWarm?.ord === standard.ord,
    );

    // Reverting puts a bot back on the shared law rather than on a copy of it.
    await clearOverride(db, sharp, standard.id);
    const reverted = applyOverrides(rules, await listOverridesForBot(db, sharp));
    check(
      'clearing a deviation puts that bot back on the shared law',
      reverted.find((r) => r.id === standard.id)?.text === standard.text,
    );
  }

  /* ── 6. A constitutional law cannot be set per bot ─────────────────────── */

  console.log('\n6. A constitutional law is shared, and cannot be made per bot');
  {
    const rules = await listPromptRules(db);
    const constitutional = rules.find((r) => r.tier === 'constitutional');
    if (!constitutional) throw new Error('no constitutional rule in the registry');

    check('the pure gate refuses it', !canOverride(constitutional));
    check(
      'and says why, rather than just refusing',
      CONSTITUTIONAL_SCOPE_REASON.includes('nobody can say what any of them will refuse'),
    );

    // The DATABASE refuses it too, which is the layer that holds when the other two are
    // bypassed. This is the check the briefing asks for by name.
    let dbRefused = '';
    try {
      await setOverride(db, {
        botProfileId: warm,
        ruleId: constitutional.id,
        enabled: false,
        text: null,
      });
    } catch (err) {
      dbRefused = err instanceof Error ? err.message : String(err);
    }
    check(
      'the database trigger refuses it even with the application gate bypassed',
      dbRefused.includes('constitutional') && dbRefused.includes('cannot be set per bot'),
      dbRefused.slice(0, 80),
    );

    // MUTATION: even if a row somehow existed, the assembler ignores it. Proven by
    // handing applyOverrides an override the database would never have stored.
    const forced = applyOverrides(rules, [
      { botProfileId: warm, ruleId: constitutional.id, enabled: false, text: 'anything' },
    ]);
    const still = forced.find((r) => r.id === constitutional.id);
    check(
      'MUTATION: a forged constitutional override changes nothing in the assembled rulebook',
      still?.enabled === constitutional.enabled && still?.text === constitutional.text,
    );

    // POSITIVE CONTROL: the same forced shape DOES take effect on a standard rule, so
    // the check above is proving a refusal rather than a no-op function.
    const standard = rules.find((r) => r.tier === 'standard');
    if (standard) {
      const changed = applyOverrides(rules, [
        { botProfileId: warm, ruleId: standard.id, enabled: false, text: null },
      ]);
      check(
        'CONTROL: the same forged shape does take effect on a standard law',
        changed.find((r) => r.id === standard.id)?.enabled === false,
      );
    }
  }

  /* ── 7. Every law's scope is readable ──────────────────────────────────── */

  console.log('\n7. It is always visible which is which');
  {
    const rules = await listPromptRules(db);
    const overrides = await listAllOverrides(db);
    const scopes = describeScopes(rules, overrides, 2);

    const constitutional = rules.find((r) => r.tier === 'constitutional');
    const deviating = overrides[0];
    check(
      'a constitutional law reads as constitutional, never as merely shared',
      constitutional !== undefined && scopes.get(constitutional.id)?.kind === 'constitutional',
    );
    check(
      'a law one bot deviates from reads as per-bot',
      deviating !== undefined && scopes.get(deviating.ruleId)?.kind === 'per-bot',
    );
    check(
      'and names which bots deviate, and how',
      (() => {
        if (!deviating) return false;
        const s = scopes.get(deviating.ruleId);
        return s?.deviations.some((d) => d.botProfileId === deviating.botProfileId && d.off) === true;
      })(),
    );
    check(
      'a law nobody deviates from reads as shared, reaching every bot',
      (() => {
        const untouched = rules.find(
          (r) => r.tier === 'standard' && !overrides.some((o) => o.ruleId === r.id),
        );
        const s = untouched ? scopes.get(untouched.id) : undefined;
        return s?.kind === 'shared' && s.sharedBotCount === 2;
      })(),
    );
    check(
      'the shared count EXCLUDES the bots that deviate, so an edit warning cannot overstate',
      (() => {
        if (!deviating) return false;
        const s = scopes.get(deviating.ruleId);
        return s?.sharedBotCount === 1;
      })(),
      'a law one of two bots reworded reaches one bot, not two',
    );
    check(
      'every law in the registry has a scope, so none can render without one',
      rules.every((r) => scopes.has(r.id)),
      `${String(scopes.size)} of ${String(rules.length)}`,
    );
  }

  /* ── 8. The election is WIRED, not merely computable ────────────────────── */

  console.log('\n8. The stand-down reaches the two paths that act');

  {
    // D-162 and D-178 between them say it twice: a predicate a check can compute is not a
    // control the product uses. Section 1 proved the election; this drives it through the
    // real engine and the real consent handler.
    const interaction = normalizeInteraction({ ...DEFAULT_INTERACTION });
    const makeEngine = (answers: boolean, sent: string[]): InteractionEngine =>
      new InteractionEngine({
        capabilities: () => [...CORE_INTENTS],
        db,
        settings: () => interaction,
        rules: () => [],
        answersGroupCommands: () => answers,
        send: (_msg, text) => {
          sent.push(text);
          return Promise.resolve();
        },
      });

    const slash = (): CapturedMessage =>
      ({
        groupId: 5,
        groupName: 'cyberpunk',
        itemId: 900,
        sharedMsgId: undefined,
        senderMemberId: 'alice',
        senderDisplayName: 'Alice',
        sentAt: new Date().toISOString(),
        type: 'text',
        text: '/search openssl',
        linkPreview: undefined,
        file: undefined,
        forwarded: false,
        quotedFromBot: false,
        raw: {} as never,
      }) as CapturedMessage;

    const spoke: string[] = [];
    const quiet: string[] = [];
    const spokeHandled = await makeEngine(true, spoke).handle(slash());
    const quietHandled = await makeEngine(false, quiet).handle(slash());

    check('the elected bot answers /search', spokeHandled && spoke.length === 1, spoke[0] ?? '');
    check('the other one says nothing', quietHandled && quiet.length === 0, quiet.join(' | '));
    check(
      '  but still reports the message as handled, so its category is written and a member ' +
        'search request cannot publish as ordinary chat',
      quietHandled,
    );

    // CONSENT. The handler reaches `getPool()` as its first act, so a harness with no
    // configured database can tell the two cases apart by observation alone: standing down
    // touches nothing and says nothing, and acting reaches for the database immediately.
    // That is the difference the guard makes, and it is what makes the negative meaningful.
    const consentSends: string[] = [];
    const drive = async (answers: boolean): Promise<'acted' | 'stood down'> => {
      const handler = makeConsentHandler(undefined, undefined, {
        send: (_msg, text) => {
          consentSends.push(text);
          return Promise.resolve();
        },
        answersCommands: () => answers,
      });
      try {
        await handler({ ...slash(), text: '/publish' } as CapturedMessage, 'publish');
      } catch {
        return 'acted';
      }
      return consentSends.length > 0 ? 'acted' : 'stood down';
    };

    check('an unelected bot does not act on /publish at all', (await drive(false)) === 'stood down');
    check(
      '  and the elected one does, so the stand-down is the guard and not an inert handler',
      (await drive(true)) === 'acted',
    );
  }

  console.log(
    failures === 0
      ? '\nAll multi-bot checks passed: two bots, isolated state, per-bot laws, shared constitution.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
