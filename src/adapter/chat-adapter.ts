/**
 * The seam between Cinderella and whatever protocol library is underneath
 * (CCB-S3-020 §3).
 *
 * Two reasons this exists, and only one of them is technical. Linking the AGPL
 * `simplex-chat` library binds Cinderella to AGPL, which blocks a closed
 * commercial edition for as long as the dependency is structural; and every week
 * more code touched the SDK directly, so every one of those call sites was work a
 * later swap would have to redo. This is insurance, bought while it is cheap.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────
 *
 * Moderation (deleting another member's message, removing a member, changing a
 * role), reactions, and creating a contact from a member. The CCB-S3-016 audit
 * found all of them available and they are all intended, but none has a caller
 * today, and §3 is explicit: "An interface method with no caller is a guess about
 * a future implementation." They arrive with their first real caller, when the
 * shape can be verified against live behaviour rather than guessed.
 *
 * ── Protocol neutrality, for whoever writes the second adapter ───────────────
 *
 * Most of this is protocol-neutral. Two things are not, and are called out in
 * `docs/adapter-contract.md`: the opaque {@link RawItem}, whose stored JSON is
 * read by SQL today, and the group/support scope split, which is SimpleX's model
 * of a private thread inside a group. A Matrix adapter would have to decide what
 * both mean before it could satisfy this interface honestly.
 */

import type {
  BotProfile,
  ChatEvent,
  ChatGroup,
  ChatMember,
  ChatMessage,
  SendOptions,
  SendTarget,
  SentMessage,
} from './types.js';

export interface ChatAdapter {
  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /** Connects and begins delivering events. Resolves once ready to send. */
  start(): Promise<void>;
  /** Stops cleanly, flushing what it can. Safe to call twice. */
  stop(): Promise<void>;

  /* ── Receiving ─────────────────────────────────────────────────────────── */

  /**
   * Subscribes to the event stream.
   *
   * CONTRACT: an implementation delivers each event AT MOST ONCE and never
   * re-sends it. A handler that throws loses the event permanently, which is why
   * capture writes ahead rather than trusting redelivery (CCB-S3-024). An
   * implementation that CAN redeliver may do so; one that cannot must say so.
   */
  onEvent(handler: (event: ChatEvent) => Promise<void> | void): void;

  /* ── Sending ───────────────────────────────────────────────────────────── */

  /**
   * Sends text to a group, a member support thread, or a direct chat.
   *
   * Returns what was sent so the caller can archive its own output; her messages
   * are archive rows too (CCB-S3-007).
   */
  sendText(target: SendTarget, text: string, opts?: SendOptions): Promise<SentMessage[]>;

  /* ── Files ─────────────────────────────────────────────────────────────── */

  /**
   * Accepts an incoming file and resolves to its path once written.
   *
   * CONTRACT: the file lands in a configured folder and the caller MOVES it from
   * there. An implementation must let the temp and destination directories sit on
   * one filesystem, because a cross-device rename fails with EXDEV and the file
   * never arrives (the CCB-S1-010 failure).
   */
  receiveFile(fileId: number, timeoutMs: number): Promise<string>;

  /* ── Profile ───────────────────────────────────────────────────────────── */

  getProfile(): Promise<BotProfile>;
  /**
   * Updates the bot's display name and image.
   *
   * CONTRACT: an image change reaches direct contacts immediately but group
   * members only on the bot's NEXT group message. An implementation that cannot
   * push profile updates to a group out of band must document that, because the
   * caller compensates by sending one message (CCB-S1-015).
   */
  updateProfile(profile: Partial<BotProfile>): Promise<void>;

  /* ── Groups and members ────────────────────────────────────────────────── */

  listGroups(): Promise<ChatGroup[]>;
  listMembers(groupId: number): Promise<ChatMember[]>;

  /* ── Erasure ───────────────────────────────────────────────────────────── */

  /**
   * Erases the implementation's OWN stored copy of items. Never broadcasts a
   * retraction to other members.
   *
   * CONTRACT: this must genuinely remove the content, not flag it. SimpleX
   * distinguishes `internal` (deletes the row, its wire messages, its versions and
   * its file) from `internalMark` (sets a flag and keeps everything); only the
   * former satisfies this method (CCB-S3-027).
   */
  eraseOwnCopy(chatKind: 'group' | 'direct', chatId: number, itemIds: readonly number[]): Promise<void>;
}

export type { ChatMessage, ChatEvent, ChatMember, ChatGroup, SendTarget, SentMessage, BotProfile };
