/**
 * Normalizes a raw SimpleX `AChatItem` into a `CapturedMessage` — the shape
 * Cinderella works with across every stage (log in Stage 1, persist in Stage 2,
 * consent-gate in Stage 3).
 *
 * All SimpleX types are discriminated unions keyed on a `type` string, so this
 * module reads those discriminants directly and never depends on runtime enums.
 */

import type { MemberRole, RawItem } from '../adapter/types.js';
import type { ChatItemId } from '../db/ids.js';

/** The capture type taxonomy from the briefing (§5 Stage 2). */
export type CapturedType = 'text' | 'image' | 'video' | 'voice' | 'link' | 'file';

export interface CapturedFile {
  /** SimpleX file id — used to issue the receive-file command. */
  fileId: number;
  fileName: string;
  fileSize: number;
  /**
   * Path the SimpleX core wrote the file to once received (relative to the
   * files folder, or absolute). Undefined until the file transfer completes.
   */
  sourcePath: string | undefined;
}

export interface LinkPreview {
  url: string;
  title: string | undefined;
  description: string | undefined;
  /**
   * The base64 thumbnail the sender's client generated (CCB-S3-014). Kept so we
   * can serve it locally instead of fetching from a third party — see
   * media/thumbnail.ts. Undefined when the client sent no image.
   */
  image: string | undefined;
}

export interface CapturedMessage {
  /** Local numeric group id (SimpleX DB). */
  groupId: number;
  /** Group's local display name. */
  groupName: string;
  /**
   * Chat-item id (SimpleX DB). Stable within the bot's SimpleX DB and the id
   * that in-group deletion events (`groupChatItemsDeleted.chatItemIDs`) refer
   * to — so this is what we persist as `group_msg_id`.
   */
  itemId: ChatItemId;
  /** Shared message id (base64) — stable across members; useful for tracing. */
  sharedMsgId: string | undefined;
  /** Stable group member id (NOT the display name — see briefing §9). */
  senderMemberId: string;
  /** Sender's current display name (may collide across members). */
  senderDisplayName: string;
  /**
   * The sender's role in the group, or undefined when the adapter could not say
   * (CCB-S4-032). Carried because moderation exempts staff, and because the arming
   * briefing must refuse to aim a sanction at a member whose role is unknown: doing so
   * risks aiming at an owner, which fails at the SDK and reads as a bug rather than as
   * the policy it is.
   *
   * The in-memory adapter fake leaves it undefined, which is the honest value there.
   */
  senderRole: MemberRole | undefined;
  /**
   * The sender's numeric group-member id, which is what the moderation APIs take
   * (`apiSetMembersRole`, `apiRemoveMembers`). Carried now so the arming briefing does
   * not have to widen this type on a live deployment; nothing reads it today.
   */
  senderGroupMemberId: number | undefined;
  /** Group-message timestamp (ISO 8601). */
  sentAt: string;
  /** Capture type classification. */
  type: CapturedType;
  /** Text body (may be empty for pure-media messages). */
  text: string;
  /** Link preview, present only for `link`-type messages. */
  linkPreview: LinkPreview | undefined;
  /** Attached media/file, if any. */
  file: CapturedFile | undefined;
  /**
   * True when the member FORWARDED this message rather than writing it.
   *
   * This is `meta.itemForwarded` (the field the clients use to draw the
   * "forwarded" label), NOT `meta.forwardedByMember`. They are different things
   * and confusing them breaks consent: `forwardedByMember` is a group ROUTING
   * detail and is set on ordinary messages — verified in the live SimpleX DB,
   * where real `/publish` commands carry it. Keying the guard off that field
   * would silently stop `/publish` from working.
   */
  forwarded: boolean;
  /**
   * True when this message is a direct reply to one of the BOT's own messages.
   * That is an address in itself (CCB-S3-002 §1.2) — replying to her needs no
   * wake word. `groupSnd` on the quoted item means "sent by us in this group".
   */
  quotedFromBot: boolean;
  /**
   * The protocol's own representation, opaque (CCB-S3-020 §2).
   *
   * `RawItem` is `unknown`: carry it, hand it back to the adapter, never inspect
   * it. Typing this as the SDK's `AChatItem` is what made every consumer of
   * `CapturedMessage` transitively SDK-coupled, since this type flows through
   * capture, persist, consent and the whole interaction layer.
   *
   * It is still WRITTEN to `messages.raw_json`, and SQL reads inside it. That is
   * a known leak of SimpleX semantics through the seam, not a property of this
   * domain; see `docs/adapter-contract.md`.
   */
  raw: RawItem;
}
