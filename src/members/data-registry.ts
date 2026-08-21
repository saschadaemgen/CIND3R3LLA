/**
 * THE MEMBER-DATA REGISTRY (CCB-S5-044, D-217): every place this product keeps
 * data about a member, as data, with a verifier that makes silence impossible.
 *
 * ── WHY THIS EXISTS BEFORE THE MEMORY WORK DOES ──────────────────────────────
 *
 * The operator's profile requirement has three parts: per-member optional,
 * honestly disclosed, and deletable IN PARTS - "delete only my music
 * preferences, and the rest stays". The third is a schema decision that is
 * cheap now and expensive later, and the music plugin is about to create the
 * first profile-class storage this product has. So the fence goes up with it,
 * even though the profile itself (the consent handshake, the recital, the
 * deletion paths) is the memory briefing's to build.
 *
 * The shape it fixes, which the memory work must not violate:
 *
 *   1. A profile is named CATEGORIES over registered row-sources, never a blob.
 *      Deleting one category deletes its registered rows and touches nothing
 *      else.
 *   2. Everything recited is DERIVED at read. No living per-member aggregate is
 *      ever stored, so a deletion leaves no ghost: "which tastes" is GROUP BY
 *      over request rows at the moment of asking, and cannot survive them.
 *      (The moderation ladder set the precedent: violations are append-only
 *      events and the rolling window is computed by query. The one legitimate
 *      frozen aggregate is a snapshot recording what a DECISION was taken on -
 *      the sanctions pattern - which is provenance, not profile.)
 *   3. Profile-class rows exist only forward from that member's memory opt-in,
 *      which is a SECOND consent, never inferred from the archive one. Two
 *      different promises: "the world may read what I said" and "she may
 *      remember me".
 *   4. Honesty is derived from THIS registry, across every class - including
 *      what a member cannot delete, with the reason. "What do you know about
 *      me" is application-computed counts, model-phrased, locked (the STATUS
 *      pattern).
 *   5. This registry is data with a structural verifier, not prose: a table
 *      carrying a member-identifying column that is not registered here turns
 *      `verify:member-data` red, so no future capability can accrue member
 *      data the recital does not know about (the setting-scope.ts idiom).
 *
 * ── THE CLASSES, AND WHY DELETABILITY IS NOT UNIFORM ─────────────────────────
 *
 *   'archive'     governed by the EXISTING archive consent: publication derived
 *                 per read, revocation with hide/delete, the CCB-S3-013
 *                 machinery. Not this registry's to govern; listed so the
 *                 recital can say it exists and point at /publish machinery.
 *   'consent'     the provenance of consent decisions themselves. Deliberately
 *                 NOT member-deletable: deleting the record of consent
 *                 decisions destroys the thing that proves consent, which is
 *                 the product's legal backbone.
 *   'safety'      moderation events, the greeted-once record, policy decisions.
 *                 Deliberately NOT member-deletable: a member deleting their own
 *                 violation history defeats moderation. Disclosed honestly when
 *                 asked, with this reason.
 *   'profile'     optional, per-member, forward-from-opt-in, deletable by its
 *                 category. The music plugin's plays table is the first row
 *                 source; today it is registered with its member column always
 *                 NULL (anonymous), because the consent that would permit a
 *                 member id does not exist yet - see D-217's deferral.
 *
 * ── IDENTITY ─────────────────────────────────────────────────────────────────
 *
 * `member_id` here is the SimpleX wire id, which is scoped to the ROOM and
 * reissued on a rejoin (D-190). The profile inherits consent's identity model:
 * per wire id. Cross-room linking, if it ever happens, is the memory work's
 * question and is deliberately not represented here.
 */

/** Where a category's rows stand with respect to member deletion. */
export type MemberDataClass = 'archive' | 'consent' | 'safety' | 'profile';

export interface MemberDataSource {
  /** The table holding the rows. One table may appear once. */
  table: string;
  /** The member-identifying column(s) on it. */
  memberColumns: readonly string[];
  /** The category a member would name to delete it (profile class only). */
  category: string;
  class: MemberDataClass;
  /** One line the recital can print: what this is, in words a member reads. */
  label: string;
  /** Why it is not member-deletable, for the classes where that is the answer. */
  retainedBecause?: string;
}

/**
 * THE INVENTORY. Every table in the schema that carries a member-identifying
 * column. `verify:member-data` sweeps information_schema for columns matching
 * the member-column patterns and fails on any table absent from this list, so
 * additions cannot be silent; removals of tables are caught by the same sweep
 * in reverse (a registered table that does not exist).
 */
export const MEMBER_DATA_SOURCES: readonly MemberDataSource[] = Object.freeze([
  /* ── archive: the existing consent machinery governs these ─────────────── */
  {
    table: 'messages',
    memberColumns: ['sender_member_id'],
    category: 'archive',
    class: 'archive',
    label:
      'Messages captured in the group, published only where you opted in. If you have never ' +
      'used the consent commands at all, the CONTENT of yours is removed once it is past the ' +
      'retention bound the operator set; the row that says a message existed stays (CCB-S5-054).',
  },
  {
    table: 'message_mentions',
    memberColumns: ['member_id'],
    category: 'archive',
    class: 'archive',
    label: 'Places one of her messages mentions a member by name, for redaction.',
  },

  /* ── consent provenance: the legal backbone, retained by design ─────────── */
  {
    table: 'consent',
    memberColumns: ['member_id'],
    category: 'consent',
    class: 'consent',
    label: 'Your current publication decision.',
    retainedBecause:
      'Deleting the record of consent decisions destroys the thing that proves consent.',
  },
  {
    table: 'consent_actions',
    memberColumns: ['member_id'],
    category: 'consent',
    class: 'consent',
    label: 'The journal of every publication decision you made, and how.',
    retainedBecause:
      'Deleting the record of consent decisions destroys the thing that proves consent.',
  },
  {
    table: 'consent_gaps',
    memberColumns: ['member_id'],
    category: 'consent',
    class: 'consent',
    label: 'The stretches you spent unpublished, so a restore never publishes them.',
    retainedBecause: 'It is what keeps a restore from publishing what was said while hidden.',
  },
  {
    table: 'pending_destructions',
    memberColumns: ['member_id'],
    category: 'consent',
    class: 'consent',
    label: 'A deletion you asked for that an evidence hold has deferred.',
    retainedBecause: 'It is the record that your deletion is still owed.',
  },

  /* ── safety: disclosed honestly, not member-deletable ──────────────────── */
  {
    table: 'cinderella_violations',
    memberColumns: ['member_id'],
    category: 'moderation',
    class: 'safety',
    label: 'Moderation events counted against the rolling window.',
    retainedBecause: 'A member deleting their own violation history defeats moderation.',
  },
  {
    table: 'cinderella_sanctions',
    memberColumns: ['member_id', 'group_member_id'],
    category: 'moderation',
    class: 'safety',
    label: 'What the moderation ladder decided, and on what count.',
    retainedBecause: 'A member deleting their own violation history defeats moderation.',
  },
  {
    table: 'cinderella_welcome_greetings',
    memberColumns: ['member_id'],
    category: 'welcome',
    class: 'safety',
    label: 'That you were greeted once, so you are not greeted twice.',
    retainedBecause: 'Deleting it would make her greet you again as a stranger.',
  },
  {
    table: 'cinderella_group_authorities',
    memberColumns: ['simplex_member_id'],
    category: 'authority',
    class: 'safety',
    label: 'A role or authority the operator granted you in a group.',
    retainedBecause: 'It is the operator’s grant, not your record.',
  },
  {
    table: 'cinderella_runtime_policy_decisions',
    memberColumns: ['simplex_member_id'],
    category: 'policy',
    class: 'safety',
    label: 'Content-free allow/deny decisions the runtime took on messages.',
    retainedBecause: 'An operational audit trail; it holds no message content.',
  },

  /* ── profile: optional, deletable in parts - the fence this file exists for ─ */
  //
  // The first and only source today. Its member column is written NULL until
  // the memory work delivers the opt-in (D-217): every play is anonymous, the
  // DJ facts aggregate over anonymous rows, and nothing personal accrues before
  // the machinery to agree to it exists.
  {
    table: 'cinderella_track_plays',
    memberColumns: ['member_id'],
    category: 'music',
    class: 'profile',
    label: 'Tracks played for you, and what you asked for - once you opt in.',
  },
]);

/** Tables whose member linkage is a display-name string, not a wire id. */
export const DISPLAY_NAME_ONLY_SOURCES: readonly string[] = Object.freeze([
  // Onboarding records identify a person only by the name they showed at the
  // time (plus the core's own contact/request ids). Listed so the sweep can
  // hold them apart from wire-id sources rather than ignoring them.
  'cinderella_bot_contact_requests',
  'cinderella_bot_group_invitations',
]);

const byTable = new Map(MEMBER_DATA_SOURCES.map((s) => [s.table, s] as const));

export function memberDataSourceFor(table: string): MemberDataSource | undefined {
  return byTable.get(table);
}

/** The categories a member could name for deletion, when the memory work lands. */
export function deletableCategories(): string[] {
  return [...new Set(
    MEMBER_DATA_SOURCES.filter((s) => s.class === 'profile').map((s) => s.category),
  )];
}
