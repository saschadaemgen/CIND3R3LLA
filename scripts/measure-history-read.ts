/**
 * What the conversation lane actually gets handed as history. (D-258)
 *
 * Calls the REAL `listGroupHistory` with the REAL arguments the engine passes, for the most
 * recent messages of every group, and prints ROW COUNTS ONLY - never a body, never a display
 * name. Beside it, the same read with the correct key, so the difference is the defect.
 *
 * `recentHistory` passes `beforeMessageId: msg.itemId`. That is the SimpleX chat-item id,
 * which the schema stores as `group_msg_id`. The query compares it to `m.id`, the archive's
 * own IDENTITY primary key. Two unrelated sequences, so the guard is either a no-op or a
 * truncation depending on which sequence happens to be ahead in that group.
 *
 *   scp scripts/measure-history-read.ts vps:/opt/cinderella/tmp/
 *   ssh vps 'cd /opt/cinderella && set -a && . /etc/cinderella/cinderella.env && set +a &&
 *            npx tsx tmp/measure-history-read.ts ; rm -f tmp/measure-history-read.ts'
 */

import { Pool } from 'pg';
import type { Queryable } from '../src/db/pool.js';
import { listGroupHistory } from '../src/db/messages.js';
import { chatItemId } from '../src/db/ids.js';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set; load the host env first.');
  const pool = new Pool({ connectionString: url });
  const db: Queryable = pool as unknown as Queryable;

  // The live settings, so the window and the count are the operator's own.
  const { rows: st } = await pool.query<{ value: { memory?: { maxMessages?: number; windowMinutes?: number } } }>(
    "SELECT value FROM settings WHERE key = 'interaction'",
  );
  const maxMessages = st[0]?.value?.memory?.maxMessages ?? 20;
  const windowMinutes = st[0]?.value?.memory?.windowMinutes ?? 30;
  console.log(`memory: ${String(maxMessages)} messages / ${String(windowMinutes)} minutes\n`);

  const { rows: groups } = await pool.query<{ group_id: string }>(
    'SELECT DISTINCT group_id FROM messages ORDER BY group_id',
  );

  for (const g of groups) {
    const groupId = Number(g.group_id);
    // The last few real messages of the group, newest first: each one is a turn she answered.
    const { rows: recent } = await pool.query<{ id: string; group_msg_id: string; sent_at: string | Date }>(
      'SELECT id, group_msg_id, sent_at FROM messages WHERE group_id = $1 ORDER BY sent_at DESC LIMIT 3',
      [groupId],
    );
    console.log(`── group ${String(groupId)}`);
    for (const row of recent) {
      const itemId = Number(row.group_msg_id);
      const pk = Number(row.id);
      const sinceIso = new Date(new Date(row.sent_at).getTime() - windowMinutes * 60_000).toISOString();
      const limit = Math.min(maxMessages * 2, 200);

      // AS FIXED (D-258): the chat-item id against the chat-item column.
      const fixed = await listGroupHistory(db, groupId, { limit, sinceIso, beforeChatItemId: chatItemId(itemId) });
      // AS SHIPPED: the same number against the archive primary key. Raw SQL, because the
      // branded signature now REFUSES this call - which is the point of the brand.
      const { rows: shippedRows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM messages m
           WHERE m.group_id = $1 AND m.sent_at >= $2 AND m.id < $3
             AND m.deleted = FALSE AND m.group_deleted = FALSE
             AND m.moderation_state <> 'rejected'
             AND coalesce(CASE WHEN m.is_bot THEN m.search_body ELSE m.text_body END, '') <> ''`,
        [groupId, sinceIso, itemId],
      );
      const shipped = { length: Number(shippedRows[0]?.n ?? '0') };
      // How many rows exist in the window at all, with nothing excluded.
      const all = await listGroupHistory(db, groupId, { limit, sinceIso });

      console.log(
        `   turn pk=${String(pk)} item=${String(itemId)} @ ${new Date(row.sent_at).toISOString().slice(0, 19)}  ` +
          `shipped=${String(shipped.length)}  fixed=${String(fixed.length)}  in-window=${String(all.length)}` +
          (fixed.length === all.length - 1 ? '   fixed: excludes exactly this turn' : '') +
          (shipped.length === 0 && all.length > 0 ? '   <-- SHIPPED EMPTIED IT' : '') +
          (shipped.length > fixed.length ? '   <-- shipped guard was dead' : ''),
      );
    }
  }

  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
