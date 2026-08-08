/**
 * Onboarding acts on the bot the operator selected (CCB-S5-007).
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * Every admin action took an OPTIONAL `botProfileId` and `pick()` fell back to
 * `host.primary` when it was absent. The onboarding console passed it to none of them. So
 * the database write was per bot and the SimpleX call was not: accepting a contact for bot
 * B recorded it against B and accepted it as A, on A's real profile.
 *
 * Three of the four steps had no guard at all. The fourth, `create-address`, refused unless
 * the bot was the primary, which masked the problem for that one step and made onboarding a
 * second bot impossible, which is what the briefing exists to fix.
 *
 * ── WHAT IS ASSERTED, AND WHERE THE REAL GUARANTEE LIVES ─────────────────────
 *
 * The real guarantee is the TYPE: `botProfileId` is required, so a step that does not name a
 * bot does not compile. That cannot be asserted at runtime, so it is asserted at the source:
 * every call site in the console passes one. What IS driven here is the behaviour, against a
 * host holding two bots, with the other bot as the positive control in every case: an
 * assertion that a call acted as bot 2 is worth nothing unless calling for bot 1 acts as
 * bot 1.
 *
 *   npx tsx scripts/verify-onboarding-per-bot.ts
 */

import { readFile } from 'node:fs/promises';
import {
  acceptContactRequest,
  createOrShowBotAddress,
  joinInvitedGroup,
  rejectContactRequest,
  setRuntimeAdminHandle,
} from '../src/bot/runtime/admin-actions.js';
import type { RuntimeHost } from '../src/bot/runtime/host.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** Which bot ran the last scheduled command, and which SimpleX user the core was asked for. */
const ran: { bot: string[]; userIds: number[] } = { bot: [], userIds: [] };

function fakeBot(botProfileId: number, displayName: string, simplexUserId: number): unknown {
  return {
    config: { botProfileId, displayName, slug: displayName.toLowerCase() },
    simplexUserId,
    user: { userId: simplexUserId, profile: { displayName } },
    runScheduled: async <R>(_label: string, fn: () => Promise<R>): Promise<R> => {
      // The whole mechanism: `apiAcceptContactRequest`, `apiRejectContactRequest` and
      // `apiJoinGroup` take NO user id and execute as whichever profile is ACTIVE, so the
      // only thing making them act as the right bot is which bot's scheduler ran them.
      ran.bot.push(displayName);
      return await fn();
    },
  };
}

/** A core that records which user id it was asked about and answers plausibly. */
const chat = {
  apiGetUserAddress: (userId: number) => {
    ran.userIds.push(userId);
    return Promise.resolve(null);
  },
  apiCreateUserAddress: (userId: number) => {
    ran.userIds.push(userId);
    return Promise.resolve({ connFullLink: 'https://simplex.example.invalid/contact#/fake' });
  },
  apiAcceptContactRequest: () =>
    Promise.resolve({ contactId: 7, localDisplayName: 'someone', profile: {} }),
  apiRejectContactRequest: () => Promise.resolve(undefined),
  apiJoinGroup: () =>
    Promise.resolve({ groupId: 4, localDisplayName: 'a group', membership: { memberRole: 'admin' } }),
};

function hostWithTwoBots(): RuntimeHost {
  const bots = [fakeBot(1, 'CIND3R3LLA', 11), fakeBot(2, 'Aurora', 22)];
  return {
    runtime: { state: 'ready' },
    chat,
    bots,
    primary: bots[0],
    whenReady: () => Promise.resolve(),
    close: () => Promise.resolve(),
  } as unknown as RuntimeHost;
}

async function main(): Promise<void> {
  setLogLevel('error');
  setRuntimeAdminHandle(hostWithTwoBots());

  console.log('\n1. Every step acts as the bot it was given, and its control acts as the other');

  const step = async (
    label: string,
    forSecond: () => Promise<unknown>,
    forFirst: () => Promise<unknown>,
  ): Promise<void> => {
    ran.bot.length = 0;
    await forSecond();
    const asSecond = [...new Set(ran.bot)];
    ran.bot.length = 0;
    await forFirst();
    const asFirst = [...new Set(ran.bot)];
    check(
      `${label} runs as the bot it was given`,
      asSecond.length === 1 && asSecond[0] === 'Aurora',
      asSecond.join(', ') || '(nothing ran)',
    );
    // THE CONTROL. Without it, an implementation that always ran as Aurora would pass above.
    check(
      `  CONTROL: and as the OTHER bot when it is given that one`,
      asFirst.length === 1 && asFirst[0] === 'CIND3R3LLA',
      asFirst.join(', ') || '(nothing ran)',
    );
  };

  await step(
    'create-address',
    () => createOrShowBotAddress(2),
    () => createOrShowBotAddress(1),
  );
  check(
    'and it asks the core about THAT bot\'s SimpleX user, not the primary\'s',
    ran.userIds.includes(22) && ran.userIds.includes(11),
    ran.userIds.join(', '),
  );
  await step(
    'accept-contact',
    () => acceptContactRequest(5, 2),
    () => acceptContactRequest(5, 1),
  );
  await step(
    'reject-contact',
    () => rejectContactRequest(5, 2),
    () => rejectContactRequest(5, 1),
  );
  await step(
    'join-group',
    () => joinInvitedGroup(4, 2),
    () => joinInvitedGroup(4, 1),
  );

  console.log('\n2. A bot that is not hosted is refused, never silently swapped for the primary');
  {
    ran.bot.length = 0;
    let refused = '';
    await createOrShowBotAddress(99).catch((err: unknown) => {
      refused = err instanceof Error ? err.message : String(err);
    });
    check(
      'an unhosted bot id raises rather than falling back',
      refused.includes('99') && refused.toLowerCase().includes('not currently hosted'),
      refused.slice(0, 90) || '(it did not raise)',
    );
    /**
     * MUTATION: the shape that shipped. `pick` returned `host.primary` for an absent id, so
     * a step with no bot ran as the primary and nothing said so. If that were still true this
     * would have executed as CIND3R3LLA instead of raising.
     */
    check(
      'MUTATION: and it ran as NOBODY, where the old fallback would have run as the primary',
      ran.bot.length === 0,
      ran.bot.join(', ') || '(nothing ran, which is right)',
    );
  }

  console.log('\n3. The console names a bot at every call site');
  {
    /**
     * The type makes this impossible to get wrong, and the type is the guarantee. This reads
     * the source anyway, because the guarantee is only as good as the signature staying
     * required, and a later optional parameter would restore the defect silently.
     */
    const source = await readFile('src/web/views/ai-onboarding.ts', 'utf8');
    const calls = [
      /createOrShowBotAddress\(([^)]*)\)/g,
      /acceptContactRequest\(([^)]*)\)/g,
      /rejectContactRequest\(([^)]*)\)/g,
      /joinInvitedGroup\(([^)]*)\)/g,
    ];
    const bare: string[] = [];
    let found = 0;
    for (const re of calls) {
      for (const m of source.matchAll(re)) {
        const args = (m[1] ?? '').trim();
        if (args.length === 0) continue; // an import or a type position, not a call
        found++;
        if (!args.includes('profileId')) bare.push(m[0]);
      }
    }
    check('the four actions are called from the console', found >= 4, `${String(found)} call(s)`);
    check(
      'and every call names the selected profile',
      bare.length === 0,
      bare.join(' | ') || 'none bare',
    );

    const actions = await readFile('src/bot/runtime/admin-actions.ts', 'utf8');
    check(
      'the signatures are REQUIRED, so a call with no bot does not compile',
      !/botProfileId\?: number/.test(
        actions.slice(actions.indexOf('export async function createOrShowBotAddress')),
      ),
    );
    check(
      'and `pick` no longer falls back to the primary',
      !/if \(botProfileId === undefined\) return host\.primary;/.test(actions),
    );
  }

  setRuntimeAdminHandle(null);
  console.log(
    failures === 0
      ? '\nAll onboarding-per-bot checks passed: every step acts as the bot it was given.'
      : `\n${String(failures)} CHECK(S) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
