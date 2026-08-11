/**
 * Offline verification for the Ollama intent resolver.
 *
 * No network is used. Fake structured responses exercise the real resolver,
 * deterministic consent gate, catalog validation, and automatic rule fallback.
 */

import type { LocalAiConfig } from '../src/config.js';
import {
  INTENT_DEFINITIONS,
  createOllamaIntentResolver,
  resolverSystemPromptForTest,
  type FetchLike,
} from '../src/interaction/ollama-resolver.js';
import { CORE_INTENTS, capabilityCatalog, type Intent } from '../src/interaction/intent.js';
import { ruleResolver } from '../src/interaction/rules.js';
import {
  resetIntentResolver,
  resolveIntent,
  setIntentResolver,
} from '../src/interaction/resolver.js';

/**
 * The catalog this harness drives with (CCB-S5-021).
 *
 * It used to be process state, written by `setActiveIntents`. It is a VALUE now, computed
 * per bot in production and carried in the resolution context, so a harness states the
 * capabilities it is testing instead of mutating a global that outlived the check.
 */
let catalog: Intent[] = capabilityCatalog([]);
const setCatalog = (extra: readonly Intent[]): void => {
  catalog = capabilityCatalog(extra);
};

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

const ctx = {
  threshold: 0.65,
  defaultLanguage: 'en',
  // Stated rather than ambient (CCB-S5-021). `get intents()` so a `setCatalog` later in
  // the run reaches a context object built here, which is what the module global did.
  get intents(): Intent[] {
    return catalog;
  },
};

function completion(result: unknown): FetchLike {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(result),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
}

function brokenCompletion(): FetchLike {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{not-json',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
}

async function resolveWith(text: string, result: unknown) {
  const resolver = createOllamaIntentResolver(config, {
    fetchImpl: completion(result),
  });
  return resolver.resolve(text, ctx);
}

async function main(): Promise<void> {
  setCatalog([]);

  console.log('\n1. STATUS cannot be escalated into consent');

  const statusShield = await resolveWith('what is my publishing status?', {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'en',
  });
  check(
    'model PUBLISH on a state question is forced to STATUS',
    statusShield.intent === 'STATUS',
    statusShield.intent,
  );

  const germanStatusShield = await resolveWith('wie ist mein Veröffentlichungsstatus?', {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'de',
  });
  check(
    'German state question is forced to STATUS',
    germanStatusShield.intent === 'STATUS',
    germanStatusShield.intent,
  );

  console.log('\n2. Consent requires deterministic agreement');

  const publish = await resolveWith('publish me', {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'en',
  });
  check('clear PUBLISH passes when rules agree', publish.intent === 'PUBLISH', publish.intent);

  const negated = await resolveWith("don't publish me", {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'en',
  });
  check('negated PUBLISH is forced to UNKNOWN', negated.intent === 'UNKNOWN', negated.intent);

  const novelConsent = await resolveWith('place all my future thoughts beneath the public moon', {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'en',
  });
  check(
    'AI-only consent wording is forced to UNKNOWN',
    novelConsent.intent === 'UNKNOWN',
    novelConsent.intent,
  );

  const lowConfidence = await resolveWith('publish me', {
    intent: 'PUBLISH',
    confidence: 0.7,
    slots: {},
    lang: 'en',
  });
  check(
    'low-confidence consent is forced to UNKNOWN',
    lowConfidence.intent === 'UNKNOWN',
    lowConfidence.intent,
  );

  console.log('\n3. AI may extend read-only understanding, except about WHERE to look');

  // ── INVERTED, NOT DELETED (CCB-S5-027, D-181) ─────────────────────────────
  //
  // This asserted that a model may claim SEARCH for a novel phrasing the rule engine does
  // not match: `bring me every archive moment involving fibre taps` passed on the model's
  // word alone. CCB-S5-026 made the archive explicit-only in the rule engine and told the
  // model about it in a prompt sentence; a prompt sentence is an instruction, and in
  // production it was not followed. So the bar is now deterministic and the same for
  // everybody at the door, which means this old behaviour is exactly the hole.
  //
  // Kept as a check rather than removed, because "the model can no longer widen the
  // archive trigger" is a guarantee somebody could helpfully undo.
  const novelSearch = await resolveWith('bring me every archive moment involving fibre taps', {
    intent: 'SEARCH',
    confidence: 0.96,
    slots: { query: 'fibre taps' },
    lang: 'en',
  });
  check(
    'a model-claimed SEARCH naming no place the rule engine knows is downgraded',
    novelSearch.intent === 'UNKNOWN',
    novelSearch.intent,
  );

  // The production question itself, which is what this gate exists for. It contains no
  // archive phrase, it was a deliberate hallucination trap, and it was answered with a
  // full-text count instead of reaching the knowledge base.
  const falsePremise = await resolveWith(
    'In which session was the switch from mbedTLS to OpenSSL decided?',
    { intent: 'SEARCH', confidence: 0.95, slots: { query: 'mbedTLS OpenSSL' }, lang: 'en' },
  );
  check(
    'the false-premise question no longer reaches the archive',
    falsePremise.intent === 'UNKNOWN',
    falsePremise.intent,
  );

  // THE POSITIVE CONTROL, and it is the load-bearing half: a gate that refused every SEARCH
  // would pass both assertions above while removing the capability entirely.
  const search = await resolveWith('search the archive for fibre taps', {
    intent: 'SEARCH',
    confidence: 0.96,
    slots: { query: 'fibre taps' },
    lang: 'en',
  });
  check('a SEARCH that names the archive still passes', search.intent === 'SEARCH', search.intent);
  check('SEARCH query slot survives', search.slots.query === 'fibre taps', search.slots.query ?? '');

  console.log('\n4. Malformed model output falls back to rules');

  setIntentResolver(
    createOllamaIntentResolver(config, {
      fetchImpl: brokenCompletion(),
    }),
  );
  const malformedFallback = await resolveIntent('publish me', ctx);
  check(
    'malformed JSON falls back to deterministic PUBLISH',
    malformedFallback.intent === 'PUBLISH',
    malformedFallback.intent,
  );

  setIntentResolver(
    createOllamaIntentResolver(config, {
      fetchImpl: completion({
        intent: 'DELETE_EVERYTHING',
        confidence: 1,
        slots: {},
        lang: 'en',
      }),
    }),
  );
  const catalogFallback = await resolveIntent('what is my status', ctx);
  check(
    'out-of-catalog output falls back to deterministic STATUS',
    catalogFallback.intent === 'STATUS',
    catalogFallback.intent,
  );

  setIntentResolver(
    createOllamaIntentResolver(config, {
      fetchImpl: async () => Promise.reject(new Error('endpoint unavailable')),
    }),
  );
  const networkFallback = await resolveIntent('what can you do', ctx);
  check(
    'network failure falls back to deterministic HELP',
    networkFallback.intent === 'HELP',
    networkFallback.intent,
  );

  resetIntentResolver();
  setCatalog([]);

  console.log(`\n=== RESULTS ===`);
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('NetworkUsed: false');
  console.log('ConsentExecuted: false');

  /* ── The catalog boundary (CCB-S4-041, D-143) ─────────────────────────── */

  console.log('\nThe catalog: command or conversation');

  // ── THE ASSERTION THE BRIEFING ASKS FOR BY NAME ────────────────────────────
  //
  // HELP claimed "identity" for as long as help was the only place she said anything
  // about herself. It predates the origin field and free conversation, and once a larger
  // model started following the description faithfully, "who made you and why?" got a
  // fixed help text. This check fails if that word, or any of its neighbours, comes back.
  const help = INTENT_DEFINITIONS.HELP;
  check(
    'HELP no longer claims identity',
    !/\bidentity\b/i.test(help),
    help.slice(0, 60),
  );
  check(
    'and says plainly that questions about her are not HELP',
    /who or what she is|where she came from|who built her/i.test(help) &&
      /never HELP|not about the bot itself|NOT about the bot/i.test(help),
  );
  // NEGATIVE CONTROL. The description must still claim what it does serve, or this would
  // pass on an empty string.
  check(
    'while still claiming what it does serve',
    /command/i.test(help) && /how to use|usage|OPERATING/i.test(help),
  );

  // ── PRICE stops claiming anything with a price in it ───────────────────────
  const price = INTENT_DEFINITIONS.PRICE;
  check(
    'PRICE names the boundary rather than hoping the model infers it',
    /traded financial asset|cryptocurrency|currency pair/i.test(price),
  );
  check(
    'and says a physical product is not PRICE',
    /physical product/i.test(price) && /graphics card|phone|ticket/i.test(price),
  );

  // ── SEARCH and LOOKUP state the boundary from BOTH sides ───────────────────
  const searchDef = INTENT_DEFINITIONS.SEARCH;
  const lookupDef = INTENT_DEFINITIONS.LOOKUP;
  check(
    'SEARCH says it is the archive and never the web',
    /archive/i.test(searchDef) && /never the web|is LOOKUP, not SEARCH/i.test(searchDef),
  );
  check(
    'LOOKUP says it is the web and never the archive',
    /web/i.test(lookupDef) && /never this group own archive|is SEARCH, not LOOKUP/i.test(lookupDef),
  );
  // ── THE CROSS-REFERENCES MOVED INTO THE COMPOSITION (CCB-S5-021) ───────────
  //
  // CCB-S4-041's "a request to search the web is LOOKUP, not SEARCH" used to live in
  // SEARCH's constant, which meant a bot with web search switched OFF was told, inside the
  // description of a capability it has, that a capability it does not have is the right
  // answer. They are appended by `systemPrompt` now, only when the other intent is really
  // in that bot's catalog, so the guarantee is asserted where it now lives: present with
  // both, absent with one, and that pair is the whole point.
  const bothPrompt = resolverSystemPromptForTest([...CORE_INTENTS, 'LOOKUP', 'PRICE']);
  const noLookupPrompt = resolverSystemPromptForTest([...CORE_INTENTS, 'PRICE']);
  check(
    'with both active, the prompt still states the boundary from both sides',
    /A request to search the web is LOOKUP, not SEARCH\./.test(bothPrompt) &&
      /A request to search what members have said here is SEARCH, not LOOKUP\./.test(bothPrompt),
  );
  check(
    'and with LOOKUP absent, the prompt never names it at all',
    !/LOOKUP/.test(noLookupPrompt),
  );

  // ── The slot rule contradicted LOOKUP's own description ────────────────────
  const prompt = resolverSystemPromptForTest();
  check(
    'the slot rule no longer says only SEARCH may carry a query',
    !/Use slots\.query only for SEARCH/.test(prompt),
  );
  check(
    'and names both corpora, so a query-shaped request has no reason to prefer SEARCH',
    /slots\.query for SEARCH and for LOOKUP/.test(prompt),
  );

  // ── The precedence rule, which is what generalises the fix ─────────────────
  check(
    'the catalog states that a message about her is conversation',
    /ABOUT HER rather than about a task, it is conversation, not a command/.test(prompt),
  );
  check(
    'and names the specific things that means',
    /where she came from, who built her, what she runs on/.test(prompt),
  );

  /* ── The rule engine decides the RTX case before the model ever sees it ─── */

  console.log('\nThe rule engine: an explicit web verb wins');

  const routes = async (text: string): Promise<string> =>
    (await ruleResolver.resolve(text, { threshold: 0.6, defaultLanguage: 'en', intents: catalog }))
      .intent;

  setCatalog([...CORE_INTENTS, 'LOOKUP', 'PRICE']);

  // THE OBSERVED DEFECT, and it never reached the model: "price of" is a two token phrase
  // and "google" is one, so PRICE scored 0.94 and the crypto plugin quoted 1.9758 USD for
  // a graphics card. Tuning the catalog alone would have left this exactly as it was.
  check(
    'an explicit web verb beats a price keyword in the same sentence',
    (await routes('google the current price of an RTX 5090')) === 'LOOKUP',
    await routes('google the current price of an RTX 5090'),
  );
  check(
    'and beats an archive search keyword',
    (await routes('search the web for the latest release')) === 'LOOKUP',
    await routes('search the web for the latest release'),
  );

  // NEGATIVE CONTROLS. The precedence must not swallow the two intents it outranks.
  check(
    'a real price question is still PRICE',
    (await routes('what is the price of bitcoin')) === 'PRICE',
    await routes('what is the price of bitcoin'),
  );
  check(
    'a real archive search is still SEARCH',
    (await routes('search the archive for what bob said')) === 'SEARCH',
    await routes('search the archive for what bob said'),
  );

  // WITH THE PLUGIN OFF, an explicit web request must not become an archive search. The
  // member asked for the web and would otherwise get a count of what the group said,
  // presented as an answer, without ever being told the web was not consulted. UNKNOWN
  // sends it to conversation, where she can say she cannot look things up.
  setCatalog([...CORE_INTENTS, 'PRICE']);
  check(
    'with web search off, a web request falls to conversation rather than the archive',
    (await routes('search the web for the latest release')) === 'UNKNOWN',
    await routes('search the web for the latest release'),
  );
  check(
    'and the RTX case does not silently become a crypto quote either',
    (await routes('google the current price of an RTX 5090')) === 'UNKNOWN',
    await routes('google the current price of an RTX 5090'),
  );
  // The control for that pair: the commands the plugin does not touch are unaffected.
  check(
    'while an ordinary archive search still works with the plugin off',
    (await routes('search the archive for what bob said')) === 'SEARCH',
  );
  setCatalog([...CORE_INTENTS, 'LOOKUP', 'PRICE']);



  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  resetIntentResolver();
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFatal: ${message}`);
  process.exit(1);
});
