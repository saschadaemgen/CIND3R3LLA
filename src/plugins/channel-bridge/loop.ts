/**
 * The loop guard: a bridged message is never re-bridged (CCB-S5-032, D-187).
 *
 * ── THE MARKER IS STRUCTURAL, NOT TEXTUAL ────────────────────────────────────
 *
 * The briefing requires that every forwarded message carry a marker the
 * APPLICATION reads back, and that a member can neither forge nor strip by
 * quoting. Any marker inside the message text fails both halves: a member can
 * type it, and a quote can drop it. So the marker is not in the text at all.
 * It is two structural facts, held where members cannot reach:
 *
 * 1. THE MAPPING GRAPH CANNOT REPRESENT A CYCLE. A source must be a channel and
 *    a destination must NOT be one, so every edge goes channel -> group, and a
 *    cycle would need an edge leaving a group, which no mapping can hold. This
 *    is enforced at configuration time, below, with two belt-and-braces
 *    refusals for the day the kind data is stale.
 *
 * 2. THE BRIDGE RECOGNISES ITS OWN SENDS. Every forward's shared message id is
 *    recorded, and an arriving channel post whose shared id matches a recorded
 *    send is refused with a suppression record ('loop-refused'), never
 *    silently. This covers what the graph cannot: a bridge OUTSIDE this
 *    deployment re-injecting our announcement into a channel we read.
 *
 * ── THE STATED LIMIT ─────────────────────────────────────────────────────────
 *
 * A foreign bridge that rewrites our announcement into a NEW message (new
 * shared id, altered text) is indistinguishable from a genuine post, and no
 * marker any bridge could carry survives a rewrite by a party that wants it
 * gone. The guarantee here is exact and bounded: THIS deployment's bridge
 * never re-bridges its own product, and its mapping graph cannot loop.
 */

export interface MappingCandidate {
  botProfileId: number;
  sourceGroupId: number;
  destGroupId: number;
}

export interface ExistingMappingEdge {
  botProfileId: number;
  sourceGroupId: number;
  destGroupId: number;
}

export type MappingRefusal =
  | { reason: 'source-not-channel' }
  | { reason: 'dest-is-channel' }
  | { reason: 'source-equals-dest' }
  | { reason: 'dest-feeds-a-mapping'; conflictSourceGroupId: number }
  | { reason: 'source-receives-from-a-mapping'; conflictDestGroupId: number };

/**
 * Refuses any mapping that could participate in a cycle, at save time.
 *
 * The kind checks are the guarantee; the two graph checks are the belt for a
 * stale kind answer (a group whose channel-ness the core reported differently
 * on another day). All refusals are per BOT: two bots' graphs are disjoint by
 * construction because a mapping's source and destination are the core's
 * per-profile group ids, meaningful only for the bot that holds them.
 */
export function refuseMapping(
  candidate: MappingCandidate,
  existing: readonly ExistingMappingEdge[],
  isChannel: (groupId: number) => boolean,
): MappingRefusal | null {
  if (!isChannel(candidate.sourceGroupId)) return { reason: 'source-not-channel' };
  if (isChannel(candidate.destGroupId)) return { reason: 'dest-is-channel' };
  if (candidate.sourceGroupId === candidate.destGroupId) return { reason: 'source-equals-dest' };

  const own = existing.filter((e) => e.botProfileId === candidate.botProfileId);
  const feeds = own.find((e) => e.sourceGroupId === candidate.destGroupId);
  if (feeds !== undefined) {
    return { reason: 'dest-feeds-a-mapping', conflictSourceGroupId: feeds.sourceGroupId };
  }
  const receives = own.find((e) => e.destGroupId === candidate.sourceGroupId);
  if (receives !== undefined) {
    return { reason: 'source-receives-from-a-mapping', conflictDestGroupId: receives.destGroupId };
  }
  return null;
}

/** One honest sentence per refusal, for the console. */
export function refusalText(refusal: MappingRefusal): string {
  switch (refusal.reason) {
    case 'source-not-channel':
      return 'The source must be a channel. Ordinary groups never feed the bridge; that is what makes a loop impossible to configure.';
    case 'dest-is-channel':
      return 'The destination must be an ordinary group, not a channel. A channel that receives bridged posts could feed another mapping, and that is a loop.';
    case 'source-equals-dest':
      return 'A mapping cannot feed a group from itself.';
    case 'dest-feeds-a-mapping':
      return 'That destination is already the SOURCE of another mapping, so posting into it would be re-bridged. Remove the other mapping first if this is really wanted.';
    case 'source-receives-from-a-mapping':
      return 'That source is already the DESTINATION of another mapping, so it would re-bridge what the bridge itself delivered.';
  }
}
