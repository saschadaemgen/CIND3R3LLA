/**
 * Offline verification for persistent SimpleX bot onboarding settings.
 *
 * No SimpleX core is started and no production database is used.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import type { AdminConfig, Config } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  listGroupInvitations,
  recordGroupJoinConfirmed,
  recordIncomingGroupInvitation,
  recordJoinedGroup,
} from '../src/profiles/group-invitations.js';
import {
  listContactRequests,
  recordAcceptedContactRequest,
  recordContactConnected,
  recordIncomingContactRequest,
  recordRejectedContactRequest,
} from '../src/profiles/contact-requests.js';
import {
  createBotOnboardingProfile,
  recordContactAddress,
  deleteBotOnboardingProfile,
  listBotOnboardingProfiles,
  resetBotOnboardingWorkflow,
  updateBotOnboardingProfile,
  type BotOnboardingInput,
} from '../src/profiles/bot-onboarding.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

function cookieOf(setCookie: string | string[] | undefined, name: string): string | null {
  const values = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];

  for (const value of values) {
    if (value.startsWith(`${name}=`)) return value.split(';')[0] ?? null;
  }

  return null;
}

const PASSWORD = 'correct-horse-battery-staple';
const SESSION_SECRET = 'b'.repeat(48);

function defaults(): BotOnboardingInput {
  return {
    slug: 'cinderella',
    displayName: 'Cinderella',
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
    // CCB-S4-029. The personality lives on this record too, but the wizard's own save
    // path does not write it; `verify:personality` owns that half.
    personality: { ...DEFAULT_PERSONALITY },
  };
}

async function main(): Promise<void> {
  process.env['SESSION_SECRET'] ??= SESSION_SECRET;

  const pg = new PGlite();
  const db: Queryable = {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  };

  for (const migration of await loadMigrationFiles()) {
    await pg.exec(migration.sql);
  }

  console.log('\n1. Persist every supported bot option');
  const id = await createBotOnboardingProfile(db, defaults(), 'verify-bot-onboarding');
  let profiles = await listBotOnboardingProfiles(db);
  let profile = profiles[0];

  check('profile is persisted', profile?.id === id);
  check('automatic contact acceptance is the default', profile?.autoAcceptContacts === true);
  check('manual group invitations are the default', profile?.groupInvitationMode === 'manual');
  check('Admin is the default expected role', profile?.expectedGroupRole === 'admin');
  check('remote commands are blocked by default', profile?.remoteCommandsEnabled === false);
  check('persistent changes are blocked by default', profile?.persistentChangesEnabled === false);
  check(
    'all SDK BotOptions are persisted',
    Boolean(
      profile?.createAddress &&
      profile.updateAddress &&
      profile.updateProfile &&
      profile.allowFiles &&
      profile.useBotProfile &&
      profile.logContacts &&
      profile.commandRegistryMode === 'cinderella_defaults',
    ),
  );

  console.log('\n2. Store manual and advanced alternatives');
  await updateBotOnboardingProfile(
    db,
    id,
    {
      ...defaults(),
      autoAcceptContacts: false,
      businessAddress: true,
      logNetwork: true,
      commandRegistryMode: 'custom',
      customCommands: [{ command: '/status', help: 'Show status' }],
      groupInvitationMode: 'approved_contacts',
      expectedGroupRole: 'moderator',
      policyActivationMode: 'automatic_after_verification',
      remoteCommandsEnabled: true,
      persistentChangesEnabled: true,
      contactRequestRetentionHours: 72,
      groupInvitationRetentionHours: 96,
      maxPendingContactRequests: 250,
    },
    'verify-bot-onboarding',
  );

  profiles = await listBotOnboardingProfiles(db);
  profile = profiles[0];

  check('manual contact approval can be selected', profile?.autoAcceptContacts === false);
  check(
    'approved contact invitation mode is persisted',
    profile?.groupInvitationMode === 'approved_contacts',
  );
  check('Moderator can be selected', profile?.expectedGroupRole === 'moderator');
  check('custom command registry is persisted', profile?.customCommands.length === 1);
  check(
    'future safety switches are persisted',
    Boolean(profile?.remoteCommandsEnabled && profile.persistentChangesEnabled),
  );

  console.log('\n3. Validate all SDK roles');
  for (const role of [
    'relay',
    'observer',
    'author',
    'member',
    'moderator',
    'admin',
    'owner',
  ] as const) {
    await updateBotOnboardingProfile(
      db,
      id,
      { ...defaults(), expectedGroupRole: role },
      'verify-bot-onboarding',
    );
    const current = (await listBotOnboardingProfiles(db))[0];
    check(`role ${role} is accepted`, current?.expectedGroupRole === role);
  }

  let invalidRoleRefused = false;
  try {
    await updateBotOnboardingProfile(
      db,
      id,
      { ...defaults(), expectedGroupRole: 'invalid' as never },
      'verify-bot-onboarding',
    );
  } catch {
    invalidRoleRefused = true;
  }
  check('unknown SDK role is refused', invalidRoleRefused);

  console.log('\n4. Workflow reset and safe deletion');
  await db.query(
    `UPDATE cinderella_bot_profiles SET workflow_state = 'role_verified' WHERE id = $1`,
    [id],
  );
  await resetBotOnboardingWorkflow(db, id, 'verify-bot-onboarding');
  check(
    'workflow reset returns to configured',
    (await listBotOnboardingProfiles(db))[0]?.workflowState === 'configured',
  );

  const secondId = await createBotOnboardingProfile(
    db,
    {
      ...defaults(),
      slug: 'cinderella-lab',
      displayName: 'Cinderella Lab',
      // Its own, because two bots cannot share one since CCB-S5-009.
      wakeWord: 'Cinderella Lab',
    },
    'verify-bot-onboarding',
  );
  await deleteBotOnboardingProfile(db, secondId, 'verify-bot-onboarding');
  check('stored profile can be deleted', (await listBotOnboardingProfiles(db)).length === 1);

  console.log('\n5. Real admin surface');
  const adminCfg: AdminConfig = {
    adminPort: 0,
    adminUsername: 'operator',
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: SESSION_SECRET,
    publicOrigin: 'https://cinderella.example.org',
    rpId: 'cinderella.example.org',
    webauthnOrigin: 'https://cinderella.example.org',
    rpName: 'Cinderella Admin',
  };

  const cfg: Config = {
    botDisplayName: 'Cinderella',
    simplexDbPrefix: '/var/lib/cinderella/simplex/cinderella',
    simplexFilesFolder: '/var/lib/cinderella/files',
    groupName: '',
    mediaRoot: process.cwd(),
    avatarPath: '',
    databaseUrl: 'postgres://cinderella:test@127.0.0.1:5432/cinderella',
    logLevel: 'info',
  };

  const settings = await SettingsService.load(db, cfg.logLevel);
  const security = await SecurityService.load(db);
  registerNav();

  const app = buildServer({
    db,
    adminCfg,
    cfg,
    settings,
    security,
    mediaRoot: cfg.mediaRoot,
    registerViews: registerAdminViews,
  });

  await app.ready();

  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const token = /name="_csrf" value="([a-f0-9]{64})"/.exec(loginPage.body)?.[1] ?? '';
  const loginCookie = cookieOf(loginPage.headers['set-cookie'], 'cinderella_login_csrf') ?? '';

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { username: 'operator', password: PASSWORD, _csrf: token },
    headers: { cookie: loginCookie },
  });

  const session = cookieOf(login.headers['set-cookie'], 'cinderella_session') ?? '';
  const page = await app.inject({
    method: 'GET',
    url: '/ai/onboarding',
    headers: { cookie: session },
  });

  check('setup page renders', page.statusCode === 200);
  check('navigation exposes AI Bot Setup', page.body.includes('AI Bot Setup'));
  check('primary action is visible', page.body.includes('Create AI Bot'));
  check('compact list is visible', page.body.includes('setup-list-item'));
  check('selected detail is visible', page.body.includes('Selected AI Bot'));
  const renderedDialogs = (page.body.match(/data-setup-dialog/g) ?? []).length;
  const renderedSteps = (page.body.match(/data-setup-step="/g) ?? []).length;
  check(
    'each rendered assistant has five steps',
    renderedDialogs > 0 && renderedSteps === renderedDialogs * 5,
  );
  check(
    'automatic contact setting is visible inside assistant',
    page.body.includes('Accept contact requests automatically'),
  );
  check(
    'manual and automatic invitation modes are available',
    Boolean(
      page.body.includes('Automatic for approved contacts') &&
      page.body.includes('Automatic for approved groups'),
    ),
  );
  check(
    'all SDK roles remain available',
    Boolean(
      page.body.includes('Relay') &&
      page.body.includes('Observer') &&
      page.body.includes('Author') &&
      page.body.includes('Member') &&
      page.body.includes('Moderator') &&
      page.body.includes('Admin') &&
      page.body.includes('Owner'),
    ),
  );
  check(
    'capability reference remains available',
    Boolean(
      page.body.includes('apiAcceptContactRequest') &&
      page.body.includes('receivedGroupInvitation') &&
      page.body.includes('apiListMembers'),
    ),
  );
  // CCB-S4-022: the boundary moved, so the claim moved with it. One of the four SDK
  // actions is wired; the badge says which, and the old "no SDK actions" copy would now
  // be false. Checked here so the copy and the capability cannot drift apart again.
  check(
    'the runtime boundary states how many SDK actions are wired',
    page.body.includes('1 of 4 SDK actions wired: create address'),
  );
  check(
    'the address SDK calls are named in the capability inventory',
    page.body.includes('apiCreateUserAddress') && page.body.includes('apiGetUserAddress'),
  );
  check('wizard client is loaded', page.body.includes('/assets/admin-setup-wizard.js'));

  /* ================================================ 6. The create-address step */
  //
  // CCB-S4-022. The wizard described this step for a season with nothing behind it, so
  // what is checked here is the CONTROL and the ORDER: a button that exists, a state
  // that moves only with a link in hand, and no path that stores an intention.

  console.log('\n6. The create-address step (CCB-S4-022)');

  const configured = (await listBotOnboardingProfiles(db))[0];
  const targetId = configured?.id ?? 0;
  check('the surviving profile is in the configured state', configured?.workflowState === 'configured');
  check('and has no contact address yet', configured?.contactAddressLink === null);

  check(
    'the create-address control is rendered for a configured runtime bot',
    page.body.includes('name="action" value="create-address"'),
  );
  check(
    'and it is a real button, in the project own button classes',
    page.body.includes('Create the contact address') &&
      page.body.includes('setup-button setup-button-primary'),
  );
  check(
    'the page says the runtime is not running rather than offering a dead button',
    page.body.includes('The SimpleX runtime is not running in this process'),
  );
  check(
    'no address panel is rendered while there is no address',
    !page.body.includes('data-address-panel'),
  );

  // Pressing it with no runtime must NOT advance the state. This is the failure path the
  // briefing names, and it is the one that matters: a wizard that advanced on an
  // intention is exactly how this step came to be described but never performed.
  const pressed = await app.inject({
    method: 'POST',
    url: '/ai/onboarding',
    payload: {
      _csrf: (/name="_csrf" value="([a-f0-9]{64})"/.exec(page.body) ?? [])[1] ?? '',
      action: 'create-address',
      profileId: String(targetId),
    },
    headers: { cookie: session },
  });
  const afterPress = (await listBotOnboardingProfiles(db))[0];
  check(
    'the failed action redirects with an error',
    pressed.statusCode === 302 && String(pressed.headers['location'] ?? '').includes('error='),
    String(pressed.headers['location'] ?? '').slice(0, 90),
  );
  check(
    'and the workflow state did NOT advance',
    afterPress?.workflowState === 'configured',
    afterPress?.workflowState ?? 'missing',
  );
  check('and no address was recorded', afterPress?.contactAddressLink === null);

  // The write path itself, with a link in hand: state and link move together.
  const LINK = 'https://simplex.chat/contact#/?v=2-7&smp=placeholder-not-a-real-address';
  await recordContactAddress(db, targetId, { link: LINK, simplexUserId: 1 }, 'verify');
  const recorded = (await listBotOnboardingProfiles(db))[0];
  check(
    'recording a real link advances to waiting_contact_request',
    recorded?.workflowState === 'waiting_contact_request',
    recorded?.workflowState ?? 'missing',
  );
  check('the link is stored', recorded?.contactAddressLink === LINK);
  check('with the SimpleX user it was created on', recorded?.contactAddressUserId === 1);
  check('and when it was created', recorded?.contactAddressCreatedAt != null);

  let emptyRefused = false;
  try {
    await recordContactAddress(db, targetId, { link: '   ', simplexUserId: 1 }, 'verify');
  } catch {
    emptyRefused = true;
  }
  check('an empty link is refused rather than recorded', emptyRefused);

  let noUserRefused = false;
  try {
    await recordContactAddress(db, targetId, { link: LINK, simplexUserId: 0 }, 'verify');
  } catch {
    noUserRefused = true;
  }
  check('a link with no SimpleX user id is refused', noUserRefused);

  const audited = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cinderella.bot-profile.contact-address'",
  );
  check('the action is audited', Number(audited.rows[0]?.n) === 1);
  const auditedLink = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_log WHERE details::text LIKE '%simplex.chat/contact%'",
  );
  check(
    'and the link itself is NOT copied into the audit log',
    Number(auditedLink.rows[0]?.n) === 0,
  );

  const withAddress = await app.inject({
    method: 'GET',
    url: '/ai/onboarding',
    headers: { cookie: session },
  });
  check('the page now renders the address panel', withAddress.body.includes('data-address-panel'));
  // Checked against the RENDERED form, not the raw string: the template escapes, which
  // is correct, so asserting the literal would be asserting a defect (D-111).
  check(
    'with the link itself, HTML-escaped as it must be',
    withAddress.body.includes('placeholder-not-a-real-address') &&
      withAddress.body.includes('&amp;smp='),
  );
  check(
    'and says what it is waiting for',
    withAddress.body.includes('waiting for a contact request'),
  );
  check(
    'and no longer claims that accepting is unbuilt, which it stopped being in CCB-S4-023',
    withAddress.body.includes('The request') &&
      withAddress.body.includes('appears below for you to accept') &&
      !withAddress.body.includes('accepting it is the next step and is not built yet'),
  );
  check(
    'the create-address control is gone once the address exists',
    !withAddress.body.includes('name="action" value="create-address"'),
  );

  // A reset must take the link with it, or the page shows step one as not done while
  // still displaying its result.
  await resetBotOnboardingWorkflow(db, targetId, 'verify');
  const afterReset = (await listBotOnboardingProfiles(db))[0];
  check('a workflow reset clears the address too', afterReset?.contactAddressLink === null);
  check('and returns to configured', afterReset?.workflowState === 'configured');

  /* ============================================ 7. Accepting the contact request */
  //
  // CCB-S4-023, step two. The state moves on an EVENT and on a RESULT, never on a click
  // alone, so what is checked is that each transition has a real cause behind it.

  console.log('\n7. Accepting the contact request (CCB-S4-023)');

  // Put the bot back where step one leaves it.
  await recordContactAddress(db, targetId, { link: LINK, simplexUserId: 1 }, 'verify');

  const REQ = 4242;
  await recordIncomingContactRequest(db, targetId, {
    contactRequestId: REQ,
    simplexUserId: 1,
    requesterName: 'Operator Phone',
  });
  const pendingProfile = (await listBotOnboardingProfiles(db))[0];
  check(
    'an arriving request moves the workflow to contact_request_pending',
    pendingProfile?.workflowState === 'contact_request_pending',
    pendingProfile?.workflowState ?? 'missing',
  );
  const pendingRows = await listContactRequests(db, targetId);
  check('and is recorded with the core own request id', pendingRows[0]?.contactRequestId === REQ);
  check('with the requester named', pendingRows[0]?.requesterName === 'Operator Phone');
  check('and with the SimpleX user it arrived on', pendingRows[0]?.simplexUserId === 1);

  // The same request again (a reconnect, a restart) must not become a second row.
  const again = await recordIncomingContactRequest(db, targetId, {
    contactRequestId: REQ,
    simplexUserId: 1,
    requesterName: 'Operator Phone',
  });
  check('the same request arriving twice is not duplicated', again.recorded === false);
  check('and there is still exactly one row', (await listContactRequests(db, targetId)).length === 1);

  const pendingPage = await app.inject({
    method: 'GET',
    url: '/ai/onboarding',
    headers: { cookie: session },
  });
  check('the page shows the pending request', pendingPage.body.includes('data-request-panel'));
  check('naming who it is from', pendingPage.body.includes('Operator Phone'));
  check(
    'with an accept and a reject control',
    pendingPage.body.includes('name="action" value="accept-contact"') &&
      pendingPage.body.includes('name="action" value="reject-contact"'),
  );
  check(
    'and it says accepting connects a contact and nothing more',
    pendingPage.body.includes('it does not put the bot in any group'),
  );
  check(
    'the address panel is still there from step one',
    pendingPage.body.includes('data-address-panel'),
  );

  // Pressing accept with no runtime must leave everything exactly as it was.
  const failedAccept = await app.inject({
    method: 'POST',
    url: '/ai/onboarding',
    payload: {
      _csrf: (/name="_csrf" value="([a-f0-9]{64})"/.exec(pendingPage.body) ?? [])[1] ?? '',
      action: 'accept-contact',
      profileId: String(targetId),
      contactRequestId: String(REQ),
    },
    headers: { cookie: session },
  });
  check(
    'an accept with no runtime redirects with an error',
    failedAccept.statusCode === 302 &&
      String(failedAccept.headers['location'] ?? '').includes('error='),
  );
  check(
    'and the request is STILL pending',
    (await listContactRequests(db, targetId))[0]?.state === 'pending',
  );
  check(
    'and the workflow did not advance',
    (await listBotOnboardingProfiles(db))[0]?.workflowState === 'contact_request_pending',
  );

  // The write path, with a contact in hand.
  await recordAcceptedContactRequest(
    db,
    targetId,
    REQ,
    { contactId: 77, contactName: 'Operator Phone' },
    'verify',
  );
  const accepted = (await listContactRequests(db, targetId))[0];
  check('recording an acceptance marks the row accepted', accepted?.state === 'accepted');
  check('with the contact the core created', accepted?.contactId === 77);
  check(
    'and the workflow reaches contact_connected',
    (await listBotOnboardingProfiles(db))[0]?.workflowState === 'contact_connected',
  );
  check('but NOT yet connected, which is a later fact', accepted?.connectedAt === null);

  const stamped = await recordContactConnected(db, 1, 77);
  check('the contactConnected event stamps the row', stamped);
  check(
    'and the page then says connected rather than connecting',
    (await listContactRequests(db, targetId))[0]?.connectedAt !== null,
  );

  let doubleAccept = false;
  try {
    await recordAcceptedContactRequest(db, targetId, REQ, { contactId: 78, contactName: 'x' }, 'v');
  } catch {
    doubleAccept = true;
  }
  check('accepting the same request twice is refused', doubleAccept);

  let noContact = false;
  try {
    await recordAcceptedContactRequest(db, targetId, 999, { contactId: 0, contactName: 'x' }, 'v');
  } catch {
    noContact = true;
  }
  check('an acceptance without a contact id is refused', noContact);

  const connectedPage = await app.inject({
    method: 'GET',
    url: '/ai/onboarding',
    headers: { cookie: session },
  });
  check(
    'the connected page offers no accept control any more',
    !connectedPage.body.includes('name="action" value="accept-contact"'),
  );
  check(
    'and says the group step is not built yet rather than promising it',
    connectedPage.body.includes('is not built yet'),
  );

  // Rejection: a second request, refused, puts the workflow back to waiting.
  await recordIncomingContactRequest(db, targetId, {
    contactRequestId: 4243,
    simplexUserId: 1,
    requesterName: 'Someone Else',
  });
  check(
    'a request arriving after connection does not drag the workflow backwards',
    (await listBotOnboardingProfiles(db))[0]?.workflowState === 'contact_connected',
  );
  await recordRejectedContactRequest(db, targetId, 4243, 'verify');
  const rejected = (await listContactRequests(db, targetId)).find((r) => r.contactRequestId === 4243);
  check('a rejected request is marked rejected', rejected?.state === 'rejected');
  check('and establishes no contact', rejected?.contactId === null);

  const acceptAudit = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cinderella.bot-profile.contact-accepted'",
  );
  const rejectAudit = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cinderella.bot-profile.contact-rejected'",
  );
  check('acceptance is audited', Number(acceptAudit.rows[0]?.n) === 1);
  check('and so is rejection', Number(rejectAudit.rows[0]?.n) === 1);

  /* ================================================== 8. Joining the group */
  //
  // CCB-S4-025, step three. Same two causes as step two: the state moves because an
  // invitation ARRIVED and again because a join RETURNED a membership. What is extra
  // here is the role, which is three different facts the page must not conflate.

  console.log('\n8. Joining the group (CCB-S4-025)');

  // Prose spans template line breaks, so a literal match asserts the indentation rather
  // than the sentence. Collapse before matching; structural assertions stay literal.
  const flat = (body: string): string => body.replace(/\s+/g, ' ');

  const GROUP = 8801;
  await recordIncomingGroupInvitation(db, targetId, {
    groupId: GROUP,
    simplexUserId: 1,
    groupName: 'The Archive Group',
    inviterName: 'Operator Phone',
    invitedAsRole: 'admin',
  });
  const invited = (await listBotOnboardingProfiles(db))[0];
  check(
    'an arriving invitation moves the workflow to group_invitation_pending',
    invited?.workflowState === 'group_invitation_pending',
    invited?.workflowState ?? 'missing',
  );
  const invRows = await listGroupInvitations(db, targetId);
  check('and is recorded with the core own group id', invRows[0]?.groupId === GROUP);
  check('naming the group and the inviter', invRows[0]?.groupName === 'The Archive Group' &&
    invRows[0]?.inviterName === 'Operator Phone');
  check('and the role the invitation OFFERED', invRows[0]?.invitedAsRole === 'admin');
  check('but nothing about the role held yet', invRows[0]?.joinedRole === null);

  const dupInv = await recordIncomingGroupInvitation(db, targetId, {
    groupId: GROUP,
    simplexUserId: 1,
    groupName: 'The Archive Group',
    inviterName: 'Operator Phone',
    invitedAsRole: 'admin',
  });
  check('the same invitation twice is not duplicated', dupInv.recorded === false);
  check('and there is still one row', (await listGroupInvitations(db, targetId)).length === 1);

  const invitationPage = await app.inject({
    method: 'GET',
    url: '/ai/onboarding',
    headers: { cookie: session },
  });
  check('the page shows the pending invitation', invitationPage.body.includes('data-invitation-panel'));
  check('naming the group', invitationPage.body.includes('The Archive Group'));
  check(
    'with a join control',
    invitationPage.body.includes('name="action" value="join-group"') &&
      invitationPage.body.includes('Join the group'),
  );
  check(
    'and it says joining grants no role beyond the invitation',
    // The apostrophe is NOT escaped by the template helper: it escapes &, < and >, and
    // leaves ' alone. Asserted as it actually renders (D-111).
    flat(invitationPage.body).includes(
      "It does not change anyone's role and it does not switch any capture or policy on.",
    ),
  );

  // A join with no runtime must leave everything exactly as it was.
  const failedJoin = await app.inject({
    method: 'POST',
    url: '/ai/onboarding',
    payload: {
      _csrf: (/name="_csrf" value="([a-f0-9]{64})"/.exec(invitationPage.body) ?? [])[1] ?? '',
      action: 'join-group',
      profileId: String(targetId),
      groupId: String(GROUP),
    },
    headers: { cookie: session },
  });
  check(
    'a join with no runtime redirects with an error',
    failedJoin.statusCode === 302 &&
      String(failedJoin.headers['location'] ?? '').includes('error='),
  );
  check(
    'and the invitation is STILL pending',
    (await listGroupInvitations(db, targetId))[0]?.state === 'pending',
  );
  check(
    'and the workflow did not advance',
    (await listBotOnboardingProfiles(db))[0]?.workflowState === 'group_invitation_pending',
  );

  // The write path, with a membership role in hand. Deliberately NOT the expected role,
  // so the page has to tell the truth about the difference.
  await recordJoinedGroup(db, targetId, GROUP, { role: 'member' }, 'verify');
  const joinedRow = (await listGroupInvitations(db, targetId))[0];
  check('recording a join marks the row joined', joinedRow?.state === 'joined');
  check('with the role the CORE reported, not the one offered', joinedRow?.joinedRole === 'member');
  check('the offered role is still recorded separately', joinedRow?.invitedAsRole === 'admin');
  check(
    'and the workflow reaches joined',
    (await listBotOnboardingProfiles(db))[0]?.workflowState === 'joined',
  );
  check('but the membership is not confirmed live yet', joinedRow?.joinedAt === null);

  const confirmed = await recordGroupJoinConfirmed(db, 1, GROUP, 'member');
  check('the userJoinedGroup event stamps the membership live', confirmed);

  let roleless = false;
  try {
    await recordJoinedGroup(db, targetId, 9999, { role: '  ' }, 'verify');
  } catch {
    roleless = true;
  }
  check('a join with no role is refused rather than recorded', roleless);

  const joinedPage = await app.inject({
    method: 'GET',
    url: '/ai/onboarding',
    headers: { cookie: session },
  });
  check(
    'the joined page reports the role actually held',
    joinedPage.body.includes('joined as <strong>member</strong>'),
  );
  const expectedRole = (await listBotOnboardingProfiles(db))[0]?.expectedGroupRole ?? '';
  check(
    'and says plainly that it is NOT the expected role',
    expectedRole !== 'member' &&
      flat(joinedPage.body).includes(`is not the <strong>${expectedRole}</strong> role you expect`),
    `expected ${expectedRole}, held member`,
  );
  check(
    'and that the role is not verified either way, because that is step four',
    joinedPage.body.includes('not verified'),
  );
  check(
    'the join control is gone once the group is joined',
    !joinedPage.body.includes('name="action" value="join-group"'),
  );

  // The one link no runtime-free test can exercise: the view passing the role the SDK
  // reported into the record. Without a live core the POST cannot reach its success
  // path, so this is asserted at the source, deliberately and with the reason stated.
  // Passing the expected or the offered role here would be the exact conflation step
  // four must not inherit, and nothing else would notice.
  const viewSource = readFileSync(join('src', 'web', 'views', 'ai-onboarding.ts'), 'utf8');
  check(
    'the join records the role the CORE returned, not a literal or the expected role',
    /recordJoinedGroup\(\s*ctx\.db,\s*profileId,\s*groupId,\s*\{\s*role:\s*joined\.role\s*\}/.test(
      viewSource,
    ),
  );

  const joinAudit = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cinderella.bot-profile.group-joined'",
  );
  check('the join is audited', Number(joinAudit.rows[0]?.n) === 1);
  const auditSaysUnverified = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cinderella.bot-profile.group-joined' AND details->>'roleVerified' = 'false'",
  );
  check('and records that the role is NOT verified', Number(auditSaysUnverified.rows[0]?.n) === 1);

  await app.close();
  await pg.close();

  console.log(`\nFailures: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
