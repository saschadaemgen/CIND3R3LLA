/**
 * Translating SimpleX items into Cinderella's domain (CCB-S3-020 §4).
 *
 * THE ADAPTER BOUNDARY. This file, and the rest of `src/bot/`, are the only place
 * in the codebase that may import `simplex-chat`. `scripts/verify-adapter-seam.ts`
 * enforces that, and it also proves itself by synthesising a violation and
 * checking it is caught.
 *
 * Everything here used to live in `src/capture/message.ts`, where it dragged
 * `T.AChatItem`, `T.ChatInfo`, `T.MsgContent` and `T.CIFile` into application
 * code. The parsing is unchanged, deliberately: this briefing moves the boundary,
 * it does not alter behaviour.
 */

import type { T } from '@simplex-chat/types';

import { recordUnknownScope } from '../capture/scope-diagnostics.js';
import type { MemberRole, RawItem } from '../adapter/types.js';
import type { SentGroupItem } from '../capture/bot-message.js';
import type {
  CapturedFile,
  CapturedMessage,
  CapturedType,
  LinkPreview,
} from '../capture/message.js';

function classifyType(msgContent: T.MsgContent, hasFile: boolean): CapturedType {
  switch (msgContent.type) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'voice':
      return 'voice';
    case 'file':
      return 'file';
    case 'link':
    case 'chat':
      // `chat` carries a SimpleX chat link; treat like a link message.
      return 'link';
    case 'text':
    case 'report':
    case 'unknown':
    default:
      return hasFile ? 'file' : 'text';
  }
}

function buildCapturedFile(file: T.CIFile | undefined): CapturedFile | undefined {
  if (!file) return undefined;
  return {
    fileId: file.fileId,
    fileName: file.fileName,
    fileSize: file.fileSize,
    sourcePath: file.fileSource?.filePath,
  };
}

function buildLinkPreview(msgContent: T.MsgContent): LinkPreview | undefined {
  if (msgContent.type !== 'link') return undefined;
  const { preview } = msgContent;
  return {
    url: preview.uri,
    title: preview.title || undefined,
    description: preview.description || undefined,
    image: preview.image || undefined,
  };
}


/**
 * The protocol's role string, narrowed to Cinderella's own {@link MemberRole}.
 *
 * Returns undefined for anything unrecognised rather than casting. The SDK's role set
 * and ours agree today; if a future core adds one, moderation must see "I do not know"
 * instead of a value it will silently treat as ordinary.
 */
const MEMBER_ROLES: readonly string[] = [
  'relay',
  'observer',
  'author',
  'member',
  'moderator',
  'admin',
  'owner',
];

function asMemberRole(role: unknown): MemberRole | undefined {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return MEMBER_ROLES.includes(value) ? (value as MemberRole) : undefined;
}

/**
 * SECURITY GATE (CCB-S3-019): is this incoming chat item a PUBLIC group message —
 * the only thing Cinderella is ever allowed to capture?
 *
 * A group chat item can arrive on a private per-member SUPPORT scope (the member's
 * "Chat with admins" thread), delivered on the very same `newChatItems` event as
 * ordinary group messages (CCB-S3-016 §8a). Capturing one would publish a private
 * conversation to the public archive — the one thing a private channel exists to
 * prevent, and unrecoverable once read. The reliable discriminator is
 * `ChatInfo.Group.groupChatScope`: absent on a public group message, present (a
 * `memberSupport` scope) on the private thread (types.d.ts:978).
 *
 * The durable rule — which also satisfies CCB-S3-017 §2's direct-chat exclusion —
 * is a WHITELIST, not a blacklist: capture only when the item is POSITIVELY a
 * plain public group chat. Direct/local/contact chats are not `group`; a scoped
 * group item carries `groupChatScope`. Anything else, or anything ambiguous, is
 * out. Fail CLOSED: a missing archive row is recoverable; a leaked private message
 * is not. A future message type or scope that this predicate does not recognise as
 * public is therefore excluded by construction, not by being added to a list.
 */
export function isPublicGroupChat(chatInfo: T.ChatInfo): boolean {
  // NOT a `chatInfo is ChatInfo.Group` type guard: a SCOPED group is still a
  // ChatInfo.Group but returns false here, so a type predicate would make the
  // compiler wrongly narrow the false branch to "not a group" and lose groupInfo.
  return chatInfo.type === 'group' && chatInfo.groupChatScope === undefined;
}

/** Scope discriminators the gate EXPECTS to exclude (so they need no alert). */
const KNOWN_GROUP_SCOPES = new Set(['memberSupport']);

/**
 * When an item is excluded, is its scope one we RECOGNISE — and therefore an
 * expected, silent exclusion — or something we do not understand?
 *
 * Returns null for every EXPECTED exclusion: a direct/local/contact chat (not a
 * group at all), and a group carrying a known scope (`memberSupport`, the private
 * "Chat with admins" thread). Returns the offending discriminator (or
 * `'(malformed)'`) only when a GROUP item carries a scope we do not recognise —
 * which means capture is silently stopping for a reason we cannot explain, and
 * that must be surfaced rather than dropped in silence (CCB-S3-019 follow-up).
 */
export function unrecognisedScopeType(chatInfo: T.ChatInfo): string | null {
  if (chatInfo.type !== 'group') return null; // direct/local/etc — expected
  const scope = chatInfo.groupChatScope;
  if (scope === undefined) return null; // public — captured, not excluded at all
  const t =
    scope && typeof scope === 'object' ? (scope as { type?: unknown }).type : undefined;
  if (typeof t === 'string' && KNOWN_GROUP_SCOPES.has(t)) return null; // memberSupport — expected
  return typeof t === 'string' && t.length > 0 ? t : '(malformed)';
}

/**
 * Parses an incoming chat item into a CapturedMessage, or returns `null` if it
 * is not a capturable group message.
 *
 * Only *received PUBLIC group messages* are captured:
 *   - public group chats — NOT direct/local, and NOT a member-support scope
 *     (CCB-S3-019); {@link isPublicGroupChat} is the single gate every incoming
 *     item passes through (also used by the in-group deletion handler),
 *   - the `groupRcv` direction (a real member's message — never the bot's own
 *     sends, and never system events like "member joined"),
 *   - actual message content (`rcvMsgContent`), not group-event content.
 */
export function parseGroupMessage(aChatItem: T.AChatItem): CapturedMessage | null {
  const { chatInfo, chatItem } = aChatItem;

  // CCB-S3-019: the private-scope gate, before persistence, consent, or anything.
  if (!isPublicGroupChat(chatInfo)) {
    // Expected exclusions (direct chats, the memberSupport scope) stay silent; an
    // UNRECOGNISED scope is counted and surfaced — capture is stopping for a
    // reason we do not understand, and that must never be invisible.
    const unknown = unrecognisedScopeType(chatInfo);
    if (unknown !== null) {
      recordUnknownScope({
        scopeType: unknown,
        groupId: chatInfo.type === 'group' ? chatInfo.groupInfo.groupId : null,
      });
    }
    return null;
  }
  // isPublicGroupChat guaranteed a scope-free group; this narrows it for the compiler.
  if (chatInfo.type !== 'group') return null;
  const groupInfo = chatInfo.groupInfo;

  const dir = chatItem.chatDir;
  // Her OWN sends (`groupSnd`) are archived by the send site instead
  // (capture/bot-message.ts), and must never come back through here: this
  // function feeds the consent-command parser and the dialogue engine, so a
  // reply of hers arriving as input would let her answer herself. The
  // `groupRcv` test below already excludes them — this note is here so a future
  // widening of it is a decision rather than an accident.
  if (dir.type !== 'groupRcv') return null;
  const member = dir.groupMember;

  const content = chatItem.content;
  if (content.type !== 'rcvMsgContent') return null;
  const msgContent = content.msgContent;

  const file = buildCapturedFile(chatItem.file);

  return {
    groupId: groupInfo.groupId,
    groupName: groupInfo.localDisplayName,
    itemId: chatItem.meta.itemId,
    sharedMsgId: chatItem.meta.itemSharedMsgId,
    senderMemberId: member.memberId,
    senderDisplayName: member.memberProfile.displayName || member.localDisplayName,
    // CCB-S4-032. Narrowed HERE, inside the adapter, which is the only place that knows
    // what the protocol calls a role. An unrecognised value becomes undefined rather
    // than being passed through: moderation exempts roles, and an exemption computed
    // from a role nobody in this codebase recognises would be a guess.
    senderRole: asMemberRole(member.memberRole),
    senderGroupMemberId: member.groupMemberId,
    sentAt: chatItem.meta.itemTs,
    type: classifyType(msgContent, file !== undefined),
    text: msgContent.text ?? '',
    linkPreview: buildLinkPreview(msgContent),
    file,
    forwarded: chatItem.meta.itemForwarded !== undefined,
    quotedFromBot: chatItem.quotedItem?.chatDir?.type === 'groupSnd',
    raw: aChatItem,
  };
}

/**
 * A channel post, as the bridge stores it (CCB-S5-032, D-187).
 *
 * A SEPARATE PARSER, deliberately beside {@link parseGroupMessage} rather than a
 * widening of it. The note at that function's `groupRcv` test says a widening is
 * a decision, not an accident; this is the decision, and what it decides is that
 * the two directions lead to two different worlds:
 *
 *   `groupRcv`   carries a MEMBER, so the item enters capture, consent and the
 *                dialogue engine - the member machinery.
 *   `channelRcv` carries NOBODY. The variant has no fields at all: no memberId,
 *                no display name, no role. Consent is keyed per member, so a
 *                channel post CANNOT travel the consent path, must never reach
 *                `messages`, and must never be answerable by the engine. It goes
 *                to the bridge's own table, which has no publication semantics.
 *
 * One parser accepting both would need every downstream consumer to re-check
 * which world it is in; two parsers make the wrong world unrepresentable.
 */
export interface ChannelPost {
  groupId: number;
  channelName: string;
  itemId: number;
  sharedMsgId: string | null;
  postedAt: string;
  text: string;
  file: CapturedFile | undefined;
  /** True when the reporting core marks the group as relay-mediated. */
  isChannelGroup: boolean;
  /** The link this profile joined through, when the core retained it. */
  viaLink: string | null;
}

export function parseChannelPost(aChatItem: T.AChatItem): ChannelPost | null {
  const { chatInfo, chatItem } = aChatItem;
  // The same public gate capture uses: a scoped (memberSupport) item is not a
  // channel post whatever its direction claims.
  if (!isPublicGroupChat(chatInfo)) return null;
  if (chatInfo.type !== 'group') return null;
  if (chatItem.chatDir.type !== 'channelRcv') return null;
  const content = chatItem.content;
  if (content.type !== 'rcvMsgContent') return null;
  const msgContent = content.msgContent;
  const groupInfo = chatInfo.groupInfo;
  const profile = groupInfo.groupProfile;
  return {
    groupId: groupInfo.groupId,
    channelName: profile.displayName || groupInfo.localDisplayName,
    itemId: chatItem.meta.itemId,
    sharedMsgId: chatItem.meta.itemSharedMsgId ?? null,
    postedAt: chatItem.meta.itemTs,
    text: msgContent.text ?? '',
    file: buildCapturedFile(chatItem.file),
    // Both signals the installed types carry; either one makes it a channel.
    // First-ever reader of these fields in this codebase (D-105 noted: new
    // surface, covered by verify:bridge rather than assumed covered).
    isChannelGroup:
      groupInfo.useRelays === true ||
      profile.publicGroup?.groupType === ('channel' as T.GroupType),
    viaLink: groupInfo.viaGroupLinkUri ?? null,
  };
}

/**
 * Narrows a sent chat item to the group send we archive. Anything else — a direct
 * message, a received item, a group event — is not hers to archive here.
 */
export function parseSentGroupItem(item: RawItem): SentGroupItem | null {
  // The opaque handle is narrowed HERE, inside the adapter, which is the only
  // place that knows what the protocol's representation actually is.
  const { chatInfo, chatItem } = item as T.AChatItem;
  if (chatInfo.type !== 'group') return null;
  if (chatItem.chatDir.type !== 'groupSnd') return null;
  const me = chatInfo.groupInfo.membership;
  if (!me?.memberId) return null;
  return {
    groupId: chatInfo.groupInfo.groupId,
    itemId: chatItem.meta.itemId,
    sharedMsgId: chatItem.meta.itemSharedMsgId ?? null,
    sentAt: chatItem.meta.itemTs,
    memberId: me.memberId,
    displayName: me.memberProfile?.displayName || me.localDisplayName || 'Cinderella',
  };
}
