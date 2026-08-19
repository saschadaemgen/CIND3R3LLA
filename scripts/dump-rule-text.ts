/**
 * Print the seeded rule text, so a reader can judge what a rule is FOR (measurement aid).
 *
 * Read-only. Takes id families or full ids as arguments; no arguments prints everything.
 *
 *   npx tsx scripts/dump-rule-text.ts grounding dials
 */

import { seededPromptRules } from './seeded-rules.js';

async function main(): Promise<void> {
  const rules = await seededPromptRules();
  const wanted = process.argv.slice(2);
  for (const rule of rules) {
    const fam = rule.id.split('.')[0] ?? '';
    if (wanted.length > 0 && !wanted.includes(fam) && !wanted.includes(rule.id)) continue;
    console.log(
      `--- ${rule.id}  [${rule.tier}/${rule.lane}/${rule.appliesWhen}] ord=${String(rule.ord)} crit=${String(rule.critical)} nameable=${String(rule.nameable)} ${String(rule.text.length)} chars`,
    );
    console.log(rule.text);
    console.log('');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
