/**
 * The persistent bot registry (briefing §6.7): one row per SimpleX profile the
 * multi-profile runtime may host.
 *
 * No SDK import, matching the rest of `src/profiles/`, which is configuration and
 * policy and never drives the core. The runtime reads this to decide which profiles
 * to host; nothing here talks to SimpleX.
 *
 * ── WHERE THE §14 INVARIANTS LIVE ────────────────────────────────────────────
 *
 * Half are in the DDL, where a constraint can see the row (migration 023): a
 * `human_operated_agent` cannot be `fully_automated`, cannot lack an operator, and an
 * `npc` cannot lack a disclosure label. Those hold at rest, against any writer.
 *
 * The other half cannot be a constraint, because the word in §14 is **silently**. A
 * CHECK sees the row after the change, never the intent behind it. So every mutation
 * here goes through one write path that audits what changed, and the two transitions
 * §14 names are refused outright rather than audited:
 *
 *   - an actor type may never change at all after creation (see `setActorType`'s
 *     absence: there is no such function). What a profile IS is not editable; a
 *     mistake is corrected by deleting the row and re-registering, which leaves two
 *     audit entries instead of one silent one.
 *   - `takeOver` is the only way out of `autopilot`, and it is audited as a takeover
 *     rather than as an ordinary mode change, because §14 requires manual takeover to
 *     be persisted and audited in its own right.
 */

import type { Queryable } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';

/** Briefing §3. Order matters for nothing; the CHECK in 023 is the authority. */
export const ACTOR_TYPES = [
  'human_user',
  'human_operated_agent',
  'npc',
  'system_automation',
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Briefing §3.3. */
export const AUTOMATION_MODES = ['manual', 'assisted', 'autopilot', 'fully_automated'] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

/** Briefing §3.2. The generator itself is out of scope for this phase. */
export const AVATAR_SOURCES = [
  'none',
  'uploaded',
  'generated_template',
  'generated_local_ai',
] as const;
export type AvatarSource = (typeof AVATAR_SOURCES)[number];

/**
 * Default automation mode per actor type (briefing §3.3).
 *
 * `human_operated_agent` defaults to `assisted` rather than `autopilot`: the briefing
 * permits either, and the quieter of two permitted defaults is the right one when the
 * difference is how much a thing does without being asked.
 *
 * Applied here rather than as a DDL default, because a single column default cannot
 * depend on another column's value.
 */
export const DEFAULT_AUTOMATION_MODE: Readonly<Record<ActorType, AutomationMode>> = Object.freeze({
  human_user: 'manual',
  human_operated_agent: 'assisted',
  npc: 'fully_automated',
  system_automation: 'fully_automated',
});

/** Briefing §9.1. The seed reconstructs a personality given the configuration version. */
export interface PersonalityRef {
  personalityId: string;
  seed: number;
  configVersion: string;
}

export interface BotRegistryEntry {
  id: string;
  simplexUserId: number;
  displayName: string;
  actorType: ActorType;
  automationMode: AutomationMode;
  avatarSource: AvatarSource;
  avatarRef: string | null;
  disclosureLabel: string | null;
  humanOperatorRef: string | null;
  personality: PersonalityRef | null;
  enabled: boolean;
  policyProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterProfileInput {
  simplexUserId: number;
  displayName: string;
  actorType: ActorType;
  /** Omit to take the §3.3 default for the actor type. */
  automationMode?: AutomationMode;
  avatarSource?: AvatarSource;
  avatarRef?: string | null;
  disclosureLabel?: string | null;
  humanOperatorRef?: string | null;
  personality?: PersonalityRef | null;
  policyProfileId?: string | null;
}

/**
 * SimpleX rejects `.` and `'` in display names (briefing §12), so a name carrying one
 * cannot be applied to a profile.
 *
 * Sanitising rather than rejecting, because these names come from operators and from
 * the core's own store, and failing a registration over an apostrophe would be
 * unhelpful. The DDL rejects what this misses, so a bypassed sanitiser is a loud
 * failure rather than an unusable profile.
 */
export function sanitiseDisplayName(raw: string): string {
  const cleaned = raw.replace(/[.']/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) {
    throw new Error(
      `Bot registry: display name ${JSON.stringify(raw)} is empty once SimpleX's ` +
        `forbidden characters (. and ') are removed, so there is no usable name left.`,
    );
  }
  return cleaned.slice(0, 80);
}

interface Row {
  id: string;
  simplex_user_id: string;
  display_name: string;
  actor_type: ActorType;
  automation_mode: AutomationMode;
  avatar_source: AvatarSource;
  avatar_ref: string | null;
  disclosure_label: string | null;
  human_operator_ref: string | null;
  personality_id: string | null;
  personality_seed: string | null;
  personality_config_version: string | null;
  enabled: boolean;
  policy_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, simplex_user_id, display_name, actor_type, automation_mode,
                 avatar_source, avatar_ref, disclosure_label, human_operator_ref,
                 personality_id, personality_seed, personality_config_version,
                 enabled, policy_profile_id, created_at, updated_at`;

function toEntry(row: Row): BotRegistryEntry {
  return {
    id: row.id,
    // BIGINT arrives as a string from node-postgres; the runtime compares it against
    // the number the SDK carries on every event, so it is converted once, here.
    simplexUserId: Number(row.simplex_user_id),
    displayName: row.display_name,
    actorType: row.actor_type,
    automationMode: row.automation_mode,
    avatarSource: row.avatar_source,
    avatarRef: row.avatar_ref,
    disclosureLabel: row.disclosure_label,
    humanOperatorRef: row.human_operator_ref,
    personality:
      row.personality_id === null || row.personality_seed === null
        ? null
        : {
            personalityId: row.personality_id,
            seed: Number(row.personality_seed),
            configVersion: row.personality_config_version ?? '',
          },
    enabled: row.enabled,
    policyProfileId: row.policy_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Register a profile discovered in, or created in, the SimpleX core. */
export async function registerProfile(
  db: Queryable,
  actor: string,
  input: RegisterProfileInput,
): Promise<BotRegistryEntry> {
  const mode = input.automationMode ?? DEFAULT_AUTOMATION_MODE[input.actorType];
  const avatarSource = input.avatarSource ?? 'none';
  const { rows } = await db.query<Row>(
    `INSERT INTO cinderella_bot_registry
       (simplex_user_id, display_name, actor_type, automation_mode, avatar_source,
        avatar_ref, disclosure_label, human_operator_ref,
        personality_id, personality_seed, personality_config_version, policy_profile_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${COLUMNS}`,
    [
      input.simplexUserId,
      sanitiseDisplayName(input.displayName),
      input.actorType,
      mode,
      avatarSource,
      input.avatarRef ?? null,
      input.disclosureLabel ?? null,
      input.humanOperatorRef ?? null,
      input.personality?.personalityId ?? null,
      input.personality?.seed ?? null,
      input.personality?.configVersion ?? null,
      input.policyProfileId ?? null,
    ],
  );
  const entry = toEntry(rows[0]!);
  await writeAudit(db, actor, 'cinderella.bot-registry.register', String(entry.simplexUserId), {
    actorType: entry.actorType,
    automationMode: entry.automationMode,
    displayName: entry.displayName,
  });
  return entry;
}

export async function listProfiles(db: Queryable): Promise<BotRegistryEntry[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM cinderella_bot_registry ORDER BY simplex_user_id`,
  );
  return rows.map(toEntry);
}

/** The profiles the runtime may host. */
export async function listEnabledProfiles(db: Queryable): Promise<BotRegistryEntry[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM cinderella_bot_registry WHERE enabled ORDER BY simplex_user_id`,
  );
  return rows.map(toEntry);
}

export async function findBySimplexUserId(
  db: Queryable,
  simplexUserId: number,
): Promise<BotRegistryEntry | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM cinderella_bot_registry WHERE simplex_user_id = $1`,
    [simplexUserId],
  );
  return rows.length > 0 ? toEntry(rows[0]!) : null;
}

async function requireEntry(db: Queryable, simplexUserId: number): Promise<BotRegistryEntry> {
  const found = await findBySimplexUserId(db, simplexUserId);
  if (found === null) {
    throw new Error(
      `Bot registry: no profile registered for SimpleX user id ${simplexUserId}. ` +
        `A profile must be registered before it can be enabled or have its mode changed.`,
    );
  }
  return found;
}

/**
 * Change the automation mode.
 *
 * REFUSES the two transitions §14 forbids, rather than auditing them after the fact:
 * a `human_operated_agent` cannot be driven to `fully_automated` (the DDL would refuse
 * it too, but the error here says why), and leaving `autopilot` goes through
 * {@link takeOver} so a takeover is recorded as a takeover.
 */
export async function setAutomationMode(
  db: Queryable,
  actor: string,
  simplexUserId: number,
  mode: AutomationMode,
): Promise<BotRegistryEntry> {
  const before = await requireEntry(db, simplexUserId);
  if (before.automationMode === mode) return before;

  if (before.actorType === 'human_operated_agent' && mode === 'fully_automated') {
    throw new Error(
      `Bot registry: refusing to set SimpleX user ${simplexUserId} to fully_automated. ` +
        `It is a human_operated_agent, and §14 requires that one never becomes a fully ` +
        `automated NPC. Re-register it as an npc deliberately if that is the intent.`,
    );
  }
  if (before.automationMode === 'autopilot' && mode === 'manual') {
    throw new Error(
      `Bot registry: leaving autopilot for manual is a takeover. Call takeOver() so it ` +
        `is persisted and audited as one (§14), not as an ordinary mode change.`,
    );
  }

  const after = await writeMode(db, simplexUserId, mode);
  await writeAudit(db, actor, 'cinderella.bot-registry.automation-mode', String(simplexUserId), {
    from: before.automationMode,
    to: mode,
    actorType: before.actorType,
  });
  return after;
}

/**
 * A human takes manual control of a human-operated agent (§3.2, §14).
 *
 * Separate from {@link setAutomationMode} because §14 requires manual takeover to be
 * persisted and audited in its own right. A takeover of something already manual is a
 * no-op rather than an error: the operator got what they asked for.
 */
export async function takeOver(
  db: Queryable,
  actor: string,
  simplexUserId: number,
  reason: string,
): Promise<BotRegistryEntry> {
  const before = await requireEntry(db, simplexUserId);
  if (before.actorType !== 'human_operated_agent') {
    throw new Error(
      `Bot registry: SimpleX user ${simplexUserId} is a ${before.actorType}, which has no ` +
        `human operator to take over from. Takeover applies to human_operated_agent only.`,
    );
  }
  if (before.automationMode === 'manual') return before;

  const after = await writeMode(db, simplexUserId, 'manual');
  await writeAudit(db, actor, 'cinderella.bot-registry.takeover', String(simplexUserId), {
    from: before.automationMode,
    to: 'manual',
    operator: before.humanOperatorRef,
    reason,
  });
  return after;
}

async function writeMode(
  db: Queryable,
  simplexUserId: number,
  mode: AutomationMode,
): Promise<BotRegistryEntry> {
  const { rows } = await db.query<Row>(
    `UPDATE cinderella_bot_registry
        SET automation_mode = $2, updated_at = now()
      WHERE simplex_user_id = $1
      RETURNING ${COLUMNS}`,
    [simplexUserId, mode],
  );
  return toEntry(rows[0]!);
}

/** Enable or disable hosting. Discovered profiles start disabled (migration 023). */
export async function setEnabled(
  db: Queryable,
  actor: string,
  simplexUserId: number,
  enabled: boolean,
): Promise<BotRegistryEntry> {
  const before = await requireEntry(db, simplexUserId);
  if (before.enabled === enabled) return before;

  const { rows } = await db.query<Row>(
    `UPDATE cinderella_bot_registry
        SET enabled = $2, updated_at = now()
      WHERE simplex_user_id = $1
      RETURNING ${COLUMNS}`,
    [simplexUserId, enabled],
  );
  await writeAudit(db, actor, 'cinderella.bot-registry.enabled', String(simplexUserId), {
    from: before.enabled,
    to: enabled,
    actorType: before.actorType,
  });
  return toEntry(rows[0]!);
}

/** Attach the personality reference once the generator has one to give (§9.1). */
export async function setPersonality(
  db: Queryable,
  actor: string,
  simplexUserId: number,
  personality: PersonalityRef | null,
): Promise<BotRegistryEntry> {
  await requireEntry(db, simplexUserId);
  const { rows } = await db.query<Row>(
    `UPDATE cinderella_bot_registry
        SET personality_id = $2, personality_seed = $3, personality_config_version = $4,
            updated_at = now()
      WHERE simplex_user_id = $1
      RETURNING ${COLUMNS}`,
    [
      simplexUserId,
      personality?.personalityId ?? null,
      personality?.seed ?? null,
      personality?.configVersion ?? null,
    ],
  );
  await writeAudit(db, actor, 'cinderella.bot-registry.personality', String(simplexUserId), {
    personalityId: personality?.personalityId ?? null,
    configVersion: personality?.configVersion ?? null,
  });
  return toEntry(rows[0]!);
}
