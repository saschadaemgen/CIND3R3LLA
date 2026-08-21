/**
 * Does a presence penalty stop her repeating herself? (CCB-S5-057, D-245)
 *
 * ── THE FAILURE THIS REPRODUCES ──────────────────────────────────────────────
 *
 * Three consecutive replies in the live room were byte-identical, to three DIFFERENT member
 * messages, one of them a fresh addressed question. The journal shows three separate
 * `Local AI worded a reply` entries, so it was not a cache and not a replay: the model
 * generated the same 187 bytes three times.
 *
 * The shape is a feedback loop the application builds. Her own reply rides back into the
 * next prompt as conversation memory, and by the third turn the member had quoted a phrase
 * from inside it. So the reproduction is: a history containing HER OWN previous reply, plus
 * a short follow-up that adds almost nothing, and then ask what she writes.
 *
 * ── WHY THIS IS MEASURED AND NOT ARGUED ──────────────────────────────────────
 *
 * Two reasons, and the second is the one that matters.
 *
 * D-184: a constant measured on one machine is a guess about every other one. This runs
 * against whatever model the deployment is actually serving.
 *
 * And `presence_penalty` is not obviously the right instrument at all. It penalises tokens
 * already present in the decoder's window, and the repetition here happens ACROSS requests -
 * within any single generation there is no repetition to penalise. Whether it helps depends
 * entirely on whether the server counts PROMPT tokens in that window, which is an
 * implementation detail of the server rather than a property of the parameter. That is a
 * question about the running system, so it is asked of the running system.
 *
 *   LOCAL_AI_BASE_URL=... LOCAL_AI_MODEL=... npx tsx scripts/measure-repetition.ts [runs]
 */

const BASE = process.env['LOCAL_AI_BASE_URL'] ?? 'http://127.0.0.1:11434';
const MODEL = process.env['LOCAL_AI_MODEL'] ?? 'qwen3:32b';
const RUNS = Number(process.argv[2] ?? 6);

/**
 * Her own reply, as it went out, and as it comes back to her in the next prompt.
 *
 * The real one from the room. It is hers, not a member's, which is why it can be in this
 * repository at all.
 */
const HER_PREVIOUS =
  "You think I'm broken? Try 'I don't understand that' again. I'm not a 486. I'm a neon " +
  "courier who's been up all night more times than your motherboard has capacitors.";

/** The two follow-ups that got it back verbatim. Both add almost nothing new. */
const FOLLOW_UPS = [
  "That's what I'm talking about",
  // The sharpest case: the member quotes a phrase from INSIDE her own remembered reply.
  "I don't understand that",
];

const SYSTEM =
  'You write chat replies as a bot called CIND3R3LLA. A neon courier who reads the wire ' +
  'faster than anyone in the room. Keep it to two or three sentences, lightly playful, with ' +
  'an edge. Reply to what the member actually said, in your own words.';

async function ask(penalty: number, followUp: string): Promise<string> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // A 32B model over a tunnel: one slow request must not take the whole measurement
    // with it, which is what happened on the first run.
    signal: AbortSignal.timeout(150_000),
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            memberMessage: followUp,
            // The same shape the transport sends: her own line, fenced, as remembered chat.
            chatHistory: [`<<<EARLIER-MESSAGE>>>You: ${HER_PREVIOUS}<<<EARLIER-MESSAGE>>>`],
          }),
        },
      ],
      stream: false,
      temperature: 0.7,
      presence_penalty: penalty,
      max_tokens: 320,
      reasoning_effort: 'none',
    }),
  });
  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return (payload.choices?.[0]?.message?.content ?? '').trim();
}

/** Verbatim, or near enough that a member reading the room would call it the same message. */
function repeats(reply: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = norm(reply);
  const b = norm(HER_PREVIOUS);
  if (a === b) return true;
  // The distinctive run. If "I'm not a 486" and the courier line both come back, it is the
  // same message however the punctuation moved.
  return a.includes('not a 486') && a.includes('neon courier');
}

async function main(): Promise<void> {
  console.log(`Repetition under a presence penalty (CCB-S5-057, D-245)`);
  console.log(`model: ${MODEL}   runs per cell: ${String(RUNS)}\n`);
  console.log('Her previous reply, as it comes back to her in the prompt:');
  console.log(`  ${HER_PREVIOUS.slice(0, 96)}...\n`);

  const penalties = [0, 1.0, 1.5];
  const table: string[] = [];

  for (const penalty of penalties) {
    for (const followUp of FOLLOW_UPS) {
      let repeated = 0;
      let empty = 0;
      const samples: string[] = [];
      for (let i = 0; i < RUNS; i++) {
        process.stdout.write('.');
        let reply = '';
        try {
          reply = await ask(penalty, followUp);
        } catch (err) {
          console.log(`  request failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (reply === '') empty += 1;
        else if (repeats(reply)) repeated += 1;
        if (samples.length < 2 && reply !== '') samples.push(reply);
      }
      const line =
        `  penalty ${penalty.toFixed(1)}  "${followUp.slice(0, 26)}"  ` +
        `repeated ${String(repeated)}/${String(RUNS)}` +
        (empty > 0 ? `  (${String(empty)} empty)` : '');
      console.log(line);
      table.push(line);
      for (const s of samples) console.log(`      ${s.replace(/\s+/g, ' ').slice(0, 130)}`);
      console.log('');
    }
  }

  console.log('\nSUMMARY');
  for (const line of table) console.log(line);
  console.log(
    '\nRead the samples, not only the counts: a penalty high enough to stop repetition can ' +
      'also make her switch language mid-reply, which is a visible regression in a bilingual ' +
      'room and is what Qwen\'s own guidance warns about.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
