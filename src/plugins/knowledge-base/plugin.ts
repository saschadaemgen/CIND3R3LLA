/**
 * The Knowledge Base plugin definition (CCB-S5-022, D-176).
 *
 * ── WHY IT IS A PLUGIN AT ALL ────────────────────────────────────────────────
 *
 * Not for symmetry. D-175 said a future per-bot capability should need an inventory row and
 * a constraint rather than a new mechanism, and this is the test of that claim. Registering
 * here means the per-bot switch, the console's three-state control, the audit entry and the
 * absent-capability property all arrive with no code: `cinderella_plugin_overrides` already
 * accepts `enabled` for any plugin id, so the only change was one entry in
 * `src/plugins/scope.ts`. The claim held.
 *
 * ── WHY IT CONTRIBUTES NO INTENT ─────────────────────────────────────────────
 *
 * `intents: []`, and that is the honest shape rather than an omission. PRICE and LOOKUP are
 * things a member ASKS FOR, so they belong in the closed catalog and the resolver decides
 * between them. Knowing something is not a request a member makes; it is a thing she either
 * has or does not have while answering an ordinary question.
 *
 * So the absent-capability property here is not "the intent leaves the catalog". It is that
 * `retrieve()` is never called, no vector is ever computed, and no chunk is ever put in front
 * of the model, because the engine's knowledge port is null for a bot the plugin is off for.
 * Same guarantee, one layer down, and `verify:knowledge` proves it with a spy rather than by
 * inspecting a catalog.
 *
 * ── OFF BY DEFAULT ───────────────────────────────────────────────────────────
 *
 * A bot with no documents retrieves nothing anyway, so this is not a safety default in the
 * way web search's is. It is off because a capability the operator has not asked for should
 * not start costing an embedding call on every message.
 */

import { definePlugin } from '../registry.js';

export const KNOWLEDGE_BASE_ID = 'knowledge-base';

export const knowledgeBasePlugin = definePlugin({
  id: KNOWLEDGE_BASE_ID,
  name: 'Knowledge Base',
  description:
    'Lets her answer from documents you give her, quoting nothing she was not given and saying which document an answer came from. Documents are granted per bot.',
  version: '1.0.0',
  defaultEnabled: false,
  // See the header: knowing something is not an intent a member can ask for.
  intents: [],
  adminPath: '/plugins/knowledge-base',
});
