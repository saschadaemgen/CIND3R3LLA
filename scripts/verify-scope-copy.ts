/**
 * Does every console page SAY what its settings are scoped to? (CCB-S5-041, D-212)
 *
 * The operator set one bot's greeting believing it was shared, because `/welcome` named no
 * bot. The picker was present and worked; the COPY contradicted it, and the copy is what he
 * was reading while he typed. He has hit three of these by accident and wants the count.
 *
 * ── DERIVED, NOT JUDGED ─────────────────────────────────────────────────────
 *
 * A page's scope is not an opinion. `PLUGIN_SETTING_SCOPES` already records every plugin
 * setting as per-bot or shared, and a view's own calls say which it touches:
 *
 *   listPluginOverridesForBot / setPluginOverride / resolveSelectedBot   PER-BOT
 *   plugins.getStates / setPluginState / writeSetting                    SHARED
 *
 * A page doing both is MIXED and owes the distinction `knowledge` already draws.
 * A page doing neither is UNCLASSIFIABLE and is reported as such rather than guessed at -
 * which usually means it reads settings from somewhere this inventory does not cover, and
 * that is itself the finding.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join('src', 'web', 'views');
// EDIT signals only. Bare `botProfileId` was here and classified ai.ts as per-bot
// because a diagnostics table DISPLAYS which bot a session belonged to - a page that
// shows data about bots is not a page that edits one. A form field posting the id is
// an edit; a property read is not.
const PER_BOT = [/listPluginOverridesForBot/, /listSettingOverridesForBot/, /setPluginOverride/, /resolveSelectedBot/, /name="botProfileId"/];
const SHARED = [/plugins\.getStates/, /setPluginState/, /writeSetting/, /updateSettings/, /setAiRuntimeEnabled/];
/**
 * Names a bot in its own copy: an interpolated selected name, or - the capture.ts
 * false positive this sweep shipped with - copy that explicitly frames itself as a
 * COMPARISON across bots ("Which bot records which room"), and per-row interpolated
 * bot names. A comparison page has no single bot to name, and demanding one produced
 * a work list with a page on it that was already right.
 */
const NAMES_BOT = [/selectedName/, /\$\{botName\}/, /selection\.selectedName/, /botNames?\.get\(/, /which bot/i];
const SAYS_SHARED = [/deployment-wide/i, /every bot/i, /reaches every/i, /shared/i];

const rows: { file: string; scope: string; says: string; verdict: string }[] = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.ts') && n !== 'index.ts')) {
  const src = readFileSync(join(DIR, f), 'utf8');
  if (!src.includes('page({')) continue;
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const perBot = PER_BOT.some((r) => r.test(code));
  const shared = SHARED.some((r) => r.test(code));
  const scope = perBot && shared ? 'MIXED' : perBot ? 'per-bot' : shared ? 'shared' : 'UNCLASSIFIABLE';
  const namesBot = NAMES_BOT.some((r) => r.test(code));
  const saysShared = SAYS_SHARED.some((r) => r.test(code));
  const says = `${namesBot ? 'names-bot ' : ''}${saysShared ? 'says-shared' : ''}`.trim() || 'says nothing';
  let verdict = 'ok';
  if (scope === 'per-bot' && !namesBot) verdict = 'SILENT: per-bot page names no bot';
  else if (scope === 'shared' && !saysShared) verdict = 'SILENT: shared page does not say so';
  else if (scope === 'MIXED' && !(namesBot && saysShared)) verdict = 'MIXED but does not distinguish';
  else if (scope === 'UNCLASSIFIABLE') verdict = 'UNCLASSIFIABLE - reads settings elsewhere?';
  rows.push({ file: f, scope, says, verdict });
}
rows.sort((a, b) => (a.verdict === 'ok' ? 1 : 0) - (b.verdict === 'ok' ? 1 : 0) || a.file.localeCompare(b.file));
for (const r of rows) {
  console.log(`  ${r.verdict === 'ok' ? '[ ok ]' : '[FAIL]'} ${r.file.padEnd(20)} ${r.scope.padEnd(15)} ${r.says.padEnd(22)} ${r.verdict === 'ok' ? '' : r.verdict}`);
}
const bad = rows.filter((r) => r.verdict !== 'ok');
console.log(`\n${String(rows.length)} views with a page(); ${String(bad.length)} do not state their scope.`);
