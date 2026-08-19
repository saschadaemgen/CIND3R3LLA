/**
 * Where the prompt's characters actually go (CCB-S5-045 measurement pass).
 *
 * ── WHY THIS IS AN ATTRIBUTION AND NOT AN ESTIMATE ───────────────────────────
 *
 * The console's "What it costs" card assembles a real prompt and counts it, which answers
 * "how big" and nothing else. This answers "big because of what": it selects through the
 * SAME exported derivation the reply path uses, renders each rule the same way, and then
 * PROVES the attribution by reassembling the pieces and comparing them, character for
 * character, against `systemPrompt`. If the reassembly does not match, the breakdown is a
 * story about the prompt rather than the prompt, and this script says so and exits non-zero.
 *
 * It reads the SEEDED registry (`scripts/seeded-rules.ts`, PGlite, no server), so it
 * measures what ships. A deployment whose operator has edited a law in the Book of Elii, or
 * whose bot carries per-bot overrides from migration 045, will differ; that difference is
 * exactly what the Book's own drift badge is for, and it is stated in the output.
 *
 * Nothing here writes anything. It is a report.
 *
 *   npx tsx scripts/measure-prompt.ts
 *   npx tsx scripts/measure-prompt.ts --rules      (every rule, sorted by cost)
 *   npx tsx scripts/measure-prompt.ts --dead       (reachability sweep only)
 */

import {
  systemPrompt,
  type AiReplyMode,
  type AiReplyRequest,
} from '../src/interaction/ollama-reply.js';
import {
  DEFAULT_ORIGIN,
  DEFAULT_PERSONALITY,
  dialledPromptInputs,
  replyCharBudget,
  type BotPersonality,
  type CurrentTime,
  type MusicPromptFacts,
} from '../src/interaction/personality.js';
import {
  NOTHING_IN_SCOPE,
  PROMPT_RULE_CONDITIONS,
  conditionHolds,
  lanesForMode,
  promptRulePlaceholders,
  renderPromptRule,
  selectPromptRules,
  type PromptRule,
  type PromptRuleContext,
  type PromptRuleSet,
} from '../src/interaction/prompt-rules.js';
import { seededPromptRules } from './seeded-rules.js';

const NOW: CurrentTime = { at: new Date('2026-08-18T12:00:00.000Z'), timeZone: 'Europe/Berlin' };

interface Scenario {
  id: string;
  what: string;
  mode: AiReplyMode;
  personality: BotPersonality | null;
  identity?: Record<string, unknown>;
  music?: MusicPromptFacts;
  /** A remembered thread in scope, which swaps the has-no-history rule for five others. */
  history?: boolean;
}

/** The character-and-origin pair a bot carries. Lengths are what matter here. */
function bot(over: Partial<BotPersonality> = {}): BotPersonality {
  return { ...DEFAULT_PERSONALITY, origin: DEFAULT_ORIGIN, ...over };
}

const CINDERELLA_CHARACTER =
  'Precise, dry, and unhurried. She answers the question that was asked and stops.';

const IDENTITY_FULL = {
  name: 'CIND3R3LLA',
  label: '(SimpleX AI Bot)',
  archiveUrl: 'https://archive.example.org',
  projectUrl: 'https://project.example.org',
  notMyNames: ['Cindy', 'Ella', 'Cinders'],
  model: 'qwen3:32b',
};

const RICK_IDENTITY = {
  name: 'Sanchez',
  label: '(SimpleX AI Bot)',
  archiveUrl: 'https://archive.example.org',
  projectUrl: 'https://project.example.org',
  notMyNames: ['Rick'],
  model: 'qwen3:32b',
};

const SCENARIOS: Scenario[] = [
  {
    id: 'cinderella',
    what: 'CIND3R3LLA: character + shipped origin, full identity, music library on',
    mode: 'conversation',
    personality: bot({ baseCharacter: CINDERELLA_CHARACTER }),
    identity: IDENTITY_FULL,
    music: { tracks: 214, genres: ['ambient', 'techno', 'folk', 'jazz'], playlists: 6 },
  },
  {
    id: 'cinderella-with-history',
    what: 'CIND3R3LLA once a thread is remembered (the rules half only, not the quoted history)',
    mode: 'conversation',
    personality: bot({ baseCharacter: CINDERELLA_CHARACTER }),
    identity: IDENTITY_FULL,
    music: { tracks: 214, genres: ['ambient', 'techno', 'folk', 'jazz'], playlists: 6 },
    history: true,
  },
  {
    id: 'cinderella-no-music',
    what: 'CIND3R3LLA with the music plugin off',
    mode: 'conversation',
    personality: bot({ baseCharacter: CINDERELLA_CHARACTER }),
    identity: IDENTITY_FULL,
  },
  {
    id: 'rick',
    what: 'Rick: character + inherited origin, no music',
    mode: 'conversation',
    personality: bot({ baseCharacter: 'Abrasive, brilliant, allergic to being asked twice.' }),
    identity: RICK_IDENTITY,
  },
  {
    id: 'rick-no-origin',
    what: 'Rick with the origin cleared',
    mode: 'conversation',
    personality: bot({
      baseCharacter: 'Abrasive, brilliant, allergic to being asked twice.',
      origin: '',
    }),
    identity: RICK_IDENTITY,
  },
  {
    id: 'retort',
    what: 'The nickname retort lane (CIND3R3LLA)',
    mode: 'retort',
    personality: bot({ baseCharacter: CINDERELLA_CHARACTER }),
    identity: IDENTITY_FULL,
    music: { tracks: 214, genres: ['ambient', 'techno', 'folk', 'jazz'], playlists: 6 },
  },
  {
    id: 'free',
    what: 'The command-rewrite lane (no voice at all)',
    mode: 'free',
    personality: bot({ baseCharacter: CINDERELLA_CHARACTER }),
    identity: IDENTITY_FULL,
  },
];

/** The context and values a scenario produces, exactly as `systemPrompt` derives them. */
function inputsFor(
  scenario: Scenario,
  rules: PromptRuleSet,
): { context: PromptRuleContext; values: Record<string, string> } {
  const dialled =
    scenario.mode === 'conversation' ||
    scenario.mode === 'retort' ||
    scenario.mode === 'searching';

  const base = dialled
    ? dialledPromptInputs(
        rules,
        scenario.personality,
        scenario.identity as never,
        NOW,
        scenario.music,
      )
    : { context: NOTHING_IN_SCOPE, values: {} as Record<string, string> };

  const outputMaxChars = replyCharBudget(scenario.personality?.verbosity ?? 5);

  return {
    context: {
      ...base.context,
      hasWebResults: false,
      hasKnowledge: false,
      hasHistory: scenario.history === true,
      hasNameableRules: false,
      hasWithheldRules: false,
      hasRuleOverview: false,
      hasMoreInArea: false,
      hasInvocationRecord: false,
      hasLawPage: false,
    },
    values: {
      ...base.values,
      maxChars: String(outputMaxChars),
      fence: '<<<UNTRUSTED-WEB-CONTENT>>>',
      historyFence: '<<<UNTRUSTED-CHAT-HISTORY>>>',
      knowledgeFence: '<<<REFERENCE-DOCUMENT>>>',
      historyCount: scenario.history === true ? '20' : '0',
      historyMinutes: scenario.history === true ? '30' : '0',
      ruleTotal: '0',
      ruleConstitutional: '0',
      ruleAreas: '',
      moreInArea: '0',
      ruleInvocations: '',
      nameableRules: '',
    },
  };
}

/** The real prompt, through the real function, so the attribution has something to prove. */
function realPrompt(scenario: Scenario, rules: PromptRuleSet): string {
  const request: AiReplyRequest = {
    kind: 'conversation',
    lang: 'en',
    memberMessage: '',
    deterministicDraft: '',
    mode: scenario.mode,
    rules,
    personality: scenario.personality,
    ...(scenario.identity ? { identity: scenario.identity as never } : {}),
    now: NOW,
    history:
      scenario.history === true
        ? Array.from({ length: 20 }, () => ({ speaker: 'Member', text: '' }))
        : [],
    historyWindowMinutes: scenario.history === true ? 30 : 0,
    ...(scenario.music ? { music: scenario.music } : {}),
  };
  return systemPrompt(request, replyCharBudget(scenario.personality?.verbosity ?? 5));
}

interface Line {
  rule: PromptRule;
  rendered: string;
  /** The authored sentence, minus every placeholder token. */
  authored: number;
  /** What the application injected into it: origin, character, dial block, facts. */
  injected: { key: string; chars: number }[];
  total: number;
}

function attribute(rule: PromptRule, values: Record<string, string>): Line {
  const rendered = renderPromptRule(rule, values);
  const injected: { key: string; chars: number }[] = [];
  let tokenChars = 0;
  for (const key of promptRulePlaceholders(rule)) {
    const occurrences = rule.text.split(`{{${key}}}`).length - 1;
    tokenChars += occurrences * (key.length + 4);
    injected.push({ key, chars: occurrences * (values[key] ?? '').length });
  }
  return {
    rule,
    rendered,
    authored: rule.text.length - tokenChars,
    injected,
    total: rendered.length,
  };
}

/** The id family: everything before the first dot. `ceiling.hard-limit` -> `ceiling`. */
function family(id: string): string {
  const dot = id.indexOf('.');
  return dot === -1 ? id : id.slice(0, dot);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const rules = await seededPromptRules();

  console.log('');
  console.log('THE SEEDED REGISTRY');
  console.log(`  ${String(rules.length)} rules on disk, ${String(rules.filter((r) => r.enabled).length)} enabled, ${String(rules.filter((r) => !r.enabled).length)} disabled.`);
  console.log(`  ${String(rules.filter((r) => r.tier === 'constitutional').length)} constitutional, ${String(rules.filter((r) => r.tier === 'standard').length)} standard, ${String(rules.filter((r) => r.tier === 'bot').length)} bot-tier.`);
  console.log(`  ${String(rules.filter((r) => r.critical).length)} critical, ${String(rules.filter((r) => r.nameable).length)} nameable.`);
  console.log('');

  if (!flags.has('--dead')) {
    for (const scenario of SCENARIOS) {
      const { context, values } = inputsFor(scenario, rules);
      const selected = selectPromptRules(rules, lanesForMode(scenario.mode), context);
      const lines = selected.map((rule) => attribute(rule, values));

      // THE PROOF. If this fails the breakdown below is fiction.
      const reassembled = lines.map((l) => l.rendered).join('\n');
      const real = realPrompt(scenario, rules);
      const faithful = reassembled === real;

      const total = real.length;
      console.log('='.repeat(96));
      console.log(`${scenario.id}  -  ${scenario.what}`);
      console.log(
        `  ${String(total)} characters  (~${String(Math.round(total / 3.2))} tokens of 8192, ${pct(total / 3.2, 8192)})` +
          `  from ${String(selected.length)} rules` +
          `  [attribution ${faithful ? 'PROVEN against systemPrompt' : 'DOES NOT MATCH systemPrompt'}]`,
      );
      if (!faithful) {
        console.log(`  reassembled ${String(reassembled.length)} vs real ${String(total)}`);
        process.exitCode = 1;
      }
      console.log('');

      // Authored prose vs injected data.
      const authored = lines.reduce((sum, l) => sum + l.authored, 0);
      const injectedTotal = lines.reduce(
        (sum, l) => sum + l.injected.reduce((s, i) => s + i.chars, 0),
        0,
      );
      const newlines = Math.max(0, lines.length - 1);
      console.log('  WHAT KIND OF CHARACTER IT IS');
      console.log(`    ${padLeft(String(authored), 7)}  ${padLeft(pct(authored, total), 7)}  authored rule text`);
      console.log(`    ${padLeft(String(injectedTotal), 7)}  ${padLeft(pct(injectedTotal, total), 7)}  injected values (origin, character, dials, facts)`);
      console.log(`    ${padLeft(String(newlines), 7)}  ${padLeft(pct(newlines, total), 7)}  line separators`);
      console.log('');

      // Every injected value, by size.
      const byValue = new Map<string, number>();
      for (const line of lines) {
        for (const inj of line.injected) {
          byValue.set(inj.key, (byValue.get(inj.key) ?? 0) + inj.chars);
        }
      }
      if (byValue.size > 0) {
        console.log('  INJECTED VALUES, BY COST');
        for (const [key, chars] of [...byValue].sort((a, b) => b[1] - a[1])) {
          console.log(`    ${padLeft(String(chars), 7)}  ${padLeft(pct(chars, total), 7)}  {{${key}}}`);
        }
        console.log('');
      }

      // By tier.
      console.log('  BY TIER');
      for (const tier of ['constitutional', 'standard', 'bot'] as const) {
        const group = lines.filter((l) => l.rule.tier === tier);
        if (group.length === 0) continue;
        const chars = group.reduce((s, l) => s + l.total, 0);
        console.log(
          `    ${padLeft(String(chars), 7)}  ${padLeft(pct(chars, total), 7)}  ${pad(tier, 16)} ${padLeft(String(group.length), 3)} rules`,
        );
      }
      console.log('');

      // By lane.
      console.log('  BY LANE');
      const lanes = new Map<string, Line[]>();
      for (const line of lines) {
        const list = lanes.get(line.rule.lane) ?? [];
        list.push(line);
        lanes.set(line.rule.lane, list);
      }
      for (const [lane, group] of [...lanes].sort(
        (a, b) =>
          b[1].reduce((s, l) => s + l.total, 0) - a[1].reduce((s, l) => s + l.total, 0),
      )) {
        const chars = group.reduce((s, l) => s + l.total, 0);
        console.log(
          `    ${padLeft(String(chars), 7)}  ${padLeft(pct(chars, total), 7)}  ${pad(lane, 16)} ${padLeft(String(group.length), 3)} rules`,
        );
      }
      console.log('');

      // By family, which is the unit an operator would actually cut.
      console.log('  BY FAMILY, SORTED BY COST');
      const families = new Map<string, Line[]>();
      for (const line of lines) {
        const key = family(line.rule.id);
        const list = families.get(key) ?? [];
        list.push(line);
        families.set(key, list);
      }
      const ranked = [...families].sort(
        (a, b) =>
          b[1].reduce((s, l) => s + l.total, 0) - a[1].reduce((s, l) => s + l.total, 0),
      );
      let running = 0;
      for (const [key, group] of ranked) {
        const chars = group.reduce((s, l) => s + l.total, 0);
        running += chars;
        const con = group.filter((l) => l.rule.tier === 'constitutional').length;
        const crit = group.filter((l) => l.rule.critical).length;
        console.log(
          `    ${padLeft(String(chars), 7)}  ${padLeft(pct(chars, total), 7)}  ${pad(key, 16)}` +
            ` ${padLeft(String(group.length), 3)} rules  ${padLeft(String(con), 3)} constitutional  ${padLeft(String(crit), 3)} critical` +
            `  (running ${pct(running, total)})`,
        );
      }
      console.log('');

      if (flags.has('--rules')) {
        console.log('  EVERY RULE, SORTED BY COST');
        for (const line of [...lines].sort((a, b) => b.total - a.total)) {
          const inj = line.injected.filter((i) => i.chars > 0);
          const injNote =
            inj.length === 0
              ? ''
              : `  [+${inj.map((i) => `${i.key} ${String(i.chars)}`).join(', ')}]`;
          console.log(
            `    ${padLeft(String(line.total), 6)}  ${pad(line.rule.id, 40)} ${pad(line.rule.tier.slice(0, 5), 6)} ${pad(line.rule.lane, 13)} ${pad(line.rule.appliesWhen, 26)}${line.rule.critical ? ' CRIT' : '     '}${line.rule.nameable ? ' name' : '     '}${injNote}`,
          );
        }
        console.log('');
      }
    }
  }

  // ── REACHABILITY ───────────────────────────────────────────────────────────
  // A condition nothing can make true is a rule nobody is ever told. This asks the
  // question over the vocabulary rather than over the cases somebody remembered.
  console.log('='.repeat(96));
  console.log('REACHABILITY');
  console.log('');

  const disabled = rules.filter((r) => !r.enabled);
  console.log(`  DISABLED IN THE SEED: ${String(disabled.length)}`);
  for (const rule of disabled) {
    console.log(`    ${pad(rule.id, 44)} ${rule.tier}/${rule.lane}/${rule.appliesWhen}  ${String(rule.text.length)} chars`);
  }
  console.log('');

  // Which conditions carry rules, and how many, per condition.
  console.log('  CONDITIONS: rules held, and cost when they fire');
  for (const condition of PROMPT_RULE_CONDITIONS) {
    const held = rules.filter((r) => r.appliesWhen === condition && r.enabled);
    if (held.length === 0) {
      console.log(`    ${pad(condition, 32)} ${padLeft('0', 3)} rules   <- NO ENABLED RULE USES THIS CONDITION`);
      continue;
    }
    const chars = held.reduce((s, r) => s + r.text.length, 0);
    console.log(
      `    ${pad(condition, 32)} ${padLeft(String(held.length), 3)} rules ${padLeft(String(chars), 7)} chars of authored text`,
    );
  }
  console.log('');

  // Lanes that no mode draws from.
  const reachableLanes = new Set<string>();
  for (const mode of ['conversation', 'retort', 'searching', 'free', 'locked'] as const) {
    for (const lane of lanesForMode(mode)) reachableLanes.add(lane);
  }
  reachableLanes.add('dial-axis'); // rendered as a template, not selected into the stream
  const orphanLanes = new Set(
    rules.filter((r) => !reachableLanes.has(r.lane)).map((r) => r.lane),
  );
  console.log(`  LANES NO MODE DRAWS FROM: ${orphanLanes.size === 0 ? 'none' : [...orphanLanes].join(', ')}`);
  const orphanRules = rules.filter((r) => !reachableLanes.has(r.lane));
  for (const rule of orphanRules) {
    console.log(`    ${pad(rule.id, 44)} lane ${rule.lane}  ${String(rule.text.length)} chars`);
  }
  console.log('');

  // A rule whose condition can never hold in its own lane.
  console.log('  RULES WHOSE CONDITION CANNOT HOLD IN THEIR LANE');
  const commandLanes = new Set(['command', 'free', 'locked']);
  let unreachable = 0;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.lane === 'dial-axis') continue;
    if (!commandLanes.has(rule.lane)) continue;
    // The command lanes are built with NOTHING_IN_SCOPE, so any condition that needs a
    // fact in scope can never hold there.
    if (!conditionHolds(rule.appliesWhen, NOTHING_IN_SCOPE)) {
      unreachable++;
      console.log(
        `    ${pad(rule.id, 44)} lane ${pad(rule.lane, 8)} needs ${rule.appliesWhen}  ${String(rule.text.length)} chars`,
      );
    }
  }
  if (unreachable === 0) console.log('    none');
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
