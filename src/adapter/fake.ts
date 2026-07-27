/**
 * An in-memory chat adapter, with no SDK anywhere near it (CCB-S3-020 §6).
 *
 * TWO JOBS. It proves the seam is real: if a harness can drive Cinderella through
 * this, then nothing was leaking through the interface, because there is no
 * `simplex-chat` in the process at all. And it makes future testing cheap, which
 * is the immediate payoff for work whose main benefit is years away.
 *
 * It is deliberately simple-minded. It is not a SimpleX simulator and must never
 * grow into one: the behaviours a real implementation has to reproduce belong in
 * `docs/adapter-contract.md`, where they can be read, rather than being encoded
 * here where they would only be discovered by a failing test.
 *
 * The one contract property it DOES model is delivery: `emit` calls handlers once
 * and never redelivers, matching the guarantee the real core gives and the reason
 * capture writes ahead (CCB-S3-024).
 */

import type { ChatAdapter } from './chat-adapter.js';
import type {
  BotProfile,
  ChatEvent,
  ChatGroup,
  ChatMember,
  SendOptions,
  SendTarget,
  SentMessage,
} from './types.js';

export interface FakeSend {
  target: SendTarget;
  text: string;
  opts: SendOptions | undefined;
}

export interface FakeErase {
  chatKind: 'group' | 'direct';
  chatId: number;
  itemIds: readonly number[];
}

/**
 * A recording, controllable adapter.
 *
 * Everything it did is inspectable (`sends`, `erasures`, `receivedFiles`), and
 * everything it will do is settable, so a harness can drive Cinderella without a
 * network, a core, or a filesystem.
 */
export class FakeChatAdapter implements ChatAdapter {
  readonly sends: FakeSend[] = [];
  readonly erasures: FakeErase[] = [];
  readonly receivedFiles: number[] = [];

  private handlers: ((e: ChatEvent) => Promise<void> | void)[] = [];
  private started = false;
  private nextItemId = 1;

  groups: ChatGroup[] = [{ id: 1, displayName: 'Test Group' }];
  members: ChatMember[] = [
    { id: 'member-1', displayName: 'Alice', role: 'member' },
    { id: 'member-2', displayName: 'Bob', role: 'admin' },
  ];
  profile: BotProfile = { displayName: 'CIND3R3LLA', image: undefined };
  /** Set to make the next `receiveFile` reject, to exercise failure handling. */
  failNextFile: string | null = null;
  /** Path `receiveFile` resolves to. */
  filePath = '/tmp/fake-file.bin';

  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.started = false;
    this.handlers = [];
    return Promise.resolve();
  }

  isStarted(): boolean {
    return this.started;
  }

  onEvent(handler: (event: ChatEvent) => Promise<void> | void): void {
    this.handlers.push(handler);
  }

  /**
   * Delivers one event to every handler, exactly once.
   *
   * A handler that throws does NOT stop the others and the event is NOT retried,
   * which is the real core's behaviour and the reason capture must write ahead
   * rather than trust redelivery.
   */
  async emit(event: ChatEvent): Promise<void> {
    for (const h of this.handlers) {
      try {
        await h(event);
      } catch {
        // Swallowed on purpose: this models "delivered once, never re-sent".
      }
    }
  }

  sendText(target: SendTarget, text: string, opts?: SendOptions): Promise<SentMessage[]> {
    this.sends.push({ target, text, opts });
    const itemId = this.nextItemId++;
    const chatId = target.to === 'direct' ? target.contactId : target.groupId;
    return Promise.resolve([
      {
        itemId,
        chatId,
        sentAt: new Date(0).toISOString(),
        text,
        raw: { fake: true, itemId, chatId },
      },
    ]);
  }

  receiveFile(fileId: number): Promise<string> {
    if (this.failNextFile !== null) {
      const reason = this.failNextFile;
      this.failNextFile = null;
      return Promise.reject(new Error(reason));
    }
    this.receivedFiles.push(fileId);
    return Promise.resolve(this.filePath);
  }

  getProfile(): Promise<BotProfile> {
    return Promise.resolve({ ...this.profile });
  }

  updateProfile(profile: Partial<BotProfile>): Promise<void> {
    this.profile = { ...this.profile, ...profile };
    return Promise.resolve();
  }

  listGroups(): Promise<ChatGroup[]> {
    return Promise.resolve([...this.groups]);
  }

  listMembers(): Promise<ChatMember[]> {
    return Promise.resolve([...this.members]);
  }

  eraseOwnCopy(
    chatKind: 'group' | 'direct',
    chatId: number,
    itemIds: readonly number[],
  ): Promise<void> {
    this.erasures.push({ chatKind, chatId, itemIds: [...itemIds] });
    return Promise.resolve();
  }
}
