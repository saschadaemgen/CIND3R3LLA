/**
 * Cinderella's own chat domain types (CCB-S3-020 §2).
 *
 * THE POINT OF THIS FILE. If application code still received `T.ChatInfo`,
 * `T.ChatItem` and their relatives, nothing would be decoupled: the type SHAPES
 * are the dependency, not the import lines. So these types are defined by what
 * Cinderella needs, and the adapter does the translating.
 *
 * Where the SDK draws a distinction that only exists because of how it is built,
 * it is hidden here. Where Cinderella needs a distinction the SDK expresses
 * awkwardly, it is expressed cleanly here and the adapter absorbs the awkwardness.
 * The clearest example is {@link ChatScope}: the SDK carries an optional
 * `groupChatScope` discriminator on `ChatInfo`, and getting that wrong is what
 * captured two private support-scope messages into the archive (CCB-S3-019). Here
 * it is a required, closed union, so a scope cannot be forgotten by omission.
 */

/** What kind of conversation a message belongs to. */
export type ChatKind = 'group' | 'direct';

/**
 * WHERE inside a group a message lives.
 *
 * `public` is the group everyone sees. `support` is a private member-to-admin
 * thread that arrives on the SAME event with nothing else distinguishing it, and
 * `unknown` is any scope a future core version introduces.
 *
 * Closed and required on purpose: the capture whitelist keys off this, and the
 * CCB-S3-019 finding was precisely that an absent discriminator read as "ordinary
 * public message". An unrecognised scope must be representable so it can fail
 * closed rather than be silently absent.
 */
export type ChatScope = 'public' | 'support' | 'unknown';

/** How Cinderella classifies a captured message. */
export type MessageKind = 'text' | 'image' | 'video' | 'voice' | 'link' | 'file';

/**
 * An opaque handle to the underlying protocol's own representation of an item.
 *
 * `unknown` deliberately, not a type parameter and not an SDK type. Application
 * code may carry this and hand it back to the adapter (to reply to a message, or
 * to persist it), and may NOT inspect it. That restriction is the whole reason
 * `CapturedMessage` is no longer transitively SDK-typed.
 *
 * KNOWN LEAK, and it is not a property of this domain: `messages.raw_json` stores
 * this value and SQL reads inside it. See `docs/adapter-contract.md` §"Known
 * leaks"; it is scheduled for removal, not a contract a second protocol can honour.
 */
export type RawItem = unknown;

export interface ChatMember {
  /**
   * Stable member id within the bot's own store.
   *
   * NOT durable across a leave and rejoin: a member who leaves and returns gets a
   * new id, and consent deliberately does not carry over. An implementation must
   * preserve that property, because consent is bound to it.
   */
  id: string;
  /** Current display name. May collide between members and may change. */
  displayName: string;
  role: MemberRole;
}

/**
 * A member's standing in a group.
 *
 * Widened from five to the full seven under CCB-S4-032, because moderation exempts
 * roles and an exemption computed from a lossy role is an exemption that can be wrong.
 * `relay` and `author` were absent while nothing read this; the moment something did,
 * mapping them onto a neighbouring value would have been inventing a fact about a
 * member. Ordered low to high, which is the SimpleX hierarchy.
 */
export type MemberRole =
  | 'relay'
  | 'observer'
  | 'author'
  | 'member'
  | 'moderator'
  | 'admin'
  | 'owner';

export interface ChatGroup {
  /** Stable numeric id within the bot's own store. */
  id: number;
  /** Display name. Mutable, so never use it as an identity. */
  displayName: string;
}

export interface IncomingFile {
  /** Protocol file id, unique within the bot's store. */
  id: number;
  /** The sender's own filename. Untrusted, and member data. */
  name: string;
  sizeBytes: number;
}

export interface LinkPreview {
  url: string;
  title: string | undefined;
  description: string | undefined;
  /** Base64 image the sender's client generated. Member pixel data. */
  image: string | undefined;
}

/** One message, as Cinderella understands it. */
export interface ChatMessage {
  kind: ChatKind;
  scope: ChatScope;
  /** Conversation id: group id for a group, contact id for a direct chat. */
  chatId: number;
  chatName: string;
  /** Item id within the bot's store. What deletion events refer to. */
  itemId: number;
  /** Stable across members, useful for tracing. Absent on some item kinds. */
  sharedId: string | undefined;
  sender: ChatMember;
  sentAt: string;
  type: MessageKind;
  text: string;
  linkPreview: LinkPreview | undefined;
  file: IncomingFile | undefined;
  /** The member FORWARDED this rather than writing it. */
  forwarded: boolean;
  /** A direct reply to one of the bot's own messages, which is an address. */
  replyToBot: boolean;
  /** Opaque protocol payload. Carry it, never inspect it. */
  raw: RawItem;
}

/** Events the adapter emits. Cinderella's vocabulary, not the protocol's. */
export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'message-edited'; message: ChatMessage }
  | { type: 'messages-deleted'; chatId: number; itemIds: readonly number[] }
  | { type: 'file-received'; itemId: number; file: IncomingFile; path: string }
  | { type: 'file-failed'; itemId: number; file: IncomingFile; reason: string }
  | { type: 'member-joined'; groupId: number; member: ChatMember }
  | { type: 'member-left'; groupId: number; member: ChatMember };

/** Where to send. Mirrors the three surfaces §3 names. */
export type SendTarget =
  | { to: 'group'; groupId: number }
  | { to: 'support'; groupId: number; memberId: string }
  | { to: 'direct'; contactId: number };

export interface SendOptions {
  /**
   * Reply to this message rather than posting standalone.
   *
   * Carries the opaque handle, so the adapter can build whatever the protocol
   * needs without the caller knowing what that is.
   */
  replyTo?: RawItem;
}

/** What a send produced, so the caller can archive its own output. */
export interface SentMessage {
  itemId: number;
  chatId: number;
  sentAt: string;
  text: string;
  raw: RawItem;
}

export interface BotProfile {
  displayName: string;
  /** Data URI, or undefined when none is set. */
  image: string | undefined;
}
