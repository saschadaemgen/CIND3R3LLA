/**
 * Which bot owns which group (CCB-S5-001, D-155).
 *
 * ── THE FACT THIS RESTS ON, READ OUT OF THE SHIPPED CORE RATHER THAN ASSUMED ──
 *
 * `groups.group_id` in the core's own SQLite is `INTEGER PRIMARY KEY`: one counter for
 * the whole database, not one per profile. The row carries `user_id` beside it, and the
 * uniqueness that makes a profile's groups distinct is `UNIQUE (user_id,
 * group_profile_id)`. Two profiles that join the SAME SimpleX group therefore hold TWO
 * rows with two different `group_id`s.
 *
 * Two consequences, and the whole file follows from them:
 *
 *   1. A core group id maps to EXACTLY ONE profile. So the owning bot is derivable from
 *      the group id alone, and nothing has to be stored against the archive to find it.
 *      That is what lets the consent-erasure path stay keyed on `(group_id, item_id)`.
 *   2. Group ids CANNOT collide across bots, so `UNIQUE (group_id, group_msg_id)` on
 *      `messages` stays sound with any number of bots hosted.
 *
 * ── WHY GETTING THIS WRONG IS SILENT ─────────────────────────────────────────
 *
 * Every command that takes no explicit user id executes as whichever profile is active.
 * The core's erasure runs `DELETE FROM chat_items WHERE user_id = ? AND group_id = ? AND
 * chat_item_id = ?`. Issued as the wrong bot, `user_id` matches nothing: zero rows are
 * deleted and NO ERROR IS RAISED, because the core was asked to delete something that,
 * for that user, does not exist. A member's erasure would be reported as done and the
 * content would still be on the host. That is the reason this index exists and the
 * reason an unknown owner throws here rather than falling back to the active profile.
 *
 * ── NO SDK IMPORT ────────────────────────────────────────────────────────────
 *
 * Like `scheduler.ts` and `router.ts`: this takes plain records, so a harness can drive
 * it with no Haskell core. `core.ts` is the only file that turns `apiListGroups` output
 * into these.
 */

/** One group, as one hosted profile sees it. */
export interface OwnedGroup {
  /** The core's own group id. Unique across the whole core database. */
  groupId: number;
  /** The SimpleX user id of the profile that holds this row. */
  simplexUserId: number;
  /** For logs and the console. Mutable: a group admin can rename a group. */
  localDisplayName: string;
  /**
   * A stable identity for the REAL group, shared by every profile in it, or null when
   * the core reports nothing that identifies it.
   *
   * This is what makes "two of my bots are in the same group" answerable, which the
   * group id deliberately cannot answer (see the header: same group, different ids).
   * Null is a real answer and callers must treat it as "cannot tell", never as "not
   * shared" - see {@link GroupOwnership.sharedGroups}.
   */
  sharedKey: string | null;
}

/** Two hosted bots sitting in one real group. */
export interface SharedGroup {
  sharedKey: string;
  members: OwnedGroup[];
}

/**
 * The group-to-bot index.
 *
 * Rebuilt per profile rather than mutated per event: `adopt` replaces everything known
 * about one profile in one step, so a profile that has left a group loses the entry
 * instead of keeping a stale one that would route an erasure at a group it is no longer
 * in.
 */
export class GroupOwnership {
  private readonly byGroup = new Map<number, OwnedGroup>();
  private readonly byContact = new Map<number, number>();

  /**
   * Replace everything known about one profile.
   *
   * Entries for OTHER profiles are untouched, so refreshing one bot cannot blank the
   * rest - which matters because a refresh happens per profile and one of them failing
   * must not take the others' routing down with it.
   */
  adopt(simplexUserId: number, groups: readonly Omit<OwnedGroup, 'simplexUserId'>[]): void {
    for (const [groupId, owned] of this.byGroup) {
      if (owned.simplexUserId === simplexUserId) this.byGroup.delete(groupId);
    }
    for (const g of groups) {
      this.byGroup.set(g.groupId, { ...g, simplexUserId });
    }
  }

  /**
   * Replace everything known about one profile's DIRECT chats.
   *
   * `contacts.contact_id` is `INTEGER PRIMARY KEY` in the core, exactly like
   * `groups.group_id`, so a contact id also maps to exactly one profile and the same
   * index shape works. Kept separate from groups because it is filled on a different
   * schedule: nothing books a direct-chat erasure today, so this is populated only when
   * one is actually requested (see `core.ts`), rather than paying `apiListContacts` -
   * which loads every contact into memory in one response - on every boot.
   */
  adoptContacts(simplexUserId: number, contactIds: readonly number[]): void {
    for (const [contactId, owner] of this.byContact) {
      if (owner === simplexUserId) this.byContact.delete(contactId);
    }
    for (const id of contactIds) this.byContact.set(id, simplexUserId);
  }

  /** The owning profile of a direct chat, or undefined when it is not indexed. */
  contactOwner(contactId: number): number | undefined {
    return this.byContact.get(contactId);
  }

  /** Whether any direct-chat ownership has been read at all. */
  get contactsIndexed(): boolean {
    return this.byContact.size > 0;
  }

  /** Forget one profile entirely, e.g. when it stops being hosted. */
  forget(simplexUserId: number): void {
    this.adopt(simplexUserId, []);
    this.adoptContacts(simplexUserId, []);
  }

  /** The owning profile, or undefined when this group id is not known to be hosted. */
  owner(groupId: number): number | undefined {
    return this.byGroup.get(groupId)?.simplexUserId;
  }

  /** The full record, for logs and the console. */
  group(groupId: number): OwnedGroup | undefined {
    return this.byGroup.get(groupId);
  }

  /** Every group one profile holds. */
  groupsOf(simplexUserId: number): OwnedGroup[] {
    return [...this.byGroup.values()].filter((g) => g.simplexUserId === simplexUserId);
  }

  get size(): number {
    return this.byGroup.size;
  }

  all(): OwnedGroup[] {
    return [...this.byGroup.values()];
  }

  /**
   * Real groups that more than one hosted bot sits in.
   *
   * Only groups whose `sharedKey` is known are considered: a null key means the core
   * gave us nothing to compare, and reporting "not shared" from an absence of evidence
   * would be the masking CCB-S3-023 forbids. Callers that need to know about the
   * unknowns ask {@link unidentifiedGroups}.
   */
  sharedGroups(): SharedGroup[] {
    const byKey = new Map<string, OwnedGroup[]>();
    for (const g of this.byGroup.values()) {
      if (g.sharedKey === null) continue;
      const list = byKey.get(g.sharedKey);
      if (list) list.push(g);
      else byKey.set(g.sharedKey, [g]);
    }
    const out: SharedGroup[] = [];
    for (const [sharedKey, members] of byKey) {
      const distinctBots = new Set(members.map((m) => m.simplexUserId));
      if (distinctBots.size > 1) out.push({ sharedKey, members });
    }
    return out;
  }

  /** Groups the core gave no shared identity for, so co-tenancy cannot be ruled out. */
  unidentifiedGroups(): OwnedGroup[] {
    return [...this.byGroup.values()].filter((g) => g.sharedKey === null);
  }
}

/**
 * Thrown when a command has to be issued as a particular bot and the group is not known
 * to belong to any hosted one.
 *
 * A named class rather than a bare Error because the queue distinguishes it: an unknown
 * owner is retryable (the index refreshes), a rejected command is not.
 */
export class UnknownGroupOwnerError extends Error {
  constructor(readonly groupId: number) {
    super(
      `group ${String(groupId)} does not belong to any hosted bot, so a command for it ` +
        `cannot be issued as anybody. Refusing rather than sending it as whichever ` +
        `profile happens to be active, which would run against the wrong user id and ` +
        `succeed silently while doing nothing.`,
    );
    this.name = 'UnknownGroupOwnerError';
  }
}
