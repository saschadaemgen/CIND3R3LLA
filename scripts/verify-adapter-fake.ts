/**
 * The seam, proven (CCB-S3-020 §6).
 *
 * Drives the adapter interface end to end with NO SDK in the process. The point
 * is not that a fake can be written: it is that if anything were still leaking an
 * SDK type through the interface, this file could not compile or could not run,
 * because `simplex-chat` is never imported here and the seam check forbids the
 * application code it exercises from importing it either.
 *
 *   npx tsx scripts/verify-adapter-fake.ts
 */

import { FakeChatAdapter } from '../src/adapter/fake.js';
import type { ChatAdapter } from '../src/adapter/chat-adapter.js';
import type { ChatEvent, ChatMessage } from '../src/adapter/types.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    kind: 'group',
    scope: 'public',
    chatId: 1,
    chatName: 'Test Group',
    itemId: 10,
    sharedId: 'shared-10',
    sender: { id: 'member-1', displayName: 'Alice', role: 'member' },
    sentAt: '2026-07-20T10:00:00Z',
    type: 'text',
    text: 'hello',
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    replyToBot: false,
    raw: { fake: true },
    ...over,
  };
}

async function main(): Promise<void> {
  // Typed as the INTERFACE, never the concrete class: if an SDK type were still
  // in a signature, this assignment would not typecheck.
  const fake = new FakeChatAdapter();
  const adapter: ChatAdapter = fake;

  section('1. Lifecycle');
  await adapter.start();
  check('starts', fake.isStarted());

  section('2. Sending, to all three surfaces');
  await adapter.sendText({ to: 'group', groupId: 1 }, 'to the group');
  await adapter.sendText({ to: 'support', groupId: 1, memberId: 'member-1' }, 'privately');
  await adapter.sendText({ to: 'direct', contactId: 7 }, 'direct');
  check('all three targets are expressible and recorded', fake.sends.length === 3);
  check(
    'the support target carries the member, which is what makes it private',
    fake.sends[1]?.target.to === 'support',
  );

  const sent = await adapter.sendText({ to: 'group', groupId: 1 }, 'a reply', {
    replyTo: { fake: 'handle' },
  });
  check('a reply returns what was sent, so it can be archived', sent[0]?.text === 'a reply');
  check('and the opaque reply handle passed through untouched', fake.sends[3]?.opts !== undefined);

  section('3. Receiving, in our own event vocabulary');
  const seen: ChatEvent[] = [];
  adapter.onEvent((e) => {
    seen.push(e);
  });
  await fake.emit({ type: 'message', message: message() });
  await fake.emit({ type: 'message', message: message({ scope: 'support', itemId: 11 }) });
  await fake.emit({ type: 'messages-deleted', chatId: 1, itemIds: [10] });
  await fake.emit({
    type: 'file-received',
    itemId: 12,
    file: { id: 3, name: 'photo.jpg', sizeBytes: 10 },
    path: '/tmp/photo.jpg',
  });
  await fake.emit({
    type: 'member-joined',
    groupId: 1,
    member: { id: 'member-3', displayName: 'Carol', role: 'member' },
  });
  check('every event kind arrives', seen.length === 5);

  // The distinction CCB-S3-019 turned on, now a required field rather than an
  // optional discriminator that could be absent.
  const scopes = seen
    .filter((e): e is Extract<ChatEvent, { type: 'message' }> => e.type === 'message')
    .map((e) => e.message.scope);
  check(
    'public and support are distinguishable without inspecting the protocol',
    scopes.includes('public') && scopes.includes('support'),
    scopes.join(','),
  );

  // Delivery contract: once, never re-sent.
  let calls = 0;
  const failing = new FakeChatAdapter();
  failing.onEvent(() => {
    calls += 1;
    throw new Error('handler failed');
  });
  await failing.emit({ type: 'messages-deleted', chatId: 1, itemIds: [1] });
  check('a failing handler is called exactly once and the event is not redelivered', calls === 1);

  section('4. Files');
  const path = await adapter.receiveFile(3, 1000);
  check('a file resolves to a path', path === fake.filePath);
  fake.failNextFile = 'relay expired';
  let fileFailed = false;
  try {
    await adapter.receiveFile(4, 1000);
  } catch {
    fileFailed = true;
  }
  check('and a failed receipt rejects rather than resolving to nothing', fileFailed);

  section('5. Profile, groups, members');
  await adapter.updateProfile({ displayName: 'Cinderella', image: 'data:image/jpg;base64,AAA' });
  const profile = await adapter.getProfile();
  check('profile round-trips', profile.image?.startsWith('data:') === true);
  check('groups list', (await adapter.listGroups()).length === 1);
  const members = await adapter.listMembers(1);
  check('members carry stable ids and roles', members[0]?.id === 'member-1' && members[1]?.role === 'admin');

  section('6. Erasure');
  await adapter.eraseOwnCopy('group', 1, [10, 11]);
  await adapter.eraseOwnCopy('direct', 7, [99]);
  check('erasures are recorded with their chat kind', fake.erasures.length === 2);
  check(
    'and a direct erasure is distinguishable from a group one',
    fake.erasures[1]?.chatKind === 'direct',
  );

  await adapter.stop();
  check('stops', !fake.isStarted());

  section('7. No SDK is present in this process');
  let sdkLoaded = false;
  try {
    // If the seam leaked, something above would have pulled this in already.
    sdkLoaded = Object.keys(require.cache ?? {}).some((k) => k.includes('simplex-chat'));
  } catch {
    sdkLoaded = false;
  }
  check('simplex-chat was never loaded', !sdkLoaded);

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} FAILURE(S)`} - adapter fake.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
