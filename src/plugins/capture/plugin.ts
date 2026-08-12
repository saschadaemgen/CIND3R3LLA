/**
 * Capture as a capability (CCB-S5-033, D-190).
 *
 * ── WHY THE ARCHIVE IS A PLUGIN ──────────────────────────────────────────────
 *
 * Capture was unconditional: every hosted bot captured every group it was in. With one bot
 * that is the product. With two it is a duplicated archive, because `messages` is
 * `UNIQUE (group_id, group_msg_id)` and two bots in one room hold two different records, so
 * the constraint cannot collide.
 *
 * Making it a plugin is not a refactor for tidiness. It is what turns "which bot captures
 * this room" from an accident of who joined first into a setting the operator can see, set
 * and change - which is the whole shape of D-175, and the reason the per-bot mechanism
 * already exists to inherit.
 *
 * ── DEFAULT ON, DELIBERATELY ─────────────────────────────────────────────────
 *
 * The archive is the product's first capability, not an extra. Shipping it off would stop
 * capture for the running deployment on the next restart, which is the one outcome worse
 * than duplicating. On for every bot means the existing deployment keeps capturing exactly
 * as before, and the room rule (one capturing RECORD per room) removes the duplicate.
 *
 * ── NO INTENTS ───────────────────────────────────────────────────────────────
 *
 * Capture contributes nothing to the resolver's catalog: it is not something a member asks
 * for, it is what happens to what they say. The knowledge base set this precedent - a plugin
 * for the per-bot mechanism, with its page where an operator would look for it rather than
 * under Plugins.
 */

import { definePlugin } from '../registry.js';

export const CAPTURE_ID = 'capture';

export const capturePlugin = definePlugin({
  id: CAPTURE_ID,
  name: 'Archive capture',
  description:
    'Whether this bot records what is said in the rooms it is in. One bot captures a room; ' +
    'if two could, you choose which.',
  version: '1.0.0',
  defaultEnabled: true,
  intents: [],
  adminPath: '/capture',
  // It appears under the archive rather than a second time under Plugins: an operator looks
  // for what is being archived where the archive is.
  livesUnderNav: 'messages',
});
