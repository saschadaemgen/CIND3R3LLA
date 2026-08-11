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
import { vector } from '@electric-sql/pglite-pgvector';
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
import { setOverrideRecorded } from '../src/db/prompt-rule-overrides.js';
import { WEB_SEARCH_DEFAULTS } from '../src/plugins/web-search/settings.js';
import { PluginService } from '../src/plugins/service.js';
import { WEB_SEARCH_ID } from '../src/plugins/web-search/plugin.js';
import { KNOWLEDGE_BASE_ID } from '../src/plugins/knowledge-base/plugin.js';
import {
  KnowledgeService,
  checksumOf,
  setKnowledgeService,
  singleConnectionTransaction,
} from '../src/knowledge/service.js';
import { Embedder, EMBEDDING_DIMENSIONS } from '../src/knowledge/embed.js';
import { setGrant, upsertDocument } from '../src/db/knowledge.js';
import { SecurityService } from '../src/security/settings.js';
import { startQueue } from '../src/queue/index.js';
import type { Queryable } from '../src/db/pool.js';
import type { AdminConfig, Config } from '../src/config.js';

// `PORT` as well as `PREVIEW_PORT`, so a launcher that assigns a free port can hand one
// over when 8788 is already taken by an older preview.
const PORT = Number(process.env['PREVIEW_PORT'] ?? process.env['PORT']) || 8788;
const PASSWORD = 'preview-password';

async function main(): Promise<void> {
  const pg = new PGlite({ extensions: { vector } });
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
      // Asked for at creation since CCB-S5-009. This said "takes the shared default ... and
      // writes no override", which stopped being true at CCB-S5-030: the baseline is now what
      // the DISPLAY NAME derives, not the shared value, and `Cinderella` is not `CIND3R3LLA`,
      // so this bot DOES get a row and the console shows it as set by hand. That is useful
      // here and is left deliberately: with `SupportDesk` below following its own name, the
      // preview seeds one bot in each of the two states.
      wakeWord: 'Cinderella',
      enabled: true,
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

  // ── A SECOND BOT, SO THE SCOPE OF A LAW IS VISIBLE (CCB-S5-001) ─────────
  //
  // With one bot every law reads "shared: 1 bot" and the whole distinction the briefing
  // asks to be recognisable is invisible on the page. Two bots with opposite dials, and
  // one law set for one of them, is the smallest fixture that shows it.
  const supportBotId = await createBotOnboardingProfile(
    db,
    {
      slug: 'support-desk',
      displayName: 'SupportDesk',
      wakeWord: 'SupportDesk',
      enabled: true,
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
    supportBotId,
    {
      baseCharacter:
        'Patient, unhurried, and entirely uninterested in being clever. Answers the question ' +
        'that was asked and then stops.',
      origin: DEFAULT_ORIGIN,
      sharpness: 2,
      warmth: 9,
      humor: 2,
      permissiveness: 3,
    },
    'admin-preview',
  );

  // One standard law switched off for the support bot, so the Book shows a real
  // deviation rather than an empty per-bot section.
  {
    const { rows } = await db.query<{ id: string; rule_text: string; enabled: boolean; ord: number; nameable: boolean }>(
      `SELECT id, rule_text, enabled, ord, nameable
         FROM cinderella_prompt_rules
        WHERE tier = 'standard' AND enabled = TRUE
        ORDER BY ord LIMIT 1`,
    );
    const target = rows[0];
    if (target) {
      await setOverrideRecorded(
        db,
        {
          botProfileId: supportBotId,
          ruleId: target.id,
          enabled: false,
          text: null,
          sharedText: target.rule_text,
          sharedEnabled: target.enabled,
          sharedOrd: Number(target.ord),
          sharedNameable: target.nameable,
        },
        'admin-preview',
      );
    }
  }



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
    settings: () => ({ ...WEB_SEARCH_DEFAULTS, apiKey: 'preview' }),
    // A provider and a scorer, so the RELEVANCE card can be looked at populated too
    // (CCB-S5-028). Both are local: nothing here reaches a network, and the scores are
    // manufactured rather than embedded, so the preview needs no model running.
    provider: {
      name: 'preview',
      label: 'Preview',
      capabilities: { requiresKey: false, keyUrl: '', note: '' },
      isConfigured: () => true,
      search: () =>
        Promise.resolve([
          {
            title: 'Protocol Amendments | Research Compliance Services',
            snippet: 'A protocol amendment is required whenever you change an approved study.',
            url: 'https://example.edu/protocol-amendments',
          },
        ]),
    },
    embed: {
      embedQuery: () => Promise.resolve([1, 0]),
      // 0.58: the score the real embedder gives the page that caused CCB-S5-028, which is
      // below the 0.70 floor. So the preview's card shows a search refused for irrelevance,
      // which is the state an operator most needs to recognise.
      embedDocuments: (texts) =>
        Promise.resolve(texts.map(() => [0.58, Math.sqrt(1 - 0.58 * 0.58)])),
    },
  });
  previewSearch.noteRefusedBeforeSearch('sexual-explicit');
  previewSearch.noteRefusedBeforeSearch('darknet');
  await previewSearch.search('which is correct for SimpleGo', {
    groupId: 1,
    memberId: 'preview-member',
  });
  setWebSearchService(previewSearch);

  // The registry, so the Book of Elii previews a real prompt and the Memory page can measure
  // one (CCB-S4-044). Without it both pages render their honest "nothing loaded" branch,
  // which is correct but is not what an operator is looking at the preview to see.
  setPromptRuleService(await PromptRuleService.load(db));

  registerNav();
  // ── TWO BOTS WITH DIFFERENT CAPABILITIES (CCB-S5-021) ────────────────────
  //
  // With every plugin in one deployment-wide state the Plugins page shows the same thing
  // for both bots, and the whole distinction the briefing asks to be visible is invisible.
  // Web search on for the deployment and OFF for SupportDesk is the smallest fixture that
  // shows all three states at once: on-and-inheriting, off-and-its-own, and the
  // deployment default they are read against.
  const plugins = await PluginService.load(db);
  await plugins.setEnabled(WEB_SEARCH_ID, true, 'admin-preview');
  await plugins.setEnabledForBot(supportBotId, WEB_SEARCH_ID, false, 'admin-preview');

  // ── A KNOWLEDGE BASE WITH SOMETHING IN IT (CCB-S5-022/023) ──────────────
  //
  // Two documents, one granted to the primary and one to neither, so the page shows the
  // three grant states and the diagnostics page has something to score. Ingested with the
  // REAL chunker and a deterministic stand-in embedder, so the preview needs no Ollama and
  // the chunk counts on the page are the counts the real chunker produces.
  await plugins.setEnabled(KNOWLEDGE_BASE_ID, true, 'admin-preview');
  const previewEmbed = (text: string): number[] => {
    const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let h = 0;
      for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
      v[h % EMBEDDING_DIMENSIONS] = (v[h % EMBEDDING_DIMENSIONS] ?? 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
    return v.map((x) => x / norm);
  };
  const knowledge = new KnowledgeService({
    db,
    embedder: new Embedder({
      config: { baseUrl: 'http://127.0.0.1:11434', timeoutMs: 1000 },
      embedImpl: (inputs) => Promise.resolve(inputs.map((t) => previewEmbed(t))),
    }),
    settings: () => plugins.getKnowledge(),
    transaction: singleConnectionTransaction(db),
  });
  setKnowledgeService(knowledge);
  const KB_DOCS: [string, string][] = [
    [
      'The Active User Scheduler',
      [
        '# The Active User Scheduler',
        '',
        'Every SimpleX command issued by any hosted bot goes through the ActiveUserScheduler.',
        'It serializes them, because the core has one active user at a time.',
        '',
        '## An explicit user id is not an exemption',
        '',
        'apiListGroups takes a user id and the core CHECKS it against the active user,',
        'refusing with differentActiveUser when they differ. Naming a user makes a command',
        'refusable, not unmisroutable.',
      ].join(String.fromCharCode(10)),
    ],
    [
      'Media at rest',
      [
        '# Media at rest',
        '',
        'Originals are encrypted with AES-256-GCM under a dedicated MEDIA_SECRET.',
        'Rotating that secret destroys the archive: there is no key history.',
      ].join(String.fromCharCode(10)),
    ],
  ];
  for (const [title, text] of KB_DOCS) {
    const stored = await upsertDocument(db, {
      title,
      sourceName: `${title.toLowerCase().replace(/[^a-z]+/g, '-')}.md`,
      contentType: 'text/markdown',
      body: text,
      checksum: checksumOf(text),
    });
    await knowledge.ingest(stored.id);
    // Only the FIRST document is granted, and only to the primary: the page has to show
    // "given", "not given" and the per-bot difference at once.
    if (title.startsWith('The Active')) await setGrant(db, stored.id, previewBotId, true);
  }

  // ── THE PREVIEW STARTS COLD (CCB-S5-024, D-178) ──────────────────────────
  //
  // Seeding runs in the same process that then serves, so every per-bot cache is WARM by the
  // time the first request arrives: the seed wrote through the services, and the services
  // remember. Production is the opposite. It boots, and the first request an operator makes
  // is the first read of everything.
  //
  // That difference shipped a defect: the Interaction page rendered SHARED values under a
  // bot's name on a cold cache, and the preview could never show it, because in the preview
  // the cache was never cold. So the seeding ends by dropping what it warmed.
  //
  // This does not make the preview equal to production - see D-178 for what it still cannot
  // show - but it removes one whole class of "worked here, failed there" rather than leaving
  // it as a caveat nobody remembers at the moment they are looking at a green page.
  plugins.invalidate();

  // ── THE QUEUE RUNS HERE TOO (CCB-S5-024, D-178) ──────────────────────────
  //
  // Without it an uploaded document sat at `pending` for ever and the preview could show
  // that a document was STORED but never that it was INGESTED, which is most of what the
  // page is about. A preview that stops one step short of the thing being verified is a
  // preview that produces confident, incomplete evidence.
  await startQueue({ db });

  const app = buildServer({
    db,
    adminCfg,
    mediaRoot: cfg.mediaRoot,
    settings,
    security,
    cfg,
    plugins,
    registerViews: registerAdminViews,
  });
  await app.listen({ host: '127.0.0.1', port: PORT });
  console.log(`Admin preview: http://127.0.0.1:${PORT}  (operator / ${PASSWORD})`);
}

main().catch((err: unknown) => {
  console.error('admin-preview crashed:', err);
  process.exit(1);
});
