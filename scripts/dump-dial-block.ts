/**
 * The rendered dial block, line by line, with duplicates counted (measurement aid).
 *
 * Read-only. The block is the single most expensive thing in the prompt, and it is a
 * TEMPLATE rendered once per axis, so a template line carrying no axis placeholder is
 * emitted five times identically. This prints that rather than asserting it.
 *
 *   npx tsx scripts/dump-dial-block.ts
 */

import { conversationVoice, DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { seededPromptRules } from './seeded-rules.js';

async function main(): Promise<void> {
  const rules = await seededPromptRules();
  const voice = conversationVoice(rules, { ...DEFAULT_PERSONALITY, baseCharacter: 'x' });
  const block = voice.find((line) => line.includes('of 10 ('));
  if (block === undefined) {
    console.log('No dial block found.');
    return;
  }

  const lines = block.split('\n');
  console.log(`The dial block: ${String(block.length)} characters, ${String(lines.length)} lines.`);
  console.log('');

  const seen = new Map<string, number>();
  for (const line of lines) seen.set(line, (seen.get(line) ?? 0) + 1);

  for (const line of lines) {
    console.log(`  [${String(line.length).padStart(4)}] ${line}`);
  }
  console.log('');

  console.log('REPEATED LINES');
  let wasted = 0;
  for (const [line, count] of seen) {
    if (count < 2) continue;
    const cost = line.length * (count - 1);
    wasted += cost;
    console.log(`  x${String(count)}  ${String(line.length)} chars each, ${String(cost)} redundant`);
    console.log(`       "${line.slice(0, 110)}${line.length > 110 ? '...' : ''}"`);
  }
  console.log('');
  console.log(`  Redundant characters in the dial block: ${String(wasted)} of ${String(block.length)}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
