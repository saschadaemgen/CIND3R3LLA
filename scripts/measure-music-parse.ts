/**
 * What the resolver and the music lane actually receive, per sentence (CCB-S5-048).
 *
 * Four production faults share one shape: the music lane understands a narrow set of
 * phrasings, and a sentence outside it falls through to the model, which invents. This
 * reports what each sentence resolves to BEFORE anything is changed, so the fall-through can
 * be seen rather than argued about.
 *
 * It drives the REAL exported resolver (`ruleResolver`) and the REAL exported predicate
 * (`asksForMusic`). The engine's own MUSIC_* regexes are module-private, so they are NOT
 * reimplemented here - reimplementing them would be a second model of the code and D-111 is
 * explicit about where that leads. Where a private predicate decides the branch, this prints
 * the file:line that decides it and leaves the reading to the report.
 *
 *   npx tsx scripts/measure-music-parse.ts
 */

import { asksForMusic, ruleResolver } from '../src/interaction/rules.js';
import type { IntentContext } from '../src/interaction/intent.js';

/** A bot holding every capability, so nothing is refused for lacking the plugin. */
const CTX: IntentContext = {
  threshold: 0.55,
  defaultLanguage: 'en',
  intents: ['PUBLISH', 'UNPUBLISH', 'STATUS', 'HELP', 'PRICE', 'SEARCH', 'LOOKUP', 'MUSIC', 'UNKNOWN'] as never,
};

/** The four sentences, exactly as the member typed them. */
const CASES: { label: string; text: string; note: string }[] = [
  {
    label: 'FAULT 1 - bare number after a playlist listing',
    text: '1',
    note: 'expected playlist one\'s tracks; got a genre dump',
  },
  {
    label: 'FAULT 2 - abbreviated listing request',
    text: 'show me pls 1',
    note: 'INVENTED a track that does not exist',
  },
  {
    label: 'FAULT 2b - the phrasing that worked',
    text: 'show me playlist 1',
    note: 'correctly listed the three real tracks',
  },
  {
    label: 'FAULT 3 - the natural full phrasing',
    text: 'play track 1 from playlist 1',
    note: '"I hold no track by that name"',
  },
  {
    label: 'FAULT 4a - the genre ask',
    text: 'can you play rock?',
    note: 'offered a track (correct)',
  },
  {
    label: 'FAULT 4b - the offer taken',
    text: 'yes',
    note: 'announced a play; nothing arrived',
  },
];

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main(): Promise<void> {
  console.log('\nWHAT THE RESOLVER RECEIVES, PER SENTENCE');
  console.log('Driving the real ruleResolver and the real asksForMusic. No reimplementation.\n');

  for (const c of CASES) {
    const resolved = await ruleResolver.resolve(c.text, CTX);
    const music = asksForMusic(c.text);
    console.log(`  ${c.label}`);
    console.log(`    typed:        ${JSON.stringify(c.text)}`);
    console.log(`    observed:     ${c.note}`);
    console.log(
      `    resolver:     intent=${pad(String(resolved.intent), 9)} confidence=${String(resolved.confidence)}`,
    );
    console.log(`    asksForMusic: ${String(music)}`);
    console.log(
      `    => ${
        resolved.intent === 'MUSIC'
          ? 'CLAIMED by the music lane'
          : music
            ? 'asksForMusic is true but the resolver did not claim MUSIC'
            : 'NOT claimed: falls through to the UNKNOWN branch'
      }`,
    );
    console.log('');
  }

  console.log('WHERE AN UNCLAIMED SENTENCE GOES (read from the source, cited not guessed)');
  console.log('  engine.ts:1369   case UNKNOWN:  if (!explicit) return false;');
  console.log('                   A bare in-window message stops HERE, before the music lane.');
  console.log('  engine.ts:1394   if (await this.unclaimedMusicAsk(...)) -> answerMusicSafely');
  console.log('                   Reached only when the message was EXPLICITLY addressed.');
  console.log('  engine.ts:1399   if (await this.freeConversation(...)) return true;');
  console.log('                   The fall-through. The model answers, holding the DJ sheet,');
  console.log('                   and nothing downstream requires its answer to be true.');
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
