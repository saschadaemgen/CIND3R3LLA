/**
 * The admin media route (CCB-S3-013 §4).
 *
 * `GET /media/msg/:id` — one message's media, addressed by id, behind the ordinary
 * admin auth guard.
 *
 * This exists to replace an `@fastify/static` mount over the whole media tree.
 * That mount served any file under `MEDIA_ROOT` by path with no per-message check,
 * which was harmless while nothing in the archive was meant to be unreachable, and
 * became a hole the moment quarantine did: an escalated or hash-matched item could
 * not be deleted, but its bytes were still readable to any authenticated admin
 * session. "Accessible to nobody in normal operation" cannot be delivered by a
 * database state while a filesystem path still hands out the bytes.
 *
 * TWO INDEPENDENT GUARDS, because either one alone would be a single point of
 * failure for a rule this serious:
 *
 *  1. **The bytes are not here.** `quarantineMedia` moves a quarantined message's
 *     files out of `MEDIA_ROOT` into `QUARANTINE_ROOT`, which nothing serves. This
 *     route resolves under `MEDIA_ROOT` only, so a quarantined file is simply
 *     absent.
 *  2. **The route refuses anyway.** It checks the live hold state first and 403s,
 *     so a move that failed, was interrupted, or was never run does not silently
 *     become a served file.
 *
 * Unlike the public media route, this serves the ORIGINAL rather than the stripped
 * derivative: the operator moderating content needs to see what was actually sent,
 * metadata included. That is why it is admin-only and why it is worth addressing
 * by id rather than by path.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';

import { liveHold } from '../../db/holds.js';
import { log } from '../../log.js';
import { servableMediaPath } from '../../media/quarantine.js';
import type { ViewContext } from '../server.js';

export function registerAdminMedia(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{ Params: { id: string } }>('/media/msg/:id', async (req, reply) => {
    const id = Number.parseInt(req.params.id, 10);
    // Bounded like the public media route: an out-of-range id would otherwise
    // raise inside the query rather than answering cleanly.
    if (!Number.isInteger(id) || id < 1 || id > Number.MAX_SAFE_INTEGER) {
      return reply.code(400).type('text/plain').send('Bad id');
    }

    const { rows } = await ctx.db.query<{ media_path: string | null; media_mime: string | null }>(
      'SELECT media_path, media_mime FROM messages WHERE id = $1',
      [id],
    );
    const row = rows[0];
    if (!row?.media_path) return reply.code(404).type('text/plain').send('Not found');

    // Guard 2. Checked BEFORE touching the filesystem, so the refusal does not
    // depend on the move having succeeded.
    const hold = await liveHold(ctx.db, id);
    if (hold && (hold.source === 'csam' || hold.state === 'escalated')) {
      log.warn(
        `Admin media: refused message ${id}; it is quarantined by hold ${hold.id} (${hold.source}/${hold.state}).`,
      );
      return reply
        .code(403)
        .type('text/plain')
        .send(
          'This item is quarantined and is not accessible. Release or resolve the hold on the ' +
            'Evidence holds page if it should be readable again.',
        );
    }

    // Guard 1. Resolves under MEDIA_ROOT only and containment-checks the stored
    // path, which is built from a member-supplied filename.
    const abs = await servableMediaPath(ctx.cfg.mediaRoot, row.media_path);
    if (!abs) return reply.code(404).type('text/plain').send('Not found');

    const info = await stat(abs);
    if (!info.isFile()) return reply.code(404).type('text/plain').send('Not found');

    reply.header('content-type', row.media_mime ?? 'application/octet-stream');
    reply.header('content-length', String(info.size));
    // The admin surface is never cached anywhere (the console-wide `no-store` set
    // applies here too), and a quarantine decision must take effect at once.
    reply.header('cache-control', 'no-store');
    return reply.send(createReadStream(abs));
  });
}
