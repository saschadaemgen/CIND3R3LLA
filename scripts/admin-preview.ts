/**
 * Local admin-console preview: boots the REAL server with the REAL views on
 * 127.0.0.1:8788 against an in-process PGlite database seeded with placeholder
 * data — no live PostgreSQL, no SimpleX core, no secrets.
 *
 *   npx tsx scripts/admin-preview.ts
 *   -> http://127.0.0.1:8788  (user: operator, password: preview-password)
 *
 * DEV ONLY. Uses fixed placeholder credentials and seeded fake data; never run
 * on a public host.
 */

import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { recordMediaError, updateMedia, upsertMessage } from '../src/db/messages.js';
import { recordOptIn } from '../src/db/consent.js';
import {
  createBotOnboardingProfile,
  updateBotPersonality,
} from '../src/profiles/bot-onboarding.js';
import { DEFAULT_ORIGIN, DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { SettingsService } from '../src/settings/service.js';
import { WebSearchService, setWebSearchService } from '../src/plugins/web-search/service.js';
import { PromptRuleService, setPromptRuleService } from '../src/interaction/prompt-rule-service.js';
import { WEB_SEARCH_DEFAULTS } from '../src/plugins/web-search/settings.js';
import { SecurityService } from '../src/security/settings.js';
import type { Queryable } from '../src/db/pool.js';
import type { AdminConfig, Config } from '../src/config.js';

// `PORT` as well as `PREVIEW_PORT`, so a launcher that assigns a free port can hand one
// over when 8788 is already taken by an older preview.
const PORT = Number(process.env['PREVIEW_PORT'] ?? process.env['PORT']) || 8788;
const PASSWORD = 'preview-password';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db: Queryable = {
    async query(text, values) {
      const res = await pg.query(text, values ? [...values] : undefined);
      return {
        rows: res.rows as never[],
        rowCount: (res.affectedRows ?? res.rows.length) as number,
      };
    },
  };
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);

  // --- Seed placeholder data (never real member data) ---
  const A = 'member-alice-0000000000000000';
  const B = 'member-bob-00000000000000000';
  await recordOptIn(db, A, '2026-07-10T08:00:00Z');

  const seed = (id: number, member: string, type: string, text: string | null, sentAt: string) =>
    upsertMessage(db, {
      groupId: 1,
      groupMsgId: id,
      sharedMsgId: null,
      senderMemberId: member,
      senderDisplayName: member === A ? 'Alice' : 'Bob',
      sentAt,
      type: type as never,
      textBody: text,
      linksText: null,
      rawJson: { seed: id },
    });

  await seed(
    1,
    A,
    'text',
    'The pumpkin carriage departs at midnight sharp.',
    '2026-07-14T09:00:00Z',
  );
  await seed(
    2,
    A,
    'link',
    'Coverage of the royal ball: https://gazette.example/royal-ball',
    '2026-07-14T10:00:00Z',
  );
  await seed(
    3,
    B,
    'text',
    'Bob has not opted in, so this stays unpublished.',
    '2026-07-14T11:00:00Z',
  );
  await seed(4, A, 'image', null, '2026-07-15T12:00:00Z');
  await updateMedia(db, 1, 4, {
    mediaPath: '2026/07/4-placeholder.jpg',
    mediaMime: 'image/jpeg',
    mediaSize: 20480,
  });
  await seed(5, A, 'file', null, '2026-07-13T08:00:00Z');
  await recordMediaError(db, 1, 5, 'XFTP relay AUTH error (seeded example)');
  // Alice consented on 2026-07-10; this predates it, so it stays unpublished
  // (forward-only) — exercises the "sent before opt-in" reason.
  await seed(
    6,
    A,
    'text',
    'Posted before Alice opted in — stays unpublished.',
    '2026-07-08T09:00:00Z',
  );

  // A bot profile, so the Personality page (CCB-S4-029) has dials to render rather than
  // its empty state. Placeholder character, off-centre dials, so the preview shows what
  // a configured bot looks like instead of four identical sliders at 5.
  const previewBotId = await createBotOnboardingProfile(
    db,
    {
      slug: 'cinderella',
      displayName: 'CIND3R3LLA',
      enabled: true,
      selectedForRuntime: true,
      createAddress: true,
      updateAddress: true,
      updateProfile: true,
      autoAcceptContacts: true,
      welcomeMessage: '',
      businessAddress: false,
      allowFiles: true,
      commandRegistryMode: 'cinderella_defaults',
      customCommands: [],
      useBotProfile: true,
      logContacts: true,
      logNetwork: false,
      groupInvitationMode: 'manual',
      expectedGroupRole: 'admin',
      roleVerificationRequired: true,
      policyActivationMode: 'manual',
      remoteCommandsEnabled: false,
      persistentChangesEnabled: false,
      contactRequestRetentionHours: 168,
      groupInvitationRetentionHours: 168,
      maxPendingContactRequests: 100,
      personality: { ...DEFAULT_PERSONALITY },
    },
    'admin-preview',
  );
  await updateBotPersonality(
    db,
    previewBotId,
    {
      baseCharacter:
        'A neon courier who lives in the wire, reads a room in one packet, and has never ' +
        'once been impressed by a cheap line.',
      // Passed explicitly, and it has to be (CCB-S4-034). `createBotOnboardingProfile`
      // above lets migration 031's column default seed the origin, and this call writes
      // every personality field, so leaving it out here would clear the history the row
      // was just created with and the Personality page would preview an empty field.
      origin: DEFAULT_ORIGIN,
      sharpness: 8,
      warmth: 4,
      humor: 7,
      permissiveness: 6,
    },
    'admin-preview',
  );

  const adminCfg: AdminConfig = {
    adminPort: PORT,
    adminUsername: 'operator',
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'preview-session-secret-0123456789abcdef0123456789',
    publicOrigin: 'https://cinderella.example.org',
    rpId: 'cinderella.example.org',
    webauthnOrigin: 'https://cinderella.example.org',
    rpName: 'Cinderella Admin',
  };
  const cfg: Config = {
    botDisplayName: 'Cinderella',
    simplexDbPrefix: './state/simplex/cinderella',
    simplexFilesFolder: './state/files',
    groupName: 'cinderella-test',
    mediaRoot: process.cwd(),
    // Operator assets (CCB-S4-047), so the Recital page can actually take an image.
    assetRoot: resolve('./state/preview-assets'),
    // Seeded so the Backups page has a real run record to render (CCB-S4-014/015).
    backupStatusPath: process.env['BACKUP_STATUS_PATH'] ?? './state/backup-status.json',
    backupRequestPath: process.env['BACKUP_REQUEST_PATH'] ?? './state/backup-request',
    backupProgressPath: process.env['BACKUP_PROGRESS_PATH'] ?? './state/backup-progress.json',
    avatarPath: '',
    databaseUrl: 'postgres://cinderella:placeholder@127.0.0.1:5432/cinderella',
    logLevel: 'info',
  };
  const settings = await SettingsService.load(db, cfg.logLevel);
  const security = await SecurityService.load(db);

  // A search service with some history on it, so the Web Search page's diagnostics card can
  // be looked at in its POPULATED state rather than only in its "nothing is running" state
  // (CCB-S4-042). Nothing here reaches a network: the service is never asked to search.
  const previewSearch = new WebSearchService({
    settings: () => WEB_SEARCH_DEFAULTS,
  });
  previewSearch.noteRefusedBeforeSearch('sexual-explicit');
  previewSearch.noteRefusedBeforeSearch('darknet');
  setWebSearchService(previewSearch);

  // The registry, so the Book of Elii previews a real prompt and the Memory page can measure
  // one (CCB-S4-044). Without it both pages render their honest "nothing loaded" branch,
  // which is correct but is not what an operator is looking at the preview to see.
  setPromptRuleService(await PromptRuleService.load(db));

  registerNav();
  const app = buildServer({
    db,
    adminCfg,
    mediaRoot: cfg.mediaRoot,
    settings,
    security,
    cfg,
    registerViews: registerAdminViews,
  });
  await app.listen({ host: '127.0.0.1', port: PORT });
  console.log(`Admin preview: http://127.0.0.1:${PORT}  (operator / ${PASSWORD})`);
}

main().catch((err: unknown) => {
  console.error('admin-preview crashed:', err);
  process.exit(1);
});
