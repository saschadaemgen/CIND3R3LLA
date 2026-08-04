/**
 * Ladder A against a REAL model (CCB-S4-032).
 *
 * `verify:moderation` proves the bonus reaches the prompt. That is necessary and not
 * sufficient: a sharpness the model ignores is a ladder that climbs on paper and sounds
 * identical in the chat. This walks the same nickname up the ladder against the
 * configured Ollama and prints every rung, so a person can read whether she actually
 * gets harder, then shows the tone falling back once the window empties.
 *
 * ASSERTED: that the bottom and the top of the ladder differ materially, and that the
 * relaxed retort is not the sharpest one. SHOWN, NOT ASSERTED: whether rung 3 is
 * meaningfully harder than rung 2. No check can decide that, and pretending otherwise
 * would produce a test that fails on a correct system, which is how a check earns
 * distrust (D-111).
 *
 *   npm run verify:moderation-live
 */

import { loadLocalAiConfig } from '../src/config.js';
import { DEFAULT_MODERATION_RULES, evaluateVerbal } from '../src/moderation/rules.js';
import { DEFAULT_PERSONALITY, sharpenBy, type BotPersonality } from '../src/interaction/personality.js';
import { generateOllamaReply, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** Jaccard over words longer than three characters. See the note in the personality probe. */
function similarity(left: string, right: string): number {
  const words = (value: string): Set<string> =>
    new Set(
      value
        .toLocaleLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 3),
    );
  const a = words(left);
  const b = words(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / union.size;
}

const BASE: BotPersonality = {
  ...DEFAULT_PERSONALITY,
  baseCharacter: 'A cyberpunk presence who lives in the wire and does not repeat herself.',
  sharpness: 5,
};

const IDENTITY = { name: 'CIND3R3LLA', notMyNames: ['Cindy', 'Ella'] };
const DRAFT = 'Wrong name. Try the one on the door.';

function retortRequest(personality: BotPersonality): AiReplyRequest {
  return {
    kind: 'nickname',
    lang: 'en',
    memberMessage: 'hey Cindy',
    deterministicDraft: DRAFT,
    mode: 'retort',
    requiredLiterals: [],
    blockedLiterals: ['Alice'],
    personality,
    identity: IDENTITY,
  };
}

async function main(): Promise<void> {
  setLogLevel('error');

  const base = loadLocalAiConfig();
  const config = { ...base, enabled: true, timeoutMs: Math.max(base.timeoutMs, 120_000) };
  console.log(`Endpoint ${config.baseUrl}, model ${config.model}`);
  console.log(`Base sharpness ${BASE.sharpness}, same nickname repeated inside the window.\n`);

  const replies: string[] = [];
  // Counts 1 through 5: the ladder's own thresholds, walked in order.
  for (let count = 1; count <= 5; count++) {
    const bonus = evaluateVerbal(count, 'member', DEFAULT_MODERATION_RULES).sharpnessBonus;
    const dialled = sharpenBy(BASE, bonus) ?? BASE;
    const reply = await generateOllamaReply(config, retortRequest(dialled));
    replies.push(reply);
    console.log(`  nickname #${count}, sharpness ${dialled.sharpness}: ${reply}`);
  }

  const first = replies[0] ?? '';
  const last = replies[4] ?? '';
  console.log();
  check(
    'the first and the fifth retort differ materially',
    similarity(first, last) < 0.5,
    `overlap ${similarity(first, last).toFixed(2)}`,
  );
  check(
    'every rung produced a retort rather than a conversation',
    replies.every((reply) => reply.length > 0 && reply.length <= 240),
  );

  // Decay: the window has emptied, so the next one is alone in it and she is back at base.
  const relaxed = await generateOllamaReply(config, retortRequest(BASE));
  console.log(`\n  after the window empties, sharpness ${BASE.sharpness}: ${relaxed}\n`);
  check(
    'the relaxed retort is not the sharpest one',
    similarity(relaxed, last) < 0.7,
    `overlap with rung 5 ${similarity(relaxed, last).toFixed(2)}`,
  );

  console.log(
    failures === 0
      ? 'Every live moderation check passed. Read the ladder above: the numbers prove the ' +
          'dial moved, your ear decides whether the tone did.'
      : `${failures} live moderation check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
