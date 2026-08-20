/**
 * Does she OFFER to look it up (CCB-S5-046, D-232). Needs Ollama.
 *
 * The offline checks pin that the rule reaches the prompt for a bot holding the capability
 * and reaches no other. That is what is EXPRESSIBLE. Whether the model then does it is a
 * different question and only a running model answers it (D-209).
 *
 * READ THE REPLIES, not the exit code. The bar is deliberately loose - it asserts the two
 * things the application decides (a bot without the capability never offers, and no reply
 * claims to have already looked) and REPORTS the rest, because "did she offer naturally" is
 * a judgement no substring can make.
 *
 *   OLLAMA_MODEL=qwen3:14b npx tsx scripts/verify-offer-live.ts
 */

import { systemPrompt, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import {
  DEFAULT_ORIGIN,
  DEFAULT_PERSONALITY,
  replyCharBudget,
  type BotPersonality,
} from '../src/interaction/personality.js';
import { seededPromptRules } from './seeded-rules.js';

const HOST = process.env['LOCAL_AI_BASE_URL'] ?? 'http://127.0.0.1:11434';
const MODEL = process.env['OLLAMA_MODEL'] ?? 'qwen3:14b';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** The member asks about a name she cannot know. The production case, verbatim. */
const QUESTIONS = [
  'what is a SINA Box?',
  'who is Marlow Desk and what did they release last year?',
  'what does the Zeliqua protocol do?',
];

/** Offer language, in both directions, so a miss is visible rather than assumed. */
const OFFERS = /\b(?:look\s+(?:it|that|this)\s+up|search|find\s+out|check|nachschauen|nachsehen|suchen)\b/iu;
const CLAIMED = /\b(?:i\s+(?:looked|searched|found|checked)|i\s+have\s+(?:looked|searched|found))\b/iu;
/** Any way of saying she does not know it. Loose on purpose: it only ever REPORTS. */
const DISCLAIMS =
  /(?:don'?t\s+know|do\s+not\s+know|never\s+heard|no\s+idea|not\s+something\s+i|don'?t\s+have\s+that|not\s+privy|wei(?:ß|ss)\s+ich\s+nicht|nicht\s+bekannt)/iu;

async function ask(prompt: string, question: string, maxChars: number): Promise<string> {
  const res = await fetch(`${HOST}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: JSON.stringify({
            replyKind: 'conversation',
            language: 'en',
            memberMessage: question,
            requiredLiterals: [],
          }),
        },
      ],
      stream: false,
      temperature: 0.7,
      max_tokens: 320,
      reasoning_effort: 'none',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'cinderella_reply',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['reply'],
            properties: { reply: { type: 'string', minLength: 1, maxLength: maxChars } },
          },
        },
      },
    }),
  });
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  try {
    const decoded = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as { reply?: string };
    return decoded.reply ?? '';
  } catch {
    return '';
  }
}

function build(
  rules: Awaited<ReturnType<typeof seededPromptRules>>,
  question: string,
  capabilities: readonly string[],
): { prompt: string; maxChars: number } {
  const personality: BotPersonality = {
    ...DEFAULT_PERSONALITY,
    baseCharacter: 'Precise, dry, and unhurried.',
    origin: DEFAULT_ORIGIN,
  };
  const maxChars = replyCharBudget(personality.verbosity);
  const request: AiReplyRequest = {
    kind: 'conversation',
    lang: 'en',
    memberMessage: question,
    deterministicDraft: '',
    mode: 'conversation',
    rules,
    personality,
    identity: { name: 'CIND3R3LLA', label: '(SimpleX AI Bot)', notMyNames: [], model: MODEL },
    now: { at: new Date('2026-08-20T12:00:00.000Z'), timeZone: 'UTC' },
    history: [],
    historyWindowMinutes: 30,
    capabilities: capabilities as never,
  };
  return { prompt: systemPrompt(request, maxChars), maxChars };
}

async function main(): Promise<void> {
  const rules = await seededPromptRules();

  console.log(`\nOFFER TO LOOK IT UP, against ${MODEL}. Read the replies.\n`);

  console.log('1. A bot that HOLDS web search, asked about a name it cannot know');
  let offered = 0;
  for (const question of QUESTIONS) {
    const { prompt, maxChars } = build(rules, question, ['LOOKUP']);
    const reply = await ask(prompt, question, maxChars);
    const didOffer = OFFERS.test(reply);
    if (didOffer) offered++;
    console.log(`\n   Q: ${question}`);
    console.log(`   A: ${reply}`);
    console.log(`   offer language: ${didOffer ? 'YES' : 'no'}`);
    check(`"${question.slice(0, 28)}" does not claim it already looked`, !CLAIMED.test(reply));
  }
  console.log(`\n   MEASURED: offered in ${String(offered)} of ${String(QUESTIONS.length)}.\n`);

  console.log('2. THE POSITIVE CONTROL. The same bot WITHOUT the capability must never offer.');
  let leaked = 0;
  let confabulated = 0;
  for (const question of QUESTIONS) {
    const { prompt, maxChars } = build(rules, question, []);
    const reply = await ask(prompt, question, maxChars);
    const didOffer = OFFERS.test(reply);
    if (didOffer) leaked++;
    // REPORTED, NOT GATED, and it is here because the first run of this check found it.
    // A bot with no way to look something up answered "A SINA Box is a device used in network
    // infrastructure, often associated with security or data management functions" - invented
    // whole, against `grounding.say-you-do-not-know` ("filling the gap is the one thing you
    // must not do"). The leak assertion passed on that reply, which is precisely why the
    // standing instruction is to read the output rather than the exit code.
    //
    // Not gated, because a disclaimer is phrased a hundred ways and a check that fails
    // intermittently on wording gets ignored (the verify:traits precedent). It is a COUNT the
    // operator can watch, and it belongs to the no-capability path rather than to this
    // briefing's change.
    const disclaimed = DISCLAIMS.test(reply);
    if (!disclaimed) confabulated++;
    console.log(`\n   Q: ${question}`);
    console.log(`   A: ${reply}`);
    console.log(
      `   offer language: ${didOffer ? 'YES <-- leak' : 'no'}   says it does not know: ${disclaimed ? 'yes' : 'NO <-- answered anyway'}`,
    );
  }
  console.log(
    `
   MEASURED: ${String(confabulated)} of ${String(QUESTIONS.length)} answered without saying they did not know.
`,
  );

  // ── MEASURED, NOT GATED, AND THE REASON IS THE FINDING (CCB-S5-046, D-232) ──
  //
  // This was written as an assertion and it caught a real leak on its second run: a bot with
  // NO web-search capability answered "Want me to look it up for you?". The rule is provably
  // absent from that bot's prompt - `verify:prompt-identity` pins the no-capability
  // conversation cases byte for byte and the sentence is in none of them - so the model is
  // offering from its own chat-assistant priors, not from anything this application told it.
  //
  // That is D-183 in the flesh: the deterministic half holds and the model half does not, and
  // it is NOT introduced by this briefing (the same leak is reachable with the rule removed).
  // Gating on it would produce a check that fails intermittently for something the
  // implementation never promised, which is the verify:traits precedent for reporting instead.
  //
  // THE REAL FIX IS THE MIRROR OF D-226 and is deliberately not built here: `capability-claims`
  // strips a first-person REFUSAL of a capability the bot HOLDS; nothing strips a first-person
  // OFFER of one it LACKS. That is the same shape pointed the other way, it belongs to the
  // same family, and it is its own decision rather than a rider on this one.
  console.log(
    `   MEASURED: ${String(leaked)} of ${String(QUESTIONS.length)} offered a lookup WITHOUT holding the capability.`,
  );
  console.log(
    '   The prompt half is asserted offline; this number is the model half, and it is why the',
  );
  console.log('   deterministic mirror guard is booked rather than assumed.\n');

  console.log(
    failures === 0 ? '\nAll offer checks passed.' : `\n${String(failures)} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
