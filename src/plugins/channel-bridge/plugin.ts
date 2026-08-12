/**
 * The Channel Bridge plugin definition (CCB-S5-032, D-187).
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────────────
 *
 * A SimpleX channel post becomes a standing announcement the bot brings into a
 * group on a cadence, so members who were not looking still see it. Per D-175
 * the CAPABILITY and the MAPPINGS are per bot; the safety bounds are shared.
 * Registering here buys the per-bot switch, the console's three-state control,
 * the audit entry and the absent-capability property for one inventory row,
 * exactly as the knowledge base proved the pattern.
 *
 * ── WHY IT CONTRIBUTES NO INTENT ─────────────────────────────────────────────
 *
 * `intents: []`. The bridge is not something a member asks for in chat; it runs
 * on the operator's cadence, from the operator's channel, on the operator's
 * mappings. So the absent-capability property is one layer down, as with the
 * knowledge base: for a bot the plugin is off for, the intake stores nothing
 * and the tick plans nothing, and `verify:bridge` proves it with a spy rather
 * than by inspecting a catalog.
 *
 * ── OFF BY DEFAULT ───────────────────────────────────────────────────────────
 *
 * A capability that posts into a group on a timer is exactly the kind of thing
 * an operator turns on deliberately, per mapping, having read the page that
 * says what it does - including the fact the page states in bold: channel
 * content is not end-to-end encrypted, and relay operators can read what they
 * forward.
 */

import { definePlugin } from '../registry.js';

export const CHANNEL_BRIDGE_ID = 'channel-bridge';

export const channelBridgePlugin = definePlugin({
  id: CHANNEL_BRIDGE_ID,
  name: 'Channel Bridge',
  description:
    'Brings posts from a SimpleX channel into a group as recurring announcements on a cadence you set, each one naming the channel it came from. Mappings and the capability are per bot.',
  version: '1.0.0',
  defaultEnabled: false,
  // See the header: an announcement cadence is not a request a member makes.
  intents: [],
  adminPath: '/bridge',
});
