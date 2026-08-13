/**
 * The concrete welcome transport (CCB-S5-041, D-206).
 *
 * Built per hosted bot and handed to `welcome-port.ts`, which is the seam the plugin talks to.
 * This file is under `src/bot/`, the only tree permitted to import the SDK
 * (`verify:adapter-seam`), and it is the ONLY place in the welcome feature that touches it.
 *
 * ── ALL THREE ROUTES ARE TYPED; NONE NEEDS A RAW COMMAND ────────────────────
 *
 * `ChatRef` carries an optional `chatScope` and `apiSendMessages` takes a `ChatRef`, so the
 * member support thread is reachable through the typed API. That is worth stating because the
 * channel join was not: there, the SDK exposed no wrapper and the wire string WAS the
 * interface, which cost two days and one omitted flag. Nothing here is in that position.
 *
 * ── EVERY SEND GOES THROUGH THE SCHEDULER (D-171) ───────────────────────────
 *
 * `APISendMessages` takes a `ChatRef` and no user id, so it executes as whichever profile is
 * ACTIVE. Issued bare, a greeting would go out as whichever bot the scheduler last left in
 * place - into the right room, in the wrong voice. `runScheduled` names the bot.
 *
 * An explicit user id would not have saved it either: naming a user makes a command
 * REFUSABLE, not unmisroutable (D-171), and these commands do not take one at all.
 */

import type { T } from '@simplex-chat/types';
import type { api } from 'simplex-chat';
import type { WelcomeTransport } from './welcome-port.js';

export interface WelcomeTransportDeps {
  chat: api.ChatApi;
  /** Runs `fn` as THIS bot, through the active-user scheduler. */
  runScheduled: <R>(label: string, fn: () => Promise<R>) => Promise<R>;
  /** The bot's own held-until-ready group send, reused so the readiness gate is not bypassed. */
  sendGroupText: (groupId: number, text: string) => Promise<T.AChatItem[]>;
  slug: string;
}

/** One text message, composed the way `apiSendTextMessage` composes one. */
function textMessage(text: string): T.ComposedMessage[] {
  return [{ msgContent: { type: 'text', text }, mentions: {} }];
}

export function makeWelcomeTransport(deps: WelcomeTransportDeps): WelcomeTransport {
  return {
    // The bot's own send, so a greeting issued during the core's warm-up waits rather than
    // going out on an unsettled core (D-085: 10 s against 153 ms) or being dropped.
    sendToGroup: (groupId, text) => deps.sendGroupText(groupId, text),

    sendToSupportThread: (groupId, groupMemberId, text) =>
      deps.runScheduled(`welcome-support:${deps.slug}`, () =>
        deps.chat.apiSendMessages(
          {
            chatType: 'group' as T.ChatType,
            chatId: groupId,
            // THE PRIVATE STRAND INSIDE THE GROUP. It never leaves the group, so it needs no
            // direct-message permission - and `parseSentGroupItem` now refuses to archive
            // anything carrying a scope, in either direction, which is what keeps this off
            // the public archive.
            chatScope: { type: 'memberSupport', groupMemberId_: groupMemberId },
          },
          textMessage(text),
        ),
      ),

    sendToContact: (contactId, text) =>
      deps.runScheduled(`welcome-direct:${deps.slug}`, () =>
        deps.chat.apiSendMessages(
          { chatType: 'direct' as T.ChatType, chatId: contactId },
          textMessage(text),
        ),
      ),
  };
}
