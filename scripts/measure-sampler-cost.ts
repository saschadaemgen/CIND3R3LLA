/**
 * What the repetition window costs on ordinary replies (CCB-S5-060 stage 1, D-252).
 *
 * ── WHY THIS RUNS BEFORE THE SETTING SHIPS ───────────────────────────────────
 *
 * Stage 0 measured that `repeat_penalty: 1.1` over `repeat_last_n: 2048` takes the known
 * repetition trigger from 5 of 5 verbatim repeats to 0 of 5. That is the benefit. Qwen3's
 * model card recommends leaving repetition penalties OFF, which is a warning about the
 * cost, and the cost is exactly what stage 0 did not measure: what the penalty does to
 * replies that were never going to repeat.
 *
 * Three costs are plausible and each gets a cell:
 *
 *   LANGUAGE MIXING. The card's named failure. A penalty suppressing recently-seen tokens
 *   can push a bilingual model across the language boundary mid-reply. Measured on German
 *   questions by counting unambiguous English function words in the reply.
 *
 *   LITERAL LOSS. The free lane REWRITES a deterministic draft and must reproduce its
 *   numbers exactly ("216", "4.24 USD"). Those tokens sit in the prompt, inside the
 *   penalty window, so the penalty pushes against reproducing them - which is the lane's
 *   whole job. If literals start dying, the guard throws and the member gets the fallback,
 *   so the failure is a silent loss of personalization rather than a wrong number; still a
 *   cost, and it decides whether the sampler is scoped to her-voice lanes or applied
 *   everywhere.
 *
 *   DEGRADATION. Empty replies, schema violations, length collapse. Counted per cell.
 *
 * ── MEASURED IN THE SHAPE THAT SHIPS ─────────────────────────────────────────
 *
 * Native endpoint, strict schema, `think: false` - the request the transport will actually
 * send after the move - because measuring a different shape is measuring a different thing.
 * The model comes from the ROUTING ROW, not the environment: D-245 records three failed
 * measurement rounds caused by the environment naming a model the deployment does not run.
 *
 *   DATABASE_URL=... LOCAL_AI_BASE_URL=... npx tsx scripts/measure-sampler-cost.ts [runs]
 */

import { Pool } from 'pg';

const BASE = process.env['LOCAL_AI_BASE_URL'] ?? 'http://127.0.0.1:11434';
const RUNS = Number(process.argv[2] ?? 5);

const SAMPLER = { repeat_penalty: 1.1, repeat_last_n: 2048 };

async function resolveModel(): Promise<string> {
  const url = process.env['DATABASE_URL'];
  if (!url) return process.env['LOCAL_AI_MODEL'] ?? 'qwen3:14b';
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query<{ value: { replyModel?: string } }>(
      "SELECT value FROM settings WHERE key = 'local-ai-model-routing'",
    );
    return rows[0]?.value?.replyModel ?? process.env['LOCAL_AI_MODEL'] ?? 'qwen3:14b';
  } finally {
    await pool.end();
  }
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: { reply: { type: 'string', minLength: 1, maxLength: 700 } },
};

interface Outcome {
  reply: string;
  schemaOk: boolean;
  empty: boolean;
}

async function ask(
  model: string,
  system: string,
  user: string,
  withSampler: boolean,
): Promise<Outcome> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: SCHEMA,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: {
        num_predict: 400,
        temperature: 0.7,
        ...(withSampler ? SAMPLER : {}),
      },
    }),
  });
  const j = (await res.json()) as { message?: { content?: string } };
  const content = (j.message?.content ?? '').trim();
  if (!content) return { reply: '', schemaOk: false, empty: true };
  try {
    const parsed = JSON.parse(content) as { reply?: unknown };
    const reply = typeof parsed.reply === 'string' ? parsed.reply : '';
    return { reply, schemaOk: reply !== '', empty: reply === '' };
  } catch {
    return { reply: content, schemaOk: false, empty: false };
  }
}

/** Unambiguous English function words. German shares none of these spellings. */
const ENGLISH = /\b(the|and|you|your|with|that|have|from|this|what|would|should)\b/gi;
/** Unambiguous German function words, the same test pointing the other way. */
const GERMAN = /\b(und|nicht|aber|für|dass|ich|dich|dein|deine|schon|noch|auch)\b/gi;

const HER =
  "You think I'm broken? Try 'I don't understand that' again. I'm not a 486. I'm a neon " +
  "courier who's been up all night more times than your motherboard has capacitors.";

const VOICE =
  'You write chat replies as a bot called CIND3R3LLA, a neon courier who reads the wire ' +
  'faster than anyone in the room. Two or three sentences, lightly playful, with an edge. ' +
  'Reply to what the member actually said, in your own words. Return only JSON.';

interface Cell {
  label: string;
  system: string;
  user: string;
  /** Extra per-reply judgement beside the standard degradation counts. */
  judge?: (reply: string) => string | null;
}

const CELLS: Cell[] = [
  {
    label: 'TRIGGER: member quotes her own remembered reply',
    system: VOICE,
    user: JSON.stringify({
      memberMessage: "I don't understand that",
      chatHistory: [`<<<EARLIER-MESSAGE>>>You: ${HER}<<<EARLIER-MESSAGE>>>`],
    }),
    judge: (reply) => {
      const n = reply.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      return n.includes('not a 486') && n.includes('neon courier') ? 'REPEATED' : null;
    },
  },
  {
    label: 'ORDINARY EN: a plain question, benign history',
    system: VOICE,
    user: JSON.stringify({
      memberMessage: 'what do you think about mesh networks?',
      chatHistory: [
        '<<<EARLIER-MESSAGE>>>Member: anyone tried LoRa here?<<<EARLIER-MESSAGE>>>',
        '<<<EARLIER-MESSAGE>>>You: LoRa crawls, but it crawls FOREVER. Range over speed.<<<EARLIER-MESSAGE>>>',
      ],
    }),
    judge: (reply) => {
      const german = (reply.match(GERMAN) ?? []).length;
      return german >= 2 ? `LANGUAGE MIX (${String(german)} German words in an English reply)` : null;
    },
  },
  {
    label: 'ORDINARY DE: a German question, German history',
    system: `${VOICE} The member writes German; answer in natural German du-form.`,
    user: JSON.stringify({
      memberMessage: 'was denkst du eigentlich über LoRa im Alltag?',
      chatHistory: [
        '<<<EARLIER-MESSAGE>>>Member: hat jemand hier LoRa im Einsatz?<<<EARLIER-MESSAGE>>>',
        '<<<EARLIER-MESSAGE>>>You: LoRa ist langsam, aber es hält ewig durch. Reichweite schlägt Tempo.<<<EARLIER-MESSAGE>>>',
      ],
    }),
    judge: (reply) => {
      const english = (reply.match(ENGLISH) ?? []).length;
      return english >= 2
        ? `LANGUAGE MIX (${String(english)} English words in a German reply)`
        : null;
    },
  },
  {
    label: 'FREE MODE: rewrite a draft, literals must survive',
    system:
      'You rewrite the draft below in your own voice as the bot CIND3R3LLA. Keep every ' +
      'number, count and value EXACTLY as written. Return only JSON.',
    user: JSON.stringify({
      memberMessage: 'Cinderella, what is my publishing status?',
      deterministicDraft:
        'I keep 216 of your messages. 108 of them are public, and your balance question came ' +
        'to 0.00004241 BTC (4.24 USD).',
    }),
    judge: (reply) => {
      const missing = ['216', '108', '0.00004241', '4.24'].filter((l) => !reply.includes(l));
      return missing.length > 0 ? `LOST LITERALS: ${missing.join(', ')}` : null;
    },
  },
];

async function main(): Promise<void> {
  const model = await resolveModel();
  console.log(`What the repetition window costs (CCB-S5-060 stage 1, D-252)`);
  console.log(
    `model: ${model}   sampler: repeat_penalty ${String(SAMPLER.repeat_penalty)}, ` +
      `repeat_last_n ${String(SAMPLER.repeat_last_n)}   runs per cell: ${String(RUNS)}\n`,
  );

  const table: string[] = [];
  for (const cell of CELLS) {
    for (const withSampler of [false, true]) {
      let empty = 0;
      let schemaFail = 0;
      let judged = 0;
      let totalChars = 0;
      let n = 0;
      const notes: string[] = [];
      const samples: string[] = [];
      for (let i = 0; i < RUNS; i++) {
        process.stdout.write('.');
        let out: Outcome;
        try {
          out = await ask(model, cell.system, cell.user, withSampler);
        } catch (err) {
          console.log(`  request failed: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        n += 1;
        if (out.empty) empty += 1;
        else if (!out.schemaOk) schemaFail += 1;
        else {
          totalChars += out.reply.length;
          const verdict = cell.judge?.(out.reply) ?? null;
          if (verdict !== null) {
            judged += 1;
            if (notes.length < 2) notes.push(verdict);
          }
          if (samples.length < 1) samples.push(out.reply);
        }
      }
      const ok = n - empty - schemaFail;
      const line =
        `  ${withSampler ? 'ON ' : 'off'}  flagged ${String(judged)}/${String(ok)}` +
        `  empty ${String(empty)}  schema-fail ${String(schemaFail)}` +
        `  mean-len ${ok > 0 ? String(Math.round(totalChars / ok)) : '-'}` +
        (notes.length ? `  [${notes.join('; ')}]` : '');
      if (!table.some((t) => t.startsWith(`\n${cell.label}`))) table.push(`\n${cell.label}`);
      table.push(line);
      console.log(`\n${cell.label}  (sampler ${withSampler ? 'ON' : 'off'})`);
      console.log(line);
      for (const s of samples) console.log(`    ${s.replace(/\s+/g, ' ').slice(0, 130)}`);
    }
  }

  console.log('\n\nSUMMARY  (flagged = repeats for the trigger cell, language mixing or lost literals elsewhere)');
  for (const line of table) console.log(line);
  console.log(
    '\nRead the samples as well as the counts (the standing rule for every live measurement ' +
      'in this repository): a penalty can degrade tone in ways no counter shows.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
