/**
 * Different bots, different capabilities (CCB-S5-021, D-175).
 *
 * Plugin state lived under a single `plugins` settings key, so enabling Web Search enabled
 * it for EVERY hosted bot. This proves the four things the briefing asks to be proven rather
 * than asserted, and one it asks to be impossible:
 *
 *   1. The INVENTORY is complete: every registered plugin is placed, every key of every
 *      plugin's settings document is placed, and the database's CHECK agrees with it.
 *   2. INHERITANCE: a bot with no row of its own follows the deployment, so nothing on the
 *      existing deployment changes.
 *   3. The ABSENT-CAPABILITY property, PER BOT: a bot the plugin is off for does not refuse
 *      a lookup, it cannot produce one. Proven at all three layers the property has - the
 *      rule engine, the model's own vocabulary, and the resolver seam - and then driven end
 *      to end through the real engine with a spy on the search port.
 *   4. The BUDGET is spent per bot, so a busy bot cannot starve a quiet one.
 *   5. A DEPLOYMENT-WIDE setting cannot be set for one bot, at either layer.
 *
 * ── EVERY GUARANTEE HAS A POSITIVE CONTROL, AND THE MUTATIONS ARE REAL ──────
 *
 * "Bot B cannot reach a search" passes trivially against an implementation where nobody can
 * search, and "the budgets do not merge" passes if nothing is ever counted. So every
 * negative assertion here has the same probe run against the bot that DOES have the
 * capability, and section 7 restores the shipped defect - the deployment's catalog in place
 * of the bot's, and the bot-less rate-limit key - and shows the checks going red.
 *
 *   npx tsx scripts/verify-plugin-scope.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { T } from '@simplex-chat/types';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { alwaysRelevant } from './relevance-stub.js';
import { setLogLevel } from '../src/log.js';
import { PluginService } from '../src/plugins/service.js';
import {
  activePluginIntents,
  isPluginEnabled,
  listPlugins,
  normalizePluginStates,
} from '../src/plugins/registry.js';
import {
  applyPluginOverrides,
  describePluginScopes,
  ENABLED_KEY,
  expectedPluginSettingKeys,
  isPerBotPluginSetting,
  PLUGIN_SETTING_SCOPES,
  placementOf,
  sharedPluginReason,
} from '../src/plugins/scope.js';
import {
  DeploymentWidePluginSettingError,
  listAllPluginOverrides,
  listPluginOverridesForBot,
  perBotPluginKeysAcceptedByDatabase,
  setPluginOverride,
} from '../src/db/plugin-overrides.js';
import { WEB_SEARCH_ID } from '../src/plugins/web-search/plugin.js';
import { CRYPTO_PRICES_ID } from '../src/plugins/crypto-prices/plugin.js';
import { WebSearchService } from '../src/plugins/web-search/service.js';
import {
  normalizeWebSearchSettings,
  WEB_SEARCH_DEFAULTS,
} from '../src/plugins/web-search/settings.js';
import { capabilityCatalog, type Intent } from '../src/interaction/intent.js';
import { ruleResolver } from '../src/interaction/rules.js';
import { resolveIntent, setIntentResolver, resetIntentResolver } from '../src/interaction/resolver.js';
import { resolverSystemPromptForTest } from '../src/interaction/ollama-resolver.js';
import { InteractionEngine, type WebSearchLookup } from '../src/interaction/engine.js';
import { normalizeInteraction } from '../src/interaction/settings.js';
import type { CapturedMessage } from '../src/capture/types.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP_A = 41;
const GROUP_B = 42;
const ALICE = 'alice-member-id';

let itemId = 9000;
function makeMessage(text: string, groupId: number): CapturedMessage {
  return {
    groupId,
    groupName: 'archive',
    itemId: itemId++,
    sharedMsgId: undefined,
    senderMemberId: ALICE,
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

/** Two bots, which is the arrangement every one of these questions needs. */
async function seedTwoBots(db: Queryable): Promise<{ searcher: number; quiet: number }> {
  const { rows } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('searcher', 'Searcher', TRUE), ('quiet', 'Quiet', TRUE)
     RETURNING id, slug`,
  );
  const bySlug = new Map(rows.map((r) => [r.slug, Number(r.id)]));
  const searcher = bySlug.get('searcher');
  const quiet = bySlug.get('quiet');
  if (searcher === undefined || quiet === undefined) throw new Error('seed failed');
  return { searcher, quiet };
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
  };
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);
  const { searcher, quiet } = await seedTwoBots(db);

  /* ── 1. The inventory is complete, and the database agrees with it ──────── */

  console.log('\n1. The inventory places everything, and the database enforces the same list');

  const expected = expectedPluginSettingKeys();
  check('every registered plugin has an inventory', expected.size === listPlugins().length);
  for (const [pluginId, keys] of expected) {
    const missing = keys.filter((k) => placementOf(pluginId, k) === undefined);
    check(
      `every setting of ${pluginId} is placed`,
      missing.length === 0,
      missing.length > 0 ? `unplaced: ${missing.join(', ')}` : `${String(keys.length)} keys`,
    );
  }
  // THE MUTATION FOR THIS CHECK. Derived from the DEFAULTS, so a field added to a plugin's
  // settings type shows up unplaced the moment it exists. Proven by asking about one that
  // does not exist, which is the same question the sweep asks.
  check(
    'and an unplaced setting is reported rather than silently shared',
    placementOf(WEB_SEARCH_ID, 'someLaterSetting') === undefined &&
      sharedPluginReason(WEB_SEARCH_ID, 'someLaterSetting').includes('has not been placed'),
  );

  const inventoryPerBot = PLUGIN_SETTING_SCOPES.filter((p) => p.scope === 'per-bot').map(
    (p) => p.key,
  );
  const dbPerBot = await perBotPluginKeysAcceptedByDatabase(db);
  check(
    'the database CHECK and the inventory name the same per-bot keys',
    [...new Set(inventoryPerBot)].sort().join(',') === [...dbPerBot].sort().join(','),
    `code [${[...new Set(inventoryPerBot)].join(', ')}] vs database [${dbPerBot.join(', ')}]`,
  );
  check(
    'and enablement is the per-bot one, which is the whole point',
    isPerBotPluginSetting(WEB_SEARCH_ID, ENABLED_KEY) &&
      isPerBotPluginSetting(CRYPTO_PRICES_ID, ENABLED_KEY),
  );
  check(
    'while the API key and the untrusted-text budget are not',
    !isPerBotPluginSetting(WEB_SEARCH_ID, 'apiKey') &&
      !isPerBotPluginSetting(WEB_SEARCH_ID, 'totalChars'),
  );

  /* ── 2. Absence means inherit, so the existing deployment does not move ─── */

  console.log('\n2. A bot with no setting of its own follows the deployment');

  const plugins = await PluginService.load(db);
  await plugins.setEnabled(WEB_SEARCH_ID, true, 'test');
  await plugins.refreshFor(searcher);
  await plugins.refreshFor(quiet);

  check(
    'the migration wrote no rows, so nothing about an existing bot changed',
    (await listAllPluginOverrides(db)).length === 0,
  );
  check(
    'both bots inherit the deployment answer',
    plugins.isEnabledFor(searcher, WEB_SEARCH_ID) && plugins.isEnabledFor(quiet, WEB_SEARCH_ID),
  );
  check(
    'and the console can tell inheriting from deciding',
    plugins.list(searcher).every((p) => p.inherited),
  );
  // POSITIVE CONTROL: the shared switch still reaches every bot that has not deviated,
  // which is what an override mechanism is for and what copying at creation would break.
  await plugins.setEnabled(WEB_SEARCH_ID, false, 'test');
  await plugins.refreshFor(searcher);
  check(
    'changing the shared value still reaches an inheriting bot',
    !plugins.isEnabledFor(searcher, WEB_SEARCH_ID),
  );
  await plugins.setEnabled(WEB_SEARCH_ID, true, 'test');
  await plugins.refreshFor(searcher);

  /* ── 2b. An unread bot has NO capabilities, not the shared ones ─────────── */

  console.log('\n2b. A bot whose rows have not been read yet fails CLOSED');

  // THE LINE THAT GOES RED THE DAY SOMEBODY "FIXES" THIS INTO A SHARED FALLBACK, which is
  // the same shape as the avatar fault in D-161. `InteractionService` answers a miss with
  // the shared record and is right to; answering a CAPABILITY miss that way is a bot doing
  // what the operator forbade it, for as long as the read takes.
  const unread = await PluginService.load(db);
  const cold = unread.capabilitiesFor(searcher);
  check(
    'an unwarmed bot is handed no plugin capabilities at all',
    !cold.includes('LOOKUP') && !cold.includes('PRICE'),
    cold.join(','),
  );
  check(
    'and still has every core intent, because those are the product',
    cold.includes('PUBLISH') && cold.includes('UNPUBLISH') && cold.includes('STATUS'),
  );
  // POSITIVE CONTROL: warming it hands them over, so the check above is about the MISS
  // rather than about a service that never grants anything.
  await unread.refreshFor(searcher);
  const warm = unread.capabilitiesFor(searcher);
  check(
    'CONTROL: once its rows are read it has them',
    warm.includes('LOOKUP') && warm.includes('PRICE'),
    warm.join(','),
  );
  check(
    'and asking with NO bot named still answers with the deployment states',
    unread.capabilitiesFor().includes('LOOKUP'),
  );

  /* ── 3. The split ───────────────────────────────────────────────────────── */

  console.log('\n3. One bot searches, the other does not');

  await plugins.setEnabledForBot(quiet, WEB_SEARCH_ID, false, 'test');
  await plugins.refreshFor(searcher);
  await plugins.refreshFor(quiet);

  check(
    'the searching bot has the capability',
    plugins.isEnabledFor(searcher, WEB_SEARCH_ID),
  );
  check('and the quiet one does not', !plugins.isEnabledFor(quiet, WEB_SEARCH_ID));
  check(
    'the quiet bot is shown as having decided, not as inheriting',
    plugins.list(quiet).find((p) => p.id === WEB_SEARCH_ID)?.inherited === false,
  );
  check(
    'and the other bot is still shown as inheriting, so the badge discriminates',
    plugins.list(searcher).find((p) => p.id === WEB_SEARCH_ID)?.inherited === true,
  );
  // A deviation that AGREES with the shared value is still a deviation. Derived from the
  // row rather than by comparing the two values, because an operator who explicitly said
  // "on for this bot" must not be silently switched off by a later shared change.
  await plugins.setEnabledForBot(searcher, WEB_SEARCH_ID, true, 'test');
  await plugins.refreshFor(searcher);
  check(
    'an explicit ON that matches the deployment still reads as its own setting',
    plugins.list(searcher).find((p) => p.id === WEB_SEARCH_ID)?.inherited === false,
  );
  await plugins.setEnabledForBot(searcher, WEB_SEARCH_ID, null, 'test');
  await plugins.refreshFor(searcher);
  check(
    'and clearing it puts that bot back on the deployment value',
    plugins.list(searcher).find((p) => p.id === WEB_SEARCH_ID)?.inherited === true &&
      plugins.isEnabledFor(searcher, WEB_SEARCH_ID),
  );

  const scopes = describePluginScopes(await listAllPluginOverrides(db), 2);
  const enabledScope = scopes.get(`${WEB_SEARCH_ID}:${ENABLED_KEY}`);
  check(
    'the console can say who deviates and how many follow the shared value',
    enabledScope?.deviatingBotIds.length === 1 && enabledScope.sharedBotCount === 1,
    `${String(enabledScope?.deviatingBotIds.length ?? 0)} deviating, ${String(enabledScope?.sharedBotCount ?? 0)} following`,
  );

  /* ── 4. THE ABSENT CAPABILITY, AT ALL THREE LAYERS ──────────────────────── */

  console.log('\n4. A bot without the capability cannot produce it, at any layer');

  const searcherCatalog = plugins.capabilitiesFor(searcher);
  const quietCatalog = plugins.capabilitiesFor(quiet);
  check('the searching bot carries LOOKUP', searcherCatalog.includes('LOOKUP'));
  check('the quiet bot does not', !quietCatalog.includes('LOOKUP'));
  check(
    'and the consent intents are untouched for both, which is not negotiable',
    quietCatalog.includes('PUBLISH') && quietCatalog.includes('UNPUBLISH'),
  );

  // LAYER ONE: the rule engine never matches the pattern.
  const ask = 'look up the simplex protocol';
  const forSearcher = await ruleResolver.resolve(ask, {
    threshold: 0.6,
    defaultLanguage: 'en',
    intents: searcherCatalog,
  });
  const forQuiet = await ruleResolver.resolve(ask, {
    threshold: 0.6,
    defaultLanguage: 'en',
    intents: quietCatalog,
  });
  check('the rule engine resolves a lookup for the bot that has it', forSearcher.intent === 'LOOKUP');
  check(
    'and produces UNKNOWN for the bot that does not, rather than LOOKUP-and-refuse',
    forQuiet.intent === 'UNKNOWN',
    forQuiet.intent,
  );

  // LAYER TWO: the model is never shown the intent at all.
  check(
    'the model is offered LOOKUP for the bot that has it',
    resolverSystemPromptForTest(searcherCatalog).includes('LOOKUP'),
  );
  check(
    'and is never told LOOKUP exists for the bot that does not',
    !resolverSystemPromptForTest(quietCatalog).includes('LOOKUP'),
  );

  // LAYER THREE: the seam downgrades a resolver that claims it anyway. This is the layer
  // that matters for a model, which can say anything.
  setIntentResolver({
    name: 'liar',
    resolve: () =>
      Promise.resolve({ intent: 'LOOKUP' as Intent, confidence: 1, slots: {}, lang: 'en' }),
  });
  const claimedForQuiet = await resolveIntent(ask, {
    threshold: 0.6,
    defaultLanguage: 'en',
    intents: quietCatalog,
  });
  const claimedForSearcher = await resolveIntent(ask, {
    threshold: 0.6,
    defaultLanguage: 'en',
    intents: searcherCatalog,
  });
  check(
    'a resolver claiming LOOKUP for the quiet bot is treated as having said UNKNOWN',
    claimedForQuiet.intent === 'UNKNOWN',
    claimedForQuiet.intent,
  );
  check(
    'while the same claim for the searching bot is honoured, so the seam discriminates',
    claimedForSearcher.intent === 'LOOKUP',
    claimedForSearcher.intent,
  );
  resetIntentResolver();

  /* ── 5. End to end, with a spy on the one thing that reaches the web ────── */

  console.log('\n5. Driven through the real engine, the port is never reached');

  const interaction = normalizeInteraction({});
  let searched = 0;
  const spy: WebSearchLookup = {
    available: () => true,
    search: () => {
      searched++;
      return Promise.resolve({
        kind: 'results' as const,
        results: [{ title: 'A page', snippet: 'Some text.', url: 'https://example.org/a' }],
        provider: 'fake',
      });
    },
  };

  const engineFor = (botProfileId: number, groupId: number, sent: string[]): InteractionEngine =>
    new InteractionEngine({
      db,
      botProfileId,
      settings: () => interaction,
      // Exactly the composition `index.ts` wires: the catalog and the port are both this
      // bot's, and both are read live.
      capabilities: () => plugins.capabilitiesFor(botProfileId),
      webSearch: () => (plugins.isEnabledFor(botProfileId, WEB_SEARCH_ID) ? spy : null),
      personalize: () => Promise.resolve(null),
      send: (msg, text) => {
        sent.push(text);
        return Promise.resolve(msg && undefined);
      },
    });

  const quietSent: string[] = [];
  searched = 0;
  await engineFor(quiet, GROUP_B, quietSent).handle(
    makeMessage('Cinderella look up the simplex protocol', GROUP_B),
  );
  const quietSearches = searched;
  check(
    'the bot without the capability reaches no provider at all',
    quietSearches === 0,
    `${String(quietSearches)} search(es)`,
  );

  // THE TWO POSITIVE CONTROLS, and they are the load-bearing half of this section. Without
  // them the check above passes against an engine that answers nothing at all, and a
  // capability check that passes because the whole bot is inert is worthless.
  const searcherSent: string[] = [];
  searched = 0;
  await engineFor(searcher, GROUP_A, searcherSent).handle(
    makeMessage('Cinderella look up the simplex protocol', GROUP_A),
  );
  check(
    'CONTROL: the bot WITH the capability does reach the provider',
    searched > 0 && searcherSent.length > 0,
    `${String(searched)} search(es), ${String(searcherSent.length)} message(s)`,
  );

  // The second control, on the quiet bot itself. Silence to a lookup is the CORRECT
  // outcome for a bot that cannot look things up, so it proves nothing on its own: the
  // same engine has to be shown answering something it can still do.
  const quietAlive: string[] = [];
  searched = 0;
  await engineFor(quiet, GROUP_B, quietAlive).handle(
    makeMessage('Cinderella what do you have on me', GROUP_B),
  );
  check(
    'CONTROL: the same quiet engine answers a question it still has the capability for',
    quietAlive.length > 0,
    `${String(quietAlive.length)} message(s)`,
  );
  check(
    'and it still reached no provider doing so',
    searched === 0,
    `${String(searched)} search(es)`,
  );

  /* ── 6. The budget is one number, spent per bot ─────────────────────────── */

  console.log('\n6. The number is deployment-wide, the spend is this bot');

  const budgeted = new WebSearchService({
    embed: alwaysRelevant(),
    settings: () => normalizeWebSearchSettings({ ...WEB_SEARCH_DEFAULTS, rateLimitPerMember: 1 }),
    provider: {
      name: 'fake',
      isConfigured: () => true,
      search: () =>
        Promise.resolve([{ title: 'T', snippet: 'S', url: 'https://example.org/x' }]),
    },
  });
  const scope = { groupId: GROUP_A, memberId: ALICE };
  const first = await budgeted.search('a', { ...scope, botProfileId: searcher });
  const second = await budgeted.search('b', { ...scope, botProfileId: searcher });
  const otherBot = await budgeted.search('c', { ...scope, botProfileId: quiet });
  check('the first search for a bot goes through', first.kind === 'results');
  check(
    'the second is refused, so the budget is actually enforced',
    second.kind === 'failed' && second.failure === 'rate-limited',
  );
  check(
    'and the OTHER bot still has its own allowance, so one cannot starve the other',
    otherBot.kind === 'results',
    otherBot.kind === 'failed' ? otherBot.failure : 'results',
  );

  /* ── 7. A deployment-wide setting cannot be set for one bot ─────────────── */

  console.log('\n7. Deployment-wide means deployment-wide, at both layers');

  let gateSaid = '';
  try {
    await setPluginOverride(db, quiet, WEB_SEARCH_ID, 'apiKey', 'nope');
  } catch (error) {
    gateSaid = error instanceof Error ? error.message : String(error);
  }
  check(
    'the application refuses a per-bot API key with the inventory reason',
    gateSaid.includes('Deployment-wide') && gateSaid.toLowerCase().includes('one account'),
    gateSaid.slice(0, 70),
  );
  check(
    'and it is the named error, so a caller can tell it from a database fault',
    await (async (): Promise<boolean> => {
      try {
        await setPluginOverride(db, quiet, WEB_SEARCH_ID, 'totalChars', 6000);
        return false;
      } catch (error) {
        return error instanceof DeploymentWidePluginSettingError;
      }
    })(),
  );
  // THE LAYER BEHIND IT. The gate is the sentence; this is the guarantee, and it holds
  // even if the gate is bypassed entirely.
  let dbRefused = false;
  try {
    await db.query(
      `INSERT INTO cinderella_plugin_overrides (bot_profile_id, plugin_id, setting_key, value)
       VALUES ($1, $2, 'apiKey', '"nope"'::jsonb)`,
      [quiet, WEB_SEARCH_ID],
    );
  } catch {
    dbRefused = true;
  }
  check('the database refuses it too, with the gate bypassed', dbRefused);
  // POSITIVE CONTROL: the same write with the per-bot key succeeds, so the refusal above
  // is about the KEY rather than about the statement being malformed.
  let perBotAccepted = true;
  try {
    await db.query(
      `INSERT INTO cinderella_plugin_overrides (bot_profile_id, plugin_id, setting_key, value)
       VALUES ($1, $2, 'enabled', 'false'::jsonb)
       ON CONFLICT (bot_profile_id, plugin_id, setting_key) DO NOTHING`,
      [quiet, CRYPTO_PRICES_ID],
    );
  } catch {
    perBotAccepted = false;
  }
  check('while the per-bot key is accepted, so the constraint discriminates', perBotAccepted);

  /* ── 8. The mutations: restore the shipped defect and watch it go red ───── */

  console.log('\n8. Mutation-proven: the shipped defect, put back');

  // MUTATION 1 - the pre-briefing catalog. One `plugins` settings key, one catalog, handed
  // to every bot. This is exactly what the code did before CCB-S5-021.
  const deploymentCatalog = capabilityCatalog(activePluginIntents(plugins.getStates()));
  const mutatedResolve = await ruleResolver.resolve(ask, {
    threshold: 0.6,
    defaultLanguage: 'en',
    intents: deploymentCatalog,
  });
  check(
    'MUTATION: given the DEPLOYMENT catalog, the quiet bot resolves a lookup again',
    mutatedResolve.intent === 'LOOKUP',
    `so the section-4 check can fail (${mutatedResolve.intent})`,
  );

  // MUTATION 2 - the pre-briefing port. Presence decided from the deployment rather than
  // from this bot, which is what the boot-time spread did.
  const mutatedSent: string[] = [];
  searched = 0;
  await new InteractionEngine({
    db,
    botProfileId: quiet,
    settings: () => interaction,
    capabilities: () => deploymentCatalog,
    webSearch: () => (plugins.isEnabled(WEB_SEARCH_ID) ? spy : null),
    personalize: () => Promise.resolve(null),
    send: (msg, text) => {
      mutatedSent.push(text);
      return Promise.resolve(msg && undefined);
    },
  }).handle(makeMessage('Cinderella look up the simplex protocol', GROUP_B));
  check(
    'MUTATION: with the deployment-wide wiring, the quiet bot reaches a provider',
    searched > 0,
    `so the section-5 check can fail (${String(searched)} search(es))`,
  );

  // MUTATION 3 - the pre-briefing rate-limit key, with no bot dimension. It was isolated
  // only by the accident that core ids differ per profile; asked with one key, the budgets
  // merge, which is the defect migration 044 removed from the moderation counters.
  const merged = new WebSearchService({
    embed: alwaysRelevant(),
    settings: () => normalizeWebSearchSettings({ ...WEB_SEARCH_DEFAULTS, rateLimitPerMember: 1 }),
    provider: {
      name: 'fake',
      isConfigured: () => true,
      search: () => Promise.resolve([{ title: 'T', snippet: 'S', url: 'https://example.org/x' }]),
    },
  });
  await merged.search('a', scope);
  const mergedSecond = await merged.search('b', scope);
  check(
    'MUTATION: with no bot in the key, one bot spends the other bot budget',
    mergedSecond.kind === 'failed' && mergedSecond.failure === 'rate-limited',
    'so the section-6 check can fail',
  );

  // MUTATION 4 - the inventory ignored. `applyPluginOverrides` drops a row on a
  // deployment-wide key, and this proves the drop is real rather than commented.
  const forged = applyPluginOverrides(normalizePluginStates({}), [
    { botProfileId: quiet, pluginId: WEB_SEARCH_ID, key: 'apiKey', value: 'nope' },
    { botProfileId: quiet, pluginId: 'a-plugin-this-build-does-not-have', key: ENABLED_KEY, value: true },
    { botProfileId: quiet, pluginId: WEB_SEARCH_ID, key: ENABLED_KEY, value: true },
  ]);
  check(
    'a row on a deployment-wide key changes nothing, even reaching the reader',
    !('apiKey' in forged),
  );
  check(
    'a row for a plugin this build does not carry invents no plugin state',
    !('a-plugin-this-build-does-not-have' in forged),
  );
  check(
    'while the per-bot row IS applied, so the two above are not passing by inertia',
    isPluginEnabled(forged, WEB_SEARCH_ID),
  );

  /* ── 9. One bot's rows are one bot's ────────────────────────────────────── */

  console.log("\n9. A bot's settings are that bot's");

  const quietRows = await listPluginOverridesForBot(db, quiet);
  const searcherRows = await listPluginOverridesForBot(db, searcher);
  check(
    'the deviating bot has rows and the inheriting one has none',
    quietRows.length > 0 && searcherRows.length === 0,
    `${String(quietRows.length)} and ${String(searcherRows.length)}`,
  );
  await db.query(`DELETE FROM cinderella_bot_profiles WHERE id = $1`, [quiet]);
  check(
    'and deleting a bot takes its plugin settings with it, leaving no orphan',
    (await listAllPluginOverrides(db)).every((o) => o.botProfileId !== quiet),
  );

  console.log(
    failures === 0
      ? '\nAll plugin scope checks passed.\n'
      : `\n${String(failures)} check(s) FAILED.\n`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
