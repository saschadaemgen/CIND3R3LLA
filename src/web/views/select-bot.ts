/**
 * The one route the bot switcher posts to (CCB-S5-011, D-169).
 *
 * Its own file because it belongs to no page: every page that edits a bot renders the
 * switcher, and putting the handler in one of them would make the others depend on whichever
 * page happened to own it.
 *
 * It writes the session and redirects back. Nothing else: the selection is not a setting, it
 * changes no bot and no deployment state, and an operator switching between bots must not be
 * writing rows to anything he can later find in an audit log wondering what he changed.
 */

import type { FastifyInstance } from 'fastify';
import type { ViewContext } from '../server.js';
import { log } from '../../log.js';

/**
 * Where to send the operator afterwards.
 *
 * ── WHY THE RETURN PATH IS VALIDATED AND NOT TRUSTED ─────────────────────────
 *
 * It arrives in a form field, and a form field is untrusted whatever rendered it. An open
 * redirect on an authenticated console is a real finding: it takes a signed-in operator to a
 * page of somebody else's choosing while everything still looks like the admin.
 *
 * So only a same-site absolute path is accepted, and `//host` is refused explicitly because
 * it starts with a slash and is a protocol-relative URL to another origin. Anything that does
 * not qualify falls back to the dashboard, which is always safe and always exists.
 */
function safeReturn(raw: unknown): string {
  if (typeof raw !== 'string') return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  // A backslash is treated as a slash by some parsers, so `/\evil.example` is the same trick.
  if (raw.includes('\\')) return '/dashboard';
  return raw;
}

export function registerSelectBot(app: FastifyInstance, ctx: ViewContext): void {
  app.post('/console/select-bot', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const session = req.session;
    if (!session) return reply.redirect('/login');

    const raw = body['botProfileId'];
    const parsed = Number.parseInt(typeof raw === 'string' ? raw : '', 10);
    // Null clears the selection, which every page reads as "the first bot". An unparseable
    // value clears it too rather than being refused: this control cannot fail in a way that
    // costs the operator anything, and a stuck selection would be worse than a reset one.
    const botProfileId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;

    try {
      await ctx.sessions.selectBot(session.sessionId, botProfileId);
    } catch (err) {
      // The foreign key refuses an id that names no bot. Surfaced rather than swallowed
      // (CCB-S3-023), but not fatal: the operator keeps whatever selection he had.
      log.warn(
        `Console: could not select bot ${String(botProfileId)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return reply.redirect(safeReturn(body['returnTo']));
  });
}
