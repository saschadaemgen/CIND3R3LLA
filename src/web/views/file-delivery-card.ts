/**
 * The outbound-file delivery card (CCB-S5-044 follow-up, D-224).
 *
 * 205 outbound files once sat unoffered in the core's `new` state with every
 * send command green, discovered only by querying the core's SQLite by hand.
 * This card is the standing answer: the watcher's counts and the last few
 * outcomes, on the page whose sends are most at stake.
 */

import { html, type SafeHtml } from '../html.js';
import { card, factList, fmtDate } from './ui.js';
import { fileDeliverySnapshot } from '../../bot/file-log.js';

export function fileDeliveryCard(): SafeHtml {
  const fd = fileDeliverySnapshot();
  return card(
    'File delivery',
    html`${factList([
      ['Sends watched this process', String(fd.counts.watched)],
      ['Confirmed complete', String(fd.counts.complete)],
      ['STUCK - never started uploading', String(fd.counts.stuck)],
      ['Transfer errors', String(fd.counts.sendError)],
      ['Transient warnings', String(fd.counts.sendWarning)],
    ])}
    ${fd.entries.length === 0
      ? html`<p class="mt-2 text-xs text-slate-500">No delivery outcomes recorded yet this process.</p>`
      : html`<ul class="mt-2 space-y-1 text-xs text-slate-500">
          ${fd.entries.slice(0, 10).map(
            (e) =>
              html`<li>
                ${fmtDate(e.at)} - ${e.outcome}${e.groupId !== null ? ` (group ${String(e.groupId)})` : ''}:
                ${e.label}${e.detail ? `, ${e.detail}` : ''}
              </li>`,
          )}
        </ul>`}
    <p class="mt-2 text-xs text-slate-500">
      A send command returning is not the file arriving: the core uploads afterwards, and a
      file that never leaves its stored state fires no event at all. Every file-bearing send
      books a check that reads the item's own file status back a few minutes later; a file
      that never started uploading raises a dashboard error and a row here, instead of being
      found by querying the core's database by hand.
    </p>`,
  );
}
