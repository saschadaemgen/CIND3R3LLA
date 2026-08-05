/**
 * The Web Search plugin definition (CCB-S4-037, D-141).
 *
 * ── OFF BY DEFAULT, AND NOT AS A COURTESY ────────────────────────────────────
 *
 * Every other plugin decision in this codebase defaults to the safe side, and here the
 * safe side is loud: enabling this makes outbound requests to a third party, it may cost
 * the operator money, and it pulls text written by strangers into the prompt of a model
 * that follows instructions. An operator has to choose all three of those, deliberately,
 * on a page that says so.
 *
 * The registry's load-bearing rule does the rest: while the plugin is off, LOOKUP is
 * ABSENT from the active catalog, so the rule engine never matches its patterns and the
 * resolver seam downgrades anything claiming it to UNKNOWN. Not "registered and refusing",
 * absent. That is what makes the off switch structural rather than a branch somebody can
 * forget to write.
 */

import { definePlugin } from '../registry.js';

export const WEB_SEARCH_ID = 'web-search';

export const webSearchPlugin = definePlugin({
  id: WEB_SEARCH_ID,
  name: 'Web Search',
  description:
    'Looks a question up on the web and lets her answer from what it found, with the sources named. Results are treated as untrusted text and can never trigger an action.',
  version: '1.0.0',
  // See the header. This one is off until somebody says otherwise.
  defaultEnabled: false,
  intents: ['LOOKUP'],
  adminPath: '/plugins/web-search',
});
