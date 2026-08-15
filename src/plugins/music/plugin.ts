/**
 * The Music plugin definitions (CCB-S5-044, D-216).
 *
 * TWO plugin ids, deliberately, because they are two capabilities with two
 * risk shapes and the operator turns them on separately:
 *
 *   'music'          the library: playlists this bot holds, answered questions
 *                    (which playlists, what's on one, play me something), and
 *                    the cadence that plays unbidden within the budgets. This
 *                    one contributes the MUSIC intent to the catalog.
 *   'music-uploads'  Part 4b: a member hands her a file and she plays it back.
 *                    A member-driven fetch-and-resend is a different surface
 *                    from the operator's own library, off by default on its
 *                    own switch, and the overrides table needs no schema
 *                    change for a second id (the 057 precedent: its CHECK
 *                    constrains only `setting_key`).
 *
 * Both OFF by default: one posts into groups on a timer, the other re-sends
 * member-supplied bytes, and each is exactly the kind of thing an operator
 * enables having read the page that says what it does.
 */

import { definePlugin } from '../registry.js';

export const MUSIC_ID = 'music';
export const MUSIC_UPLOADS_ID = 'music-uploads';

export const musicPlugin = definePlugin({
  id: MUSIC_ID,
  name: 'Music Library',
  description:
    'A library of tracks, audiobooks, documentaries and spots the bot can play on request or on a cadence, from playlists assigned per bot. Sends as a one-message video when a track has cover art, and as a voice player when it does not.',
  version: '1.0.0',
  defaultEnabled: false,
  intents: ['MUSIC'],
  adminPath: '/music',
});

export const musicUploadsPlugin = definePlugin({
  id: MUSIC_UPLOADS_ID,
  name: 'Member Uploads (play back)',
  description:
    'A member drops an audio file into the chat and asks her to make it playable; she fetches it and sends it back as a player. Played without being stored, size-bounded, audio only by allow-list.',
  version: '1.0.0',
  defaultEnabled: false,
  // No intent of its own: the ask rides the MUSIC intent's "make this playable"
  // shape, and the capability check happens in the handler against THIS id, so
  // a bot with the library but not uploads refuses the upload half honestly.
  intents: [],
  adminPath: '/music',
});
