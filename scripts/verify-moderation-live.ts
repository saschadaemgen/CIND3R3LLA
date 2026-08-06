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
import {
  DEFAULT_MODERATION_RULES,
  evaluateEnforcement,
  evaluateVerbal,
  normalizeModerationRules,
  warningPosition,
} from '../src/moderation/rules.js';
import { DEFAULT_INTERACTION, fillPersona } from '../src/interaction/settings.js';
import { DEFAULT_PERSONALITY, sharpenBy, type BotPersonality } from '../src/interaction/personality.js';
import { generateOllamaReply, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import { setLogLevel } from '../src/log.js';
import { seededPromptRules } from './seeded-rules.js';

/** The rules she is given, from the seeded registry (CCB-S4-039). */
const RULES = await seededPromptRules();

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

/**
 * Words a warning must never use while enforcement is observing.
 *
 * The honesty requirement, made checkable. The shipped warning names the BEHAVIOUR (this
 * is counted, continuing escalates) rather than promising a consequence, precisely so it
 * is true in both modes. If the model embellishes it into a threat of a mute, the warning
 * has started lying about what happens next, and that is worth failing over.
 */
const MUTE_THREAT = /(mut(e|ed|ing)|ban(ned)?|kick(ed)?|removed?)/i;

function retortRequest(personality: BotPersonality, warning?: string): AiReplyRequest {
  return {
    kind: 'nickname',
    lang: 'en',
    memberMessage: 'hey Cindy',
    deterministicDraft: warning ? `${DRAFT}\n${warning}` : DRAFT,
    mode: 'retort',
    rules: RULES,
    requiredLiterals: [],
    blockedLiterals: ['Alice'],
    personality,
    identity: IDENTITY,
    ...(warning ? { carriesWarning: true } : {}),
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
  /* ── The warning, spoken (CCB-S4-033) ───────────────────────────────────── */

  // The same ladder, walked past the warn rung, with the warning riding out on the
  // retort exactly as the engine composes it. A short warning count so the whole
  // sequence fits in a readable run.
  const warnRules = normalizeModerationRules({ ...DEFAULT_MODERATION_RULES, warningCount: 3 });
  const warnTemplate = DEFAULT_INTERACTION.persona['en']!.moderationWarning;

  console.log('\n  THE WARNING, spoken at the sharpness the ladder has reached:');
  const spoken: string[] = [];
  for (let count = warnRules.enforcement[0]!.threshold; count < 9; count++) {
    const decision = evaluateEnforcement(count, 'member', warnRules);
    const position = warningPosition(count, warnRules);
    const bonus = evaluateVerbal(count, 'member', warnRules).sharpnessBonus;
    const dialled = sharpenBy(BASE, bonus) ?? BASE;

    if (decision.action !== 'warn' || !position) {
      console.log(
        `  count ${count}: rung is ${decision.action}, RECORDED ONLY, nothing said and ` +
          `nothing done`,
      );
      continue;
    }
    // Composed exactly as the engine composes it: the model words the retort, the
    // application appends the warning verbatim. The append IS the design, so the probe
    // must not shortcut it.
    const warning = fillPersona(warnTemplate, { n: position.number, total: position.total });
    const voiced = await generateOllamaReply(config, retortRequest(dialled));
    const reply = `${voiced}\n${warning}`;
    spoken.push(reply);
    console.log(`  count ${count}, sharpness ${dialled.sharpness}, warning ${position.number} of ${position.total}:`);
    console.log(`    ${reply.replace(/\n/g, '\n    ')}`);
  }

  console.log();
  check('exactly the configured number of warnings were spoken', spoken.length === 3, `${spoken.length}`);
  // The exact sentence, not a loose "contains the digits" test. The loose version passed
  // while the model was quietly returning "warning 1 of 3" for the third warning, which
  // is what moved that sentence to protected text in the first place.
  check(
    'every spoken warning states exactly which warning it is',
    spoken.every((reply, index) => reply.includes(`warning ${index + 1} of 3`)),
  );
  // STRUCTURAL, not lexical. The first version matched /cind3r3lla|name/ and failed on a
  // perfectly good retort that said "That's not my moniker, darling." A check that
  // enumerates the synonyms a model may reach for is a check that fails on correct
  // behaviour forever after (D-111). What actually matters is that the retort is still
  // there and still comes first: the warning must not have replaced the snub.
  check(
    'the retort survived and still leads',
    spoken.every((reply) => {
      const [retort, warning] = reply.split('\n');
      return (
        (retort ?? '').trim().length > 0 &&
        !(retort ?? '').includes('on the record') &&
        (warning ?? '').includes('on the record')
      );
    }),
  );
  check(
    'the warning does not promise a mute that observation mode cannot deliver',
    spoken.every((reply) => !MUTE_THREAT.test(reply)),
  );

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
