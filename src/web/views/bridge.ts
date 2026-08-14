/**
 * The Channel Bridge console (CCB-S5-032, D-187).
 *
 * Everything visible and configurable, generously, per the operator's standing
 * rule: the mappings with their cadences, the known channels, the forward log
 * filterable by channel and destination and time, the suppression record, and
 * the diagnostics. The channel filter on the forward log reads the STRUCTURED
 * origin field, which is the proof that field is fit before the website's
 * activity stream depends on it.
 *
 * TWO THINGS ARE DELIBERATELY NOT SETTABLE, and the page says so beside them:
 * the loop refusal (a guarantee, not a preference: a mapping graph that can
 * cycle is a bridge that feeds itself), and the digest's shape (newest in
 * full, up to four older as excerpts, the rest counted: that is the shape of
 * one legible message, not a rhythm, so it is not a dial).
 */

import type { FastifyInstance } from 'fastify';
import type { ViewContext } from '../server.js';
import { html, page, type SafeHtml } from '../html.js';
import { badge, card, factList, fmtDate, pageHeader, scopePanel, type ScopeLine } from './ui.js';
import { listEmbedInstances } from '../../db/embeds.js';
import { captureRoomState } from '../../capture/room-service.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';
import { resolveSelectedBot } from '../selected-bot.js';
import {
  bridgeForwardLog,
  deleteBridgeMapping,
  dismissBridgePost,
  getBridgeMapping,
  insertBridgeMapping,
  listBridgeChannels,
  listBridgeMappings,
  listBridgeSuppressions,
  pendingBridgePosts,
  setBridgeMappingEnabled,
  updateBridgeMappingCadence,
  upsertBridgeChannel,
} from '../../plugins/channel-bridge/store.js';
import {
  countBridgeMessagesWithoutOrigin,
  listChannelPublications,
  setChannelPublication,
  type ChannelPublicationView,
} from '../../plugins/channel-bridge/publication.js';
import { refuseMapping, refusalText } from '../../plugins/channel-bridge/loop.js';
import {
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_MAX_AGE_HOURS,
  DEFAULT_MAX_REPEATS,
  DEFAULT_MESSAGE_COUNT,
  DIGEST_SUMMARY_CAP,
} from '../../plugins/channel-bridge/cadence.js';
import { bridgeDiagnostics, noteBridgeError } from '../../plugins/channel-bridge/bridge-log.js';
import { CHANNEL_BRIDGE_ID } from '../../plugins/channel-bridge/plugin.js';
import {
  applyPluginOverrides,
  describePluginScopes,
  PLUGIN_SETTING_SCOPES,
  type PluginScopeView,
} from '../../plugins/scope.js';
import { isPluginEnabled } from '../../plugins/registry.js';
import { listAllPluginOverrides, listPluginOverridesForBot } from '../../db/plugin-overrides.js';
import {
  connectBotToChannel,
  discoverBotChannels,
  NotAChannelLinkError,
} from '../../bot/runtime/admin-actions.js';
import { describeChatError } from '../../bot/runtime/chat-error.js';
import { log } from '../../log.js';
import { status } from '../status.js';
import { writeAudit } from '../../db/audit.js';

const INPUT_CLS = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';

function bodyString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : '';
}

function bodyInt(body: unknown, key: string): number | null {
  const raw = bodyString(body, key).trim();
  if (raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function labelled(text: string, control: SafeHtml, help?: string): SafeHtml {
  return html`<label class="block">
    <span class="mb-1 block text-sm font-medium text-slate-700">${text}</span>
    ${control}
    ${help ? html`<span class="mt-1 block text-xs text-slate-500">${help}</span>` : ''}
  </label>`;
}

function numberField(name: string, value: string, min: number, max: number): SafeHtml {
  return html`<input
    type="number"
    name="${name}"
    value="${value}"
    min="${String(min)}"
    max="${String(max)}"
    class="${INPUT_CLS}"
  />`;
}

/**
 * WHAT THIS PAGE CHANGES, on the shared surface (CCB-S5-043, D-213).
 *
 * `scopePanel` was lifted out of the Interaction page for this, rather than a second scope
 * surface being invented beside it: the operator has learned to read one shape, and two
 * would drift. The three kinds of control this page carries are named explicitly, because
 * only two of them are plugin settings:
 *
 *   the capability      per bot, from the plugin inventory
 *   the file ceiling    the deployment's, from the same inventory
 *   the mappings        per bot, and NOT a setting at all - they are rows, so the inventory
 *                       cannot carry them (the same note `scope.ts` makes about them)
 *   publication         per CHANNEL, which is neither, and is the one an operator is most
 *                       likely to assume is per bot because everything else here is
 */
function bridgeScopePanel(
  scopes: Map<string, PluginScopeView>,
  bots: readonly { id: number; displayName: string }[],
  selectedBotId: number | null,
  counts: { mappings: number; channelsPublished: number; channelsKnown: number },
): SafeHtml | null {
  const lines: ScopeLine[] = [];
  for (const p of PLUGIN_SETTING_SCOPES) {
    if (p.pluginId !== CHANNEL_BRIDGE_ID) continue;
    const v = scopes.get(`${p.pluginId}:${p.key}`);
    if (!v) continue;
    lines.push({
      key: p.label,
      scope: v.scope,
      deviatingBotIds: v.deviatingBotIds,
      sharedBotCount: v.sharedBotCount,
      reason: v.reason,
    });
  }
  // The two things an operator sets here that are not plugin settings, stated in the same
  // list so the page's answer to "what am I editing" is complete rather than only complete
  // for the settings that happen to live in an inventory.
  lines.push({
    key: 'Mappings and their cadences',
    scope: 'per-bot',
    deviatingBotIds: [],
    sharedBotCount: 0,
    // NOT the derived "per bot: none set": these are rows, so none set means none EXIST,
    // which is a different statement from an override nobody has filled in.
    badge: `per bot: ${String(counts.mappings)} here`,
    reason:
      'Rows rather than settings, so there is no shared value to inherit: a bot with no mapping does not bridge.',
  });
  lines.push({
    key: 'Publish / publish unnamed',
    scope: 'other',
    deviatingBotIds: [],
    sharedBotCount: 0,
    badge: `per channel: ${String(counts.channelsPublished)} of ${String(counts.channelsKnown)} published`,
    reason:
      'Per CHANNEL, not per bot and not deployment-wide. Two bots subscribed to one channel are subscribed to one channel, so switching the bot above changes nothing here.',
  });
  return scopePanel({
    lines,
    bots: [...bots],
    selectedBotId,
    // The sidebar switcher above already chooses the bot for this page; a second row of bot
    // links inside the panel would be two controls for one choice.
    switcherHref: null,
  });
}

/** The iframe snippet for a standalone channel block, offered as the stream's snippet is. */
function channelBlockSnippet(publicOrigin: string, instanceId: string, publicIds: string[]): string {
  const query = publicIds.map((p) => `c=${encodeURIComponent(p)}`).join('&');
  const src = `${publicOrigin}/embed/${instanceId}/channels${query ? `?${query}` : ''}`;
  return [
    `<iframe src="${src}" style="width:100%;border:0" title="Announcements" allow="fullscreen" allowfullscreen></iframe>`,
    `<script>addEventListener("message",e=>{if(e.origin==="${publicOrigin}"&&e.data&&e.data.cinderellaEmbedHeight)for(const f of document.querySelectorAll("iframe"))if(f.contentWindow===e.source)f.style.height=e.data.cinderellaEmbedHeight+"px"})</script>`,
  ].join('\n');
}

/**
 * Publication, per channel (CCB-S5-043, D-215).
 *
 * ── WHAT THIS CARD HAS TO SAY, AND WHY EACH SENTENCE IS HERE ─────────────────
 *
 * "An operator will assume [switching it off removes what was published]. It must either be
 * true or be denied on the page." It IS true: publication is derived on every read, so this
 * card states it as a fact rather than a hope.
 *
 * It also answers the question the operator cannot answer by looking at his own website:
 * which posts are published and which are not, per channel, counted through the same view a
 * visitor reads. A count computed from the switch would say "3 published" for three
 * announcements the quarantine had withheld.
 *
 * And it names the two things that are true but invisible from here: that the community
 * stream has its own switch on another page, and that announcements older than the origin
 * work can never be attributed and therefore never published.
 */
function publicationCard(opts: {
  csrf: string;
  publications: readonly ChannelPublicationView[];
  /** Channels the SELECTED bot holds a record of, stale records included. */
  knownToThisBot: ReadonlySet<string>;
  /** Channels that bot can currently use as a mapping source (the live ones). */
  selectableKeys: ReadonlySet<string>;
  unattributed: number;
  inStream: boolean;
  publicOrigin: string;
  instances: readonly { id: string; name: string }[];
  botId: number | null;
}): SafeHtml {
  const { publications, knownToThisBot, selectableKeys } = opts;
  const publishedChannels = publications.filter((p) => p.publish);
  const instance = opts.instances[0];

  /** "1 of 1 archived announcements are public" is not a sentence anybody writes. */
  const publishedLine = (archived: number, published: number): string => {
    const one = archived === 1;
    if (published === 0) {
      return one ? '1 archived announcement, not public' : `${String(archived)} archived, none public`;
    }
    if (published === archived) {
      return one
        ? 'its 1 archived announcement is public'
        : `all ${String(archived)} archived announcements are public`;
    }
    return `${String(published)} of ${String(archived)} archived announcements are public`;
  };

  return card(
    'Publish these announcements on the website',
    html`<p class="mb-3 text-sm text-slate-500">
        A switch per channel, because an operator wants one channel public and another
        private. It is <strong>not</strong> per bot: two bots subscribed to one channel are
        subscribed to one channel, and one decision covers it, which is also what makes the
        decision survive a rejoin.
      </p>
      <div class="mb-4 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <p>
          <strong>Publishing a channel puts its archived announcements on the public
          archive</strong>, under the standalone announcements block and, if you also switch
          the stream on below, beside your members' messages. The posts are your own text, so
          no member consent is involved and none is asked for.
        </p>
        <p class="mt-2">
          <strong>Switching it off removes them.</strong> Publication is worked out on every
          request rather than stored, so a channel switched off is gone from the standalone
          block and the stream on the next page load. Nothing is left behind to sweep up.
        </p>
      </div>
      ${/*
        SAID HERE BECAUSE THE OPERATOR WOULD OTHERWISE FIND IT BY LOOKING AT HIS OWN SITE
        (CCB-S5-043). A bridged picture is sent to the group AS a picture (D-214), but the
        archived row is text: `insertBotMessage` writes no media columns, and the re-hosted
        bytes live under BRIDGE_MEDIA_ROOT, which the public media route cannot serve because
        it resolves under MEDIA_ROOT and requires a stripped derivative that nothing produces
        for that tree. Publishing the picture therefore needs the metadata-stripping pipeline
        extended over bridge media, which is a safety guarantee rather than a plumbing job, so
        it was not done here. What is published is the announcement's TEXT, in full.
      */ ''}
      <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Text only, for now.</strong> A published announcement carries its words, in
        full. It does not carry the channel's picture or file, even though the announcement in
        the group does: the re-hosted copy sits outside the tree the public media route serves,
        and serving it would mean extending the metadata stripping that protects every other
        published image. That is a safety decision rather than a missing wire, so it is a
        separate piece of work rather than something to switch on.
      </div>
      ${publications.length === 0
        ? html`<p class="mb-3 text-sm text-slate-500">
            No channels yet. One appears here as soon as a bot knows about it.
          </p>`
        : html`<div class="overflow-x-auto">
            <table class="mb-3 w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th class="py-2 pr-3">Channel</th>
                  <th class="py-2 pr-3">Public now</th>
                  <th class="py-2 pr-3">Named</th>
                  <th class="py-2">Acts on</th>
                </tr>
              </thead>
              <tbody>
                ${publications.map((p) => {
                  const label = p.channelName || p.channelKey;
                  return html`<tr class="border-b border-slate-100 align-top">
                    <td class="py-2 pr-3">
                      <div class="font-medium">${label}</div>
                      <div class="text-xs text-slate-500">
                        ${publishedLine(p.archived, p.published)}
                      </div>
                      ${p.orphaned
                        ? html`<div class="mt-1 text-xs text-amber-800">
                            No bot currently holds this channel, and its posts stay public while
                            the switch is on. Kept on purpose: a rejoin gives the channel a new
                            group id, and forgetting the decision every time would mean taking
                            it again every time.
                          </div>`
                        : !knownToThisBot.has(p.channelKey)
                          ? html`<div class="mt-1 text-xs text-slate-500">
                              Known to another bot, not to the one selected above. The switch
                              still acts on the channel.
                            </div>`
                          : selectableKeys.has(p.channelKey)
                            ? null
                            : html`<div class="mt-1 text-xs text-slate-500">
                                This bot's record of it is stale, so it cannot be a mapping
                                source until it is rejoined. Its archived announcements are
                                unaffected, and this switch still governs them.
                              </div>`}
                    </td>
                    <td class="py-2 pr-3">
                      <form method="post" action="/bridge/publication/publish">
                        <input type="hidden" name="_csrf" value="${opts.csrf}" />
                        <input type="hidden" name="channelKey" value="${p.channelKey}" />
                        <input type="hidden" name="botProfileId" value="${String(opts.botId ?? '')}" />
                        <input type="hidden" name="publish" value="${p.publish ? 'off' : 'on'}" />
                        <div class="mb-1">${badge(p.publish ? 'public' : 'not public', p.publish ? 'green' : 'slate')}</div>
                        <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100">
                          ${p.publish ? `Stop publishing ${label}` : `Publish ${label}`}
                        </button>
                      </form>
                    </td>
                    <td class="py-2 pr-3">
                      <form method="post" action="/bridge/publication/anonymise">
                        <input type="hidden" name="_csrf" value="${opts.csrf}" />
                        <input type="hidden" name="channelKey" value="${p.channelKey}" />
                        <input type="hidden" name="botProfileId" value="${String(opts.botId ?? '')}" />
                        <input type="hidden" name="anonymise" value="${p.anonymise ? 'off' : 'on'}" />
                        <div class="mb-1">${badge(p.anonymise ? 'not named' : 'named', p.anonymise ? 'amber' : 'slate')}</div>
                        <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100">
                          ${p.anonymise ? `Name ${label}` : `Publish ${label} unnamed`}
                        </button>
                      </form>
                    </td>
                    <td class="py-2 text-xs text-slate-500">
                      <div>Every archived announcement from <strong>${label}</strong>, on both surfaces.</div>
                      <div class="mt-1 font-mono">${p.channelKey}</div>
                      ${p.publish
                        ? html`<div class="mt-1">Block id: <span class="font-mono">${p.publicId}</span></div>`
                        : null}
                    </td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>`}
      <div class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <p>
          <strong>Publishing a channel unnamed</strong> hides the channel and nothing else. The
          post keeps every word it was sent with; what goes is the channel's name, including
          where it appears inside the announcement's own attribution line, and the channel is
          not named in either surface's filter either. Two consequences worth knowing: such a
          post is not findable by searching the archive, because what a search reads is the
          words of the post and the name was among them; and the name it was sent under stays
          in your own records here, since this hides it from visitors rather than erasing it.
        </p>
        <p class="mt-2">
          Naming the channel is the honest state and the default. Turn this on only where you
          are republishing somebody else's channel and the source is not yours to advertise.
        </p>
      </div>
      ${opts.unattributed > 0
        ? html`<div class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>${String(opts.unattributed)} archived announcement${opts.unattributed === 1 ? '' : 's'} cannot be
            attributed to a channel, and can never be published.</strong>
            The channel each came from was only ever recorded on the forward log, and that
            record was already removed with its channel or its mapping before this became a
            column on the announcement itself. There is nothing left to recover it from: the
            only remaining starting point would be the group id, which is exactly the value a
            rejoin changes. They stay in the archive, unpublished, and no switch will reach
            them.
          </div>`
        : null}
      <div class="mb-3 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm">
        <p>
          <strong>In the community activity stream:</strong>
          ${inStreamBadge(opts.inStream)}
        </p>
        <p class="mt-1 text-xs text-slate-500">
          Publishing decides whether an announcement is public at all. This decides whether a
          public announcement also appears beside your members' messages in the stream, which
          is a second audience with a different promise. The standalone block below ignores it
          on purpose: that block <em>is</em> the announcements, and emptying it from a stream
          setting would be a control acting on something it does not name. Set it under
          <a class="underline" href="/interaction/archiving">Interaction, Archiving</a>.
        </p>
      </div>
      ${instance === undefined
        ? html`<p class="text-sm text-slate-500">
            Create an embed instance on the <a class="underline" href="/embeds">Embeds</a> page
            to get the snippet for a standalone announcements block.
          </p>`
        : html`<h3 class="mb-1 mt-4 text-sm font-semibold text-slate-700">
              The standalone announcements block
            </h3>
            <p class="mb-2 text-sm text-slate-500">
              Announcements and nothing else, for a site that wants your announcements and none
              of the consent machinery. A member's message cannot appear in it. Paste this into
              a page; the auto-height script keeps the iframe sized. It does not live-update
              like the stream does, so a switch changed here reaches it on the next page load.
            </p>
            ${publishedChannels.length === 0
              ? html`<p class="mb-2 text-xs text-amber-800">
                  Nothing is published yet, so this block would render empty. Switch a channel
                  on above first.
                </p>`
              : null}
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-slate-700">
                Every published channel (${String(publishedChannels.length)}), through
                ${instance.name}
              </span>
              <textarea
                readonly
                rows="4"
                class="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs"
              >
${channelBlockSnippet(opts.publicOrigin, instance.id, [])}</textarea
              >
            </label>
            ${publishedChannels.map(
              (p) => html`<label class="mt-2 block">
                <span class="mb-1 block text-xs font-medium text-slate-700">
                  Only ${p.channelName || p.channelKey}
                </span>
                <textarea
                  readonly
                  rows="4"
                  class="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs"
                >
${channelBlockSnippet(opts.publicOrigin, instance.id, [p.publicId])}</textarea
                >
              </label>`,
            )}
            <p class="mt-2 text-xs text-slate-500">
              For a block carrying several but not all channels, repeat
              <code>c=&lt;block id&gt;</code> in the URL, once per channel. Each channel's block
              id is in the table above.
            </p>`}`,
  );
}

/** The stream's own state, said in both directions rather than only when it is off. */
function inStreamBadge(on: boolean): SafeHtml {
  return on
    ? html`${badge('shown', 'green')}
        <span class="text-xs text-slate-600">
          Published announcements appear in the stream beside members' messages.
        </span>`
    : html`${badge('not shown', 'slate')}
        <span class="text-xs text-slate-600">
          Published announcements do not appear in the stream. They are still public in the
          standalone block, and each still has its own permalink.
        </span>`;
}

export function registerBridge(app: FastifyInstance, ctx: ViewContext): void {
  const { db, plugins } = ctx;

  app.get<{
    Querystring: {
      bot?: string;
      saved?: string;
      error?: string;
      /** "Nothing was joined, and here is why" - neither success nor fault (D-202). */
      notice?: string;
      groupLink?: string;
      channel?: string;
      dest?: string;
      since?: string;
      until?: string;
    };
  }>('/bridge', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const botProfiles = await listBotOnboardingProfiles(db);
    const selection = resolveSelectedBot(
      botProfiles,
      req.query.bot,
      req.session?.selectedBotProfileId ?? null,
    );
    const selectedBotId = selection.selectedId;

    // THE ROWS, NOT THE CACHE (the CCB-S5-011 lesson, same as the Plugins page):
    // a cold cache answers fail-closed and the first render would show the
    // capability off when the operator just turned it on.
    const shared = plugins.getStates();
    const overrides = selectedBotId === null ? [] : await listPluginOverridesForBot(db, selectedBotId);
    const effective = applyPluginOverrides(shared, overrides);
    const enabledHere = isPluginEnabled(effective, CHANNEL_BRIDGE_ID);

    // ── A CHANNEL WHOSE GROUP THE CORE NO LONGER HAS IS NOT A SOURCE (D-204) ──
    //
    // `cinderella_bridge_channels` is keyed on the core's LOCAL group id, and that id does
    // not survive a rejoin: the failed morning attempt left group 7 and the real
    // subscription arrived as group 9, so this list offered "CIND3R3LLA News" TWICE. The
    // operator picked the dead one, and the tick then ran 1516 times, succeeding every time,
    // looking for posts on a channel that receives nothing.
    //
    // Clearing the record now removes the row as well, but that only fixes the case somebody
    // clears. This is the guard for every other way a group id goes stale, and it is derived
    // from the core rather than stored: a channel is offered only while the bot still holds
    // a record of its group.
    const allChannels = selectedBotId === null ? [] : await listBridgeChannels(db, selectedBotId);
    const liveGroupIds = new Set(
      captureRoomState()
        .rooms.flatMap((r) => r.records)
        .filter((rec) => rec.botProfileId === selectedBotId)
        .map((rec) => rec.groupId),
    );
    // With no room index yet (the bot is not running) nothing is filtered, because an empty
    // index would otherwise hide every channel and read as "you have none".
    const channels =
      liveGroupIds.size === 0
        ? allChannels
        : allChannels.filter((c) => liveGroupIds.has(c.sourceGroupId));
    // ── NAME FIRST, ID BESIDE IT (CCB-S5-041) ──────────────────────────────
    //
    // The destination picker offered "group 8" and nothing else, so the operator picked his
    // room by typing a number he had learned from a LOG LINE - and that number had been 4
    // that morning, before a rejoin moved it. The console was asking him to remember a value
    // that means nothing to him and changes underneath him.
    //
    // The room index already resolves names, which is why the Capture page shows Cyb3rD3sk
    // rather than 4. Both are shown everywhere from here: the NAME first because it is what
    // he thinks in, the ID beside it because it is what the logs and the database speak, and
    // he reads both every day.
    const roomNames = new Map<number, string>();
    for (const r of captureRoomState().rooms) {
      for (const rec of r.records) {
        if (rec.botProfileId === selectedBotId) roomNames.set(rec.groupId, r.displayName);
      }
    }
    /** `Cyb3rD3sk (group 8)`, or `group 8` when the index has never seen it. */
    const withId = (groupId: number): string => {
      const name = roomNames.get(groupId);
      return name === undefined ? `group ${String(groupId)}` : `${name} (group ${String(groupId)})`;
    };

    const staleChannels =
      liveGroupIds.size === 0 ? [] : allChannels.filter((c) => !liveGroupIds.has(c.sourceGroupId));
    const mappings = selectedBotId === null ? [] : await listBridgeMappings(db, selectedBotId);
    const settings = plugins.channelBridgeSettings();
    const diag = bridgeDiagnostics();
    const suppressions = await listBridgeSuppressions(db, 20);

    // ── PUBLICATION (CCB-S5-043, D-215) ────────────────────────────────────
    //
    // Keyed on the CHANNEL rather than on this bot's record of it, so the list is not
    // filtered by the selected bot: two bots subscribed to one channel are subscribed to ONE
    // channel, and one decision covers it. The rows a bot here does know are marked, and the
    // orphans are marked too, because a switch still holding content public after its
    // channel record is gone is the thing an operator will look for and not find otherwise.
    const publications = await listChannelPublications(db);
    // FROM `allChannels`, NOT the selectable list. `channels` is filtered by the live room
    // index (D-204), so building this from it labelled every one of THIS bot's own channels
    // "known to another bot" the moment the index had not resolved them - a sentence that was
    // simply untrue, on a page whose whole job is saying what a control acts on.
    const knownToThisBot = new Set(allChannels.map((c) => c.channelKey));
    const selectableKeys = new Set(channels.map((c) => c.channelKey));
    const pluginScopes = describePluginScopes(
      (await listAllPluginOverrides(db)).filter((o) => o.pluginId === CHANNEL_BRIDGE_ID),
      botProfiles.length,
    );
    const unattributed = await countBridgeMessagesWithoutOrigin(db);
    // Whether a published announcement ALSO shows in the community stream. A different
    // question from publication, and one this page must answer because the control lives on
    // another page (D-205: name what the operator cannot see from here).
    const inStream = ctx.archive.get().categories.bridge;
    const embedInstances = await listEmbedInstances(db);

    const pendingByChannel = new Map<number, Awaited<ReturnType<typeof pendingBridgePosts>>>();
    for (const ch of channels) {
      pendingByChannel.set(
        ch.sourceGroupId,
        selectedBotId === null ? [] : await pendingBridgePosts(db, selectedBotId, ch.sourceGroupId),
      );
    }

    // The forward log's filter, straight off the querystring; the channel
    // options come from the log's own origin values via the channels table.
    const filter = {
      ...(req.query.channel ? { channelKey: req.query.channel } : {}),
      ...(req.query.dest ? { destGroupId: Number.parseInt(req.query.dest, 10) } : {}),
      ...(req.query.since ? { since: new Date(req.query.since) } : {}),
      ...(req.query.until ? { until: new Date(req.query.until) } : {}),
      limit: 50,
    };
    const forwards = await bridgeForwardLog(db, filter);
    const channelKeys = [...new Set(forwards.map((f) => f.origin.channelKey))];

    // The ids only: the messages table deliberately stores no group name (the
    // stable id is the key everywhere, briefing S1 §9), so the picker offers
    // the groups the bot has captured from by id.
    const destGroups = await db.query<{ group_id: string | number }>(
      `SELECT DISTINCT group_id FROM messages ORDER BY group_id LIMIT 100`,
    );

    const cadenceFields = (
      interval: string,
      count: string,
      maxAge: string,
      repeats: string,
    ): SafeHtml => html`
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        ${labelled(
          'Every N minutes',
          numberField('intervalMinutes', interval, 1, 10080),
          'Time trigger. Empty switches it off; then only the message count fires.',
        )}
        ${labelled(
          'Every N member messages',
          numberField('messageCount', count, 1, 10000),
          'Chat-activity trigger. Empty switches it off. With both set, whichever comes first fires.',
        )}
        ${labelled(
          'How far back (hours)',
          numberField('maxAgeHours', maxAge, 1, 720),
          'A post older than this is never announced. Old news is noise.',
        )}
        ${labelled(
          'Repeats per post',
          numberField('maxRepeats', repeats, 1, 50),
          'How many announcements one post gets before it stops.',
        )}
      </div>`;

    reply.type('text/html');
    return page({
      title: 'Channel Bridge',
      active: 'plugins',
      csrfToken: csrf,
      botSwitcher: { ...selection, returnTo: '/bridge' },
      body: html`
        ${/*
          NAMES THE BOT (D-211). This said "the bot" and named none, the same silence that let
          the operator edit one bot's greeting believing it was shared. The capability and the
          MAPPINGS here are per bot; the storage bound and the file ceiling are the
          deployment's, and saying which is which is what `knowledge` already does well.
        */ ''}
        ${pageHeader(
          'Channel Bridge',
          selection.selectedName
            ? `Channel posts become standing announcements ${selection.selectedName} brings into ` +
              `a group on your cadence. The mappings and the capability below are ` +
              `${selection.selectedName}'s alone; the storage limits are deployment-wide.`
            : 'Channel posts become standing announcements a bot brings into a group on your cadence.',
        )}
        ${req.query.saved
          ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</div>`
          : ''}
        ${req.query.error
          ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">${req.query.error}</div>`
          : ''}
        ${/*
          A THIRD STATE, BECAUSE THERE ARE THREE (D-202). "Saved." means a join was issued;
          red means something went wrong. "Nothing was joined, and here is why" is neither,
          and rendering it as either one is what cost the operator a morning.
        */ ''}
        ${req.query.notice
          ? html`<div class="mb-4 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">${req.query.notice}</div>`
          : ''}
        ${/*
          NOT FILTERED IN SILENCE (CCB-S3-023, D-204). A channel that vanished from the
          picker with no explanation is the same defect one step quieter: the operator would
          look for a source he had seen before and find nothing. Say which, and why.
        */ ''}
        ${staleChannels.length > 0
          ? html`<div class="mb-4 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <strong>${String(staleChannels.length)} channel${staleChannels.length === 1 ? '' : 's'} no longer selectable.</strong>
              ${staleChannels.map((c) => html`<span class="font-mono">${c.channelName}</span> (group ${String(c.sourceGroupId)}) `)}
              left over from a membership this bot no longer holds. A rejoin gives the same
              channel a new group id, so the old row can never receive a post again. Clear the
              record on the <a class="underline" href="/capture">Capture</a> page to remove it.
            </div>`
          : ''}
        ${/*
          A GROUP LINK IS REFUSED, AND THE REFUSAL HAS NO BUTTON (CCB-S5-040, D-198).

          This used to render "Join that group anyway" beside the refusal. That made the
          wrong outcome one click away at the moment the operator had just demonstrated he
          was confused about what he pasted, and the one time it fired it put the bot into
          a group it captured and answered in, unremovable from the console.

          Removing the form also removes something quieter: it carried the pasted link
          back through the URL as `?pending=`, which put a room credential in a query
          string, in the access log and in browser history. There is no `pending` any more.
        */ ''}
        ${req.query.groupLink
          ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              ${req.query.groupLink}
            </div>`
          : ''}

        <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Channel content is not end-to-end encrypted.</strong> Relay operators can
          read what they forward; SimpleX channels trade content secrecy for participation
          privacy. Bridge only channels whose content you consider public, because it
          already is.
        </div>

        ${!enabledHere
          ? html`<div class="mb-4 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              The bridge is <strong>off for this bot</strong>. Its intake stores nothing and
              its mappings do not tick. Switch it on per bot from the
              <a class="underline" href="/plugins">Plugins</a> page.
            </div>`
          : ''}

        ${card(
          'Channels this bot knows',
          html`<p class="mb-3 text-sm text-slate-500">
              A channel becomes known when a post arrives from it, or when you refresh the
              list from the running core. A mapping's source must be a known channel; that
              is half of what makes a loop impossible to configure.
            </p>
            ${channels.length === 0
              ? html`<p class="mb-3 text-sm text-slate-500">None yet.</p>`
              : html`<table class="mb-3 w-full text-left text-sm">
                  <thead>
                    <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th class="py-2 pr-3">Channel</th><th class="py-2 pr-3">Group id</th><th class="py-2 pr-3">Last post</th><th class="py-2">Link known</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${channels.map(
                      (c) => html`<tr class="border-b border-slate-100">
                        <td class="py-2 pr-3">${c.channelName}</td>
                        <td class="py-2 pr-3 text-slate-500">${String(c.sourceGroupId)}</td>
                        <td class="py-2 pr-3 text-slate-500">${c.lastPostAt ? fmtDate(c.lastPostAt.toISOString()) : 'never'}</td>
                        <td class="py-2">${c.link ? badge('yes', 'green') : badge('no', 'slate')}</td>
                      </tr>`,
                    )}
                  </tbody>
                </table>`}
            <div class="flex flex-wrap gap-3">
              <form method="post" action="/bridge/connect" class="flex grow gap-2">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="botProfileId" value="${String(selectedBotId ?? '')}" />
                <input
                  type="text"
                  name="link"
                  placeholder="A SimpleX channel link for this bot to join"
                  class="${INPUT_CLS} grow"
                />
                <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                  Join
                </button>
              </form>
              <form method="post" action="/bridge/channels/refresh">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="botProfileId" value="${String(selectedBotId ?? '')}" />
                <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
                  Refresh from the core
                </button>
              </form>
            </div>`,
        )}

        ${card(
          'Mappings',
          html`<p class="mb-3 text-sm text-slate-500">
              Many to many: a channel can feed several groups and a group can hear from
              several channels, each pair with its own rhythm. A destination can never
              itself be a channel, and never a group another mapping reads from; the form
              refuses, with the reason, because a bridge that can feed itself is not a
              setting anyone means to choose.
            </p>
            ${mappings.length === 0
              ? html`<p class="mb-3 text-sm text-slate-500">No mappings yet.</p>`
              : mappings.map((m) => {
                  const ch = channels.find((c) => c.sourceGroupId === m.sourceGroupId);
                  return html`<div class="mb-4 rounded-lg border border-slate-200 p-3">
                    <div class="mb-2 flex flex-wrap items-center gap-2">
                      ${badge(m.enabled ? 'on' : 'off', m.enabled ? 'green' : 'slate')}
                      <span class="text-sm font-medium">
                        ${ch?.channelName ?? `channel ${String(m.sourceGroupId)}`} into group
                        ${withId(m.destGroupId)}
                      </span>
                      <span class="text-xs text-slate-500">
                        last sent: ${m.lastSentAt ? fmtDate(m.lastSentAt.toISOString()) : 'never'}
                      </span>
                    </div>
                    <form method="post" action="/bridge/mappings/${String(m.id)}/cadence" class="mb-2">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      ${cadenceFields(
                        m.intervalMinutes === null ? '' : String(m.intervalMinutes),
                        m.messageCount === null ? '' : String(m.messageCount),
                        String(m.maxAgeHours),
                        String(m.maxRepeats),
                      )}
                      <button type="submit" class="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                        Save cadence
                      </button>
                    </form>
                    <div class="flex flex-wrap gap-2">
                      <form method="post" action="/bridge/mappings/${String(m.id)}/toggle">
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        <input type="hidden" name="enabled" value="${m.enabled ? 'off' : 'on'}" />
                        <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
                          ${m.enabled ? 'Switch off (kept, not deleted)' : 'Switch on'}
                        </button>
                      </form>
                      <form method="post" action="/bridge/mappings/${String(m.id)}/delete" class="flex items-center gap-2">
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        <!-- CSP forbids inline JS; deletion is a two-step confirm checkbox. -->
                        <label class="flex items-center gap-1 text-xs text-slate-600">
                          <input type="checkbox" name="confirm" required class="rounded" />
                          delete, with its forward history
                        </label>
                        <button type="submit" class="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>`;
                })}
            <h3 class="mb-2 mt-4 text-sm font-semibold text-slate-700">Add a mapping</h3>
            <form method="post" action="/bridge/mappings/create">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="botProfileId" value="${String(selectedBotId ?? '')}" />
              <div class="mb-3 grid gap-3 md:grid-cols-2">
                ${labelled(
                  'Source channel',
                  html`<select name="sourceGroupId" class="${INPUT_CLS}">
                    ${channels.map(
                      (c) => html`<option value="${String(c.sourceGroupId)}">${c.channelName} (group ${String(c.sourceGroupId)})</option>`,
                    )}
                  </select>`,
                  channels.length === 0 ? 'Join a channel first; the picker lists known channels only.' : undefined,
                )}
                ${labelled(
                  'Destination group',
                  html`<select name="destGroupId" class="${INPUT_CLS}">
                    <option value="">type an id below</option>
                    ${destGroups.rows.map(
                      (g) => html`<option value="${String(g.group_id)}">${withId(Number(g.group_id))}</option>`,
                    )}
                  </select>`,
                  'Groups the bot has captured from. For one it has not spoken in yet, use the id field.',
                )}
              </div>
              <div class="mb-3">
                ${labelled('Destination group id (manual)', numberField('destGroupIdCustom', '', 1, 2147483647))}
              </div>
              ${cadenceFields(
                String(DEFAULT_INTERVAL_MINUTES),
                String(DEFAULT_MESSAGE_COUNT),
                String(DEFAULT_MAX_AGE_HOURS),
                String(DEFAULT_MAX_REPEATS),
              )}
              <button type="submit" class="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                Add mapping
              </button>
            </form>
            <p class="mt-3 text-xs text-slate-500">
              When several posts are pending at one tick, the announcement is a digest: the
              newest post in full, up to ${String(DIGEST_SUMMARY_CAP)} older ones as one-line
              excerpts, and anything beyond counted in a stated remainder line. That shape is
              not settable: it is what keeps one announcement legible, not a rhythm.
            </p>`,
        )}

        ${card(
          'Pending posts',
          html`${channels.length === 0
            ? html`<p class="text-sm text-slate-500">Nothing pending.</p>`
            : channels.map((ch) => {
                const posts = pendingByChannel.get(ch.sourceGroupId) ?? [];
                if (posts.length === 0) return html``;
                return html`<div class="mb-3">
                  <h3 class="mb-1 text-sm font-semibold text-slate-700">${ch.channelName}</h3>
                  <table class="w-full text-left text-sm">
                    <tbody>
                      ${posts.map(
                        (p) => html`<tr class="border-b border-slate-100 align-top">
                          <td class="py-2 pr-3 text-slate-600">${p.text.slice(0, 120)}</td>
                          <td class="whitespace-nowrap py-2 pr-3 text-xs text-slate-500">
                            ${fmtDate(p.postedAt.toISOString())}, announced
                            ${String(p.repeatsDone)}x${p.mediaState !== 'none'
                              ? html`, media: ${p.mediaState}`
                              : ''}
                          </td>
                          <td class="py-2">
                            ${p.dismissedAt !== null
                              ? // The state, not a dead button (D-162): dismissal RESOLVES at
                                // the next tick (one writer of resolutions), so between the
                                // click and the tick the row says what the click did.
                                badge('dismissed, stops at the next tick', 'amber')
                              : html`<form method="post" action="/bridge/posts/${String(p.id)}/dismiss">
                                  <input type="hidden" name="_csrf" value="${csrf}" />
                                  <button type="submit" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">
                                    Dismiss
                                  </button>
                                </form>`}
                          </td>
                        </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`;
              })}`,
        )}

        ${publicationCard({
          csrf,
          publications,
          knownToThisBot,
          selectableKeys,
          unattributed,
          inStream,
          publicOrigin: ctx.adminCfg.publicOrigin.replace(/\/+$/, ''),
          instances: embedInstances.map((i) => ({ id: i.id, name: i.name })),
          botId: selectedBotId,
        })}

        ${bridgeScopePanel(pluginScopes, botProfiles, selectedBotId, {
          mappings: mappings.length,
          channelsPublished: publications.filter((p) => p.publish).length,
          channelsKnown: publications.length,
        })}

        ${card(
          'Forward log',
          html`<form method="get" action="/bridge" class="mb-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="bot" value="${String(selectedBotId ?? '')}" />
              ${labelled(
                'Channel',
                html`<select name="channel" class="${INPUT_CLS}">
                  <option value="">all</option>
                  ${channelKeys.map(
                    (k) => html`<option value="${k}" ${req.query.channel === k ? html`selected` : ''}>${k}</option>`,
                  )}
                </select>`,
              )}
              ${labelled('Destination group id', numberField('dest', req.query.dest ?? '', 1, 2147483647))}
              ${labelled(
                'Since',
                html`<input type="datetime-local" name="since" value="${req.query.since ?? ''}" class="${INPUT_CLS}" />`,
              )}
              ${labelled(
                'Until',
                html`<input type="datetime-local" name="until" value="${req.query.until ?? ''}" class="${INPUT_CLS}" />`,
              )}
              <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
                Filter
              </button>
            </form>
            ${forwards.length === 0
              ? html`<p class="text-sm text-slate-500">Nothing forwarded yet (or nothing matches the filter).</p>`
              : html`<div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead>
                      <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th class="py-2 pr-3">When</th><th class="py-2 pr-3">Kind</th><th class="py-2 pr-3">Channel</th><th class="py-2 pr-3">Group</th><th class="py-2">Post</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${forwards.map(
                        (f) => html`<tr class="border-b border-slate-100 align-top">
                          <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${fmtDate(f.sentAt.toISOString())}</td>
                          <td class="py-2 pr-3">${badge(f.kind, f.kind === 'withdrawal' ? 'amber' : 'slate')}</td>
                          <td class="py-2 pr-3 text-slate-600">${f.origin.channelName}</td>
                          <td class="py-2 pr-3 text-slate-500">${withId(f.destGroupId)}</td>
                          <td class="py-2 text-slate-600">${f.postText.slice(0, 100)}</td>
                        </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`}`,
        )}

        ${card(
          'Suppressed, and why',
          html`<p class="mb-3 text-sm text-slate-500">
              A post that stopped without ever being announced. A post that vanished with no
              record here would be the failure the briefing forbids; the tick cannot suppress
              without writing one.
            </p>
            ${suppressions.length === 0
              ? html`<p class="text-sm text-slate-500">Nothing suppressed.</p>`
              : html`<table class="w-full text-left text-sm">
                  <tbody>
                    ${suppressions.map(
                      (s) => html`<tr class="border-b border-slate-100 align-top">
                        <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${fmtDate(s.at.toISOString())}</td>
                        <td class="py-2 pr-3">${badge(s.reason, 'amber')}</td>
                        <td class="py-2 text-slate-600">${s.postText.slice(0, 100)}</td>
                      </tr>`,
                    )}
                  </tbody>
                </table>`}`,
        )}

        ${card(
          'Diagnostics and the deployment bound',
          html`${factList([
              [
                'Last tick',
                diag.lastTickAt === null
                  ? 'not yet this process'
                  : fmtDate(new Date(diag.lastTickAt).toISOString()),
              ],
              [
                'Last error',
                diag.lastError === null
                  ? 'none this process'
                  : `${fmtDate(new Date(diag.lastError.at).toISOString())}, ${diag.lastError.where}: ${diag.lastError.message}`,
              ],
            ])}
            <form method="post" action="/bridge/settings" class="flex items-end gap-2">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${labelled(
                'Largest re-hosted file (bytes)',
                numberField('maxFileBytes', String(settings.maxFileBytes), 65536, 1073741824),
                'Channel files are fetched on arrival and kept, because relays expire them in about 48 hours. A larger file forwards as text with the omission shown above.',
              )}
              <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                Save
              </button>
            </form>`,
        )}
      `,
    });
  });

  /* ── actions ────────────────────────────────────────────────────────────── */

  const back = (req: { body?: unknown }, extra: string): string => {
    const bot = bodyString(req.body, 'botProfileId');
    return `/bridge?bot=${encodeURIComponent(bot)}&${extra}`;
  };

  /**
   * What a failed runtime action tells the operator (CCB-S5-018, D-171).
   *
   * ── WHY THIS EXISTS RATHER THAN A CATCH BLOCK PER ROUTE ─────────────────────
   *
   * Both of this page's runtime actions shipped catching `err.message`, which for the
   * SDK's `ChatAPIError` is the literal string "Chat command error (see chatError
   * property)" - the detail is on `.chatError` and the message is a pointer to it. So
   * Join and Refresh rendered the SAME sentence for ANY core failure, and because
   * neither route logged, the journal held nothing to compare it against. The operator
   * reported it as an error with no error in it, for the third time.
   *
   * `describeChatError` was written for exactly this in CCB-S5-018 and was wired into
   * the runtime layer only: it had TWO call sites in the whole tree, `core.ts` and
   * `index.ts`, and NONE in the console - which is the surface an operator actually
   * reads. That is the D-105 shape again: the describer existed, the rule held, and the
   * newest source tree did not inherit it.
   *
   * THREE SURFACES, one story, because each answers a different question:
   *   - the LOG carries the whole payload, with the bot named, for `journalctl`;
   *   - `status.error` puts it on the dashboard, per CCB-S3-023: this is the plugin
   *     path and a failed Join or Refresh loses a capability the operator asked for;
   *   - `noteBridgeError` fills this page's own "Last error" card, which said
   *     "none this process" through both failures.
   *
   * The BANNER gets a bounded version. A `chatError` payload is unbounded JSON and the
   * banner is reached through a redirect querystring, so the whole thing would ride a
   * URL past what nginx will accept; the log is where the untruncated copy lives, and
   * the banner says so rather than quietly ending mid-object.
   */
  const BANNER_MAX = 300;

  const reportActionFailure = (where: string, botProfileId: number | null, err: unknown): string => {
    const detail = describeChatError(err);
    log.error(`bridge console: ${where} failed`, {
      botProfileId,
      error: detail,
    });
    status.error(`Channel bridge: ${where} failed: ${detail}`);
    noteBridgeError(`console:${where}`, err);
    return detail.length > BANNER_MAX
      ? `${detail.slice(0, BANNER_MAX)}... (full detail in the server log)`
      : detail;
  };

  app.post<{ Body: Record<string, unknown> }>('/bridge/connect', async (req, reply) => {
    const botProfileId = bodyInt(req.body, 'botProfileId');
    const link = bodyString(req.body, 'link');
    if (botProfileId === null) return reply.redirect('/bridge?error=Pick+a+bot+first.');
    try {
      // A GROUP link is REFUSED here, with no way to override it (D-198). It used to be
      // confirmable; see the note on the banner above for why that was the wrong half.
      const result = await connectBotToChannel(botProfileId, link);
      await writeAudit(db, req.session?.username ?? 'unknown', 'bridge.connect', `bot:${String(botProfileId)}`, {
        connected: result.connected,
      });
      // ── "Saved." IS WHAT A SUCCESSFUL JOIN SAYS, SO IT MAY NOT BE WHAT A NON-JOIN
      //    SAYS TOO (CCB-S5-040, D-202) ────────────────────────────────────────
      //
      // This redirected to `saved=1` whatever happened. Pressing Join on a channel the core
      // already held as a BROKEN record answered "Saved.", the operator concluded nothing
      // had happened, and he was right: nothing had, and the dead record was the reason.
      // A join that was not issued now says so, and says what to do about it.
      if (result.note !== null) {
        return reply.redirect(back(req, `notice=${encodeURIComponent(result.note)}`));
      }
      return reply.redirect(back(req, 'saved=1'));
    } catch (err) {
      // A group link is not a fault, it is a question. Reported as a refusal the operator
      // can act on rather than as an error, and NOT escalated to the dashboard: nothing is
      // wrong with the deployment, somebody pasted the wrong thing.
      // The link is NOT carried back. It named a real room, and a query string is the one
      // place it would be written to the access log and to browser history.
      if (err instanceof NotAChannelLinkError) {
        return reply.redirect(back(req, `groupLink=${encodeURIComponent(err.message)}`));
      }
      const message = reportActionFailure('joining a channel', botProfileId, err);
      return reply.redirect(back(req, `error=${encodeURIComponent(message)}`));
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/bridge/channels/refresh', async (req, reply) => {
    const botProfileId = bodyInt(req.body, 'botProfileId');
    if (botProfileId === null) return reply.redirect('/bridge?error=Pick+a+bot+first.');
    try {
      const discovered = await discoverBotChannels(botProfileId);
      for (const ch of discovered) {
        await upsertBridgeChannel(db, {
          botProfileId,
          sourceGroupId: ch.sourceGroupId,
          channelName: ch.channelName,
          link: ch.link,
        });
      }
      return reply.redirect(back(req, 'saved=1'));
    } catch (err) {
      const message = reportActionFailure('refreshing channels from the core', botProfileId, err);
      return reply.redirect(back(req, `error=${encodeURIComponent(message)}`));
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/bridge/mappings/create', async (req, reply) => {
    const botProfileId = bodyInt(req.body, 'botProfileId');
    if (botProfileId === null) return reply.redirect('/bridge?error=Pick+a+bot+first.');
    const sourceGroupId = bodyInt(req.body, 'sourceGroupId');
    const destGroupId = bodyInt(req.body, 'destGroupId') ?? bodyInt(req.body, 'destGroupIdCustom');
    if (sourceGroupId === null || destGroupId === null) {
      return reply.redirect(back(req, `error=${encodeURIComponent('A source channel and a destination group are both required.')}`));
    }

    // ── THE LOOP REFUSAL (loop.ts) ──────────────────────────────────────────
    //
    // Checked here, at save time, over the KNOWN CHANNELS as the kind oracle:
    // a channel is one this bot has seen behave as one. The database's FK then
    // holds the source half even if this code is bypassed.
    const channels = await listBridgeChannels(db, botProfileId);
    const known = new Set(channels.map((c) => c.sourceGroupId));
    const existing = await listBridgeMappings(db, botProfileId);
    const refusal = refuseMapping(
      { botProfileId, sourceGroupId, destGroupId },
      existing,
      (groupId) => known.has(groupId),
    );
    if (refusal !== null) {
      return reply.redirect(back(req, `error=${encodeURIComponent(refusalText(refusal))}`));
    }

    const intervalMinutes = bodyInt(req.body, 'intervalMinutes');
    const messageCount = bodyInt(req.body, 'messageCount');
    if (intervalMinutes === null && messageCount === null) {
      return reply.redirect(back(req, `error=${encodeURIComponent('At least one trigger is required: an interval, a message count, or both.')}`));
    }
    try {
      const id = await insertBridgeMapping(db, {
        botProfileId,
        sourceGroupId,
        destGroupId,
        intervalMinutes,
        messageCount,
        maxAgeHours: bodyInt(req.body, 'maxAgeHours') ?? DEFAULT_MAX_AGE_HOURS,
        maxRepeats: bodyInt(req.body, 'maxRepeats') ?? DEFAULT_MAX_REPEATS,
      });
      await writeAudit(db, req.session?.username ?? 'unknown', 'bridge.mapping.create', `mapping:${String(id)}`, {
        botProfileId,
        sourceGroupId,
        destGroupId,
      });
      return reply.redirect(back(req, 'saved=1'));
    } catch (err) {
      // Not a runtime action - this one is a database write - but swallowed the same
      // way: a redirect with a message and nothing in the log. The describer returns a
      // plain error's message verbatim, so this reads as it did and now leaves a trace.
      const message = reportActionFailure('creating a mapping', botProfileId, err);
      return reply.redirect(back(req, `error=${encodeURIComponent(message)}`));
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/bridge/mappings/:id/toggle',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const enabled = bodyString(req.body, 'enabled') === 'on';
      const mapping = await getBridgeMapping(db, id);
      if (mapping === null) return reply.redirect('/bridge?error=No+such+mapping.');
      await setBridgeMappingEnabled(db, id, enabled);
      await writeAudit(db, req.session?.username ?? 'unknown', 'bridge.mapping.toggle', `mapping:${String(id)}`, { enabled });
      return reply.redirect(`/bridge?bot=${String(mapping.botProfileId)}&saved=1`);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/bridge/mappings/:id/cadence',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const mapping = await getBridgeMapping(db, id);
      if (mapping === null) return reply.redirect('/bridge?error=No+such+mapping.');
      const intervalMinutes = bodyInt(req.body, 'intervalMinutes');
      const messageCount = bodyInt(req.body, 'messageCount');
      if (intervalMinutes === null && messageCount === null) {
        return reply.redirect(
          `/bridge?bot=${String(mapping.botProfileId)}&error=${encodeURIComponent('At least one trigger must stay set.')}`,
        );
      }
      await updateBridgeMappingCadence(db, id, {
        intervalMinutes,
        messageCount,
        maxAgeHours: bodyInt(req.body, 'maxAgeHours') ?? mapping.maxAgeHours,
        maxRepeats: bodyInt(req.body, 'maxRepeats') ?? mapping.maxRepeats,
      });
      await writeAudit(db, req.session?.username ?? 'unknown', 'bridge.mapping.cadence', `mapping:${String(id)}`, {
        intervalMinutes,
        messageCount,
      });
      return reply.redirect(`/bridge?bot=${String(mapping.botProfileId)}&saved=1`);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/bridge/mappings/:id/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const mapping = await getBridgeMapping(db, id);
      if (mapping === null) return reply.redirect('/bridge?error=No+such+mapping.');
      if ((req.body)['confirm'] !== 'on') {
        return reply.redirect(`/bridge?bot=${String(mapping.botProfileId)}`);
      }
      await deleteBridgeMapping(db, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'bridge.mapping.delete', `mapping:${String(id)}`, {});
      return reply.redirect(`/bridge?bot=${String(mapping.botProfileId)}&saved=1`);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/bridge/posts/:id/dismiss',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const done = await dismissBridgePost(db, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'bridge.post.dismiss', `post:${String(id)}`, { done });
      return reply.redirect('/bridge?saved=1');
    },
  );

  /**
   * The two publication switches (CCB-S5-043, D-215).
   *
   * Keyed on `channelKey`, which is a value the page rendered from the database rather than
   * anything a visitor can reach, and the write REFUSES an unknown key rather than creating
   * a row: a POST that invented a publication row would be a publication path with nobody's
   * decision behind it. A refusal is reported, because a successful-looking action followed
   * by nothing changing is the pair D-205 is about.
   */
  const applyPublication = async (
    body: unknown,
    actor: string,
    field: 'publish' | 'anonymise',
  ): Promise<string> => {
    const channelKey = bodyString(body, 'channelKey');
    const on = bodyString(body, field) === 'on';
    if (channelKey === '') return `error=${encodeURIComponent('No channel was named.')}`;
    const updated = await setChannelPublication(db, channelKey, { [field]: on }, actor);
    if (updated === null) {
      return `error=${encodeURIComponent(
        'That channel has no publication record, so nothing was changed. Refresh the page.',
      )}`;
    }
    await writeAudit(db, actor, `bridge.publication.${field}`, `channel:${channelKey}`, {
      [field]: on,
      channelName: updated.channelName,
    });
    return 'saved=1';
  };

  app.post<{ Body: Record<string, unknown> }>('/bridge/publication/publish', async (req, reply) => {
    const actor = req.session?.username ?? 'unknown';
    return reply.redirect(back(req, await applyPublication(req.body, actor, 'publish')));
  });

  app.post<{ Body: Record<string, unknown> }>(
    '/bridge/publication/anonymise',
    async (req, reply) => {
      const actor = req.session?.username ?? 'unknown';
      return reply.redirect(back(req, await applyPublication(req.body, actor, 'anonymise')));
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/bridge/settings', async (req, reply) => {
    await plugins.saveChannelBridge(
      { maxFileBytes: bodyString(req.body, 'maxFileBytes') },
      req.session?.username ?? 'unknown',
    );
    return reply.redirect('/bridge?saved=1');
  });
}
