/**
 * Interaction console (CCB-S3-002 §7) — how Cinderella listens, and every word
 * she says in chat.
 *
 * Each card posts one SECTION. The handler merges that section into the stored
 * settings and re-normalises the whole object, so a form that omits a field can
 * never blank an unrelated one, and an operator can never save a wake word of
 * `""` or a confidence threshold of `9`.
 *
 * Persona copy is edited here rather than in `locales/` on purpose: this is chat
 * voice, it is per-instance, and an operator changing how she speaks to their
 * community should not need file access to the server. Blanking a field restores
 * that string's shipped default rather than muting her.
 */

import type { FastifyInstance } from 'fastify';
import {
  ADDRESSING_MODES,
  DEFAULT_INTERACTION,
  normalizeInteraction,
  wakeWordProblem,
  REPLY_LANGUAGE_MODES,
  REPLY_MODES,
  PERSONA_KEYS,
  SHIPPED_LANGS,
  type InteractionSettings,
  type PersonaKey,
  type ReplyMode,
} from '../../interaction/settings.js';
import {
  CATEGORY_LABELS,
  MEMBER_CATEGORIES,
  MEMBER_CATEGORY_LABELS,
  REPLY_CATEGORIES,
  type ArchiveSettings,
} from '../../archive/settings.js';
import { NEAR_MISS_REASONS, recentNearMisses } from '../../interaction/near-misses.js';
import {
  CONVERSATION_OUTCOMES,
  conversationSummary,
  recentConversations,
} from '../../interaction/conversation-log.js';
import { forgedLineCount, recentForgedLines } from '../../interaction/forgery-log.js';
import { blockedNameCount, recentBlockedNames } from '../../interaction/blocked-name-log.js';
import {
  inventedRefusalCount,
  recentInventedRefusals,
} from '../../interaction/invented-refusal-log.js';
import { MIN_BLOCKED_NAME_CHARS } from '../../interaction/ollama-reply.js';
import { markersFromTemplates } from '../../interaction/protected-text.js';
import { missingHelpPlaceholders } from '../../interaction/help.js';
import {
  aiRuntimeSnapshot,
  setAiRuntimeEnabled,
  testAiRuntimeConnection,
} from '../../interaction/ai-runtime.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, fmtDate, pageHeader, scopePanel, type ScopeLine } from './ui.js';
import {
  SETTING_SCOPES,
  applySettingOverrides,
  describeSettingScopes,
  readPath,
  retortsForBot,
  wakeWordForNewBot,
  wakeWordState,
  type WakeWordState,
  type SettingScopeView,
} from '../../interaction/setting-scope.js';
import {
  botDisplayName,
  clearSettingOverride,
  listAllSettingOverrides,
  listSettingOverridesForBot,
  setSettingOverride,
} from '../../db/interaction-overrides.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';
import { writeAudit } from '../../db/audit.js';
import { systemPrompt } from '../../interaction/ollama-reply.js';
import { currentPromptRules } from '../../interaction/prompt-rule-service.js';
import { replyCharBudget, type BotPersonality } from '../../interaction/personality.js';
import { previewPersonality } from '../preview-personality.js';
import { botIdentity } from '../../interaction/settings.js';
import type { MusicPromptFacts } from '../../interaction/personality.js';
import { previewMusicFacts } from '../music-facts.js';
import { MAX_HISTORY_LIMITS } from '../../interaction/history.js';
import { resolveSelectedBot } from '../selected-bot.js';

const INPUT_CLS = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';

function textField(name: string, value: string, placeholder = ''): SafeHtml {
  return html`<input
    name="${name}"
    value="${value}"
    placeholder="${placeholder}"
    class="${INPUT_CLS}"
  />`;
}

function numberField(name: string, value: number, min: number, max: number, step = '1'): SafeHtml {
  return html`<input
    name="${name}"
    type="number"
    min="${String(min)}"
    max="${String(max)}"
    step="${step}"
    value="${String(value)}"
    class="${INPUT_CLS} sm:w-40"
  />`;
}

function selectField(name: string, current: string, options: [string, string][]): SafeHtml {
  return html`<select name="${name}" class="${INPUT_CLS}">
    ${options.map(
      ([value, label]) =>
        html`<option value="${value}" ${value === current ? raw('selected') : ''}>
          ${label}
        </option>`,
    )}
  </select>`;
}

function checkbox(name: string, label: string, checked: boolean): SafeHtml {
  return html`<label class="flex items-center gap-2 text-sm">
    <input type="checkbox" name="${name}" ${checked ? raw('checked') : ''} class="rounded" />
    ${label}
  </label>`;
}

/**
 * A checkbox with a line of explanation under it.
 *
 * Not `labelled(…, checkbox(…))`: that nests a `<label>` inside a `<label>`, which is
 * invalid and costs the click-to-toggle behaviour of the inner one. The help text is a
 * sibling of the label, not a child of it.
 */
function checkboxWithHelp(name: string, label: string, isChecked: boolean, help: string): SafeHtml {
  return html`<div class="flex flex-col gap-1">
    ${checkbox(name, label, isChecked)}
    <span class="text-xs text-slate-500">${help}</span>
  </div>`;
}

function labelled(text: string, control: SafeHtml, help?: string): SafeHtml {
  return html`<label class="flex flex-col gap-1 text-sm">
    <span class="font-medium text-slate-700">${text}</span>
    ${control} ${help ? html`<span class="text-xs text-slate-500">${help}</span>` : null}
  </label>`;
}

function textArea(name: string, value: string, rows: number): SafeHtml {
  return html`<textarea name="${name}" rows="${String(rows)}" class="${INPUT_CLS} font-mono">
${value}</textarea>`;
}

/**
 * How close to the context ceiling the current settings sit (CCB-S4-044).
 *
 * The briefing asks for the measured size rather than a promise, so this ASSEMBLES a real
 * prompt through the reply path's own function and counts it, rather than estimating from the
 * settings. An operator should be able to see the headroom here instead of discovering it
 * when replies start failing.
 *
 * The token figure is a conversion at roughly 3.2 characters per token, and it is labelled as
 * an approximation because it is one: the real number depends on the language and the
 * tokenizer, and a precise-looking wrong number is worse than an honest range.
 *
 * ── WHY THE PERSONALITY IS HANDED IN (D-229) ─────────────────────────────────
 *
 * It used to call `currentBotPersonality()` with no bot id, which answered with the primary's
 * until CCB-S5-019 removed that fallback and `null` ever since. So the measurement omitted the
 * whole voice section - the dial block, the base character and the origin, which alone is
 * roughly 1.7 KB - and reported a headroom figure that read SAFER than the prompt she is
 * actually sent. A measurement that errs towards "you have room" is the wrong direction for a
 * card whose whole job is to warn, and nothing said it was happening.
 *
 * A parameter rather than a reach, so a caller that forgets it does not compile, and so the
 * card stays a pure function of what it is given.
 */
function memorySizeCard(
  s: InteractionSettings,
  personality: BotPersonality | null,
  botName: string | null,
  music: MusicPromptFacts | undefined,
): SafeHtml {
  const rules = currentPromptRules();
  const worstCase = Array.from({ length: s.memory.maxMessages }, () => ({
    speaker: 'Member',
    text: 'x'.repeat(200),
  }));

  let bare = 0;
  let full = 0;
  try {
    const build = (history: { speaker: string; text: string }[]): number =>
      systemPrompt(
        {
          kind: 'conversation',
          lang: 'en',
          memberMessage: '',
          deterministicDraft: '',
          mode: 'conversation',
          rules,
          personality,
          identity: botIdentity(s),
          history,
          historyWindowMinutes: s.memory.windowMinutes,
          now: { at: new Date(), timeZone: 'UTC' },
          // The DJ sheet, when the music plugin is on for this bot (D-220). Without it
          // the measurement under-counted by the has-music rules, which is a headroom
          // figure that reads safer than the prompt she is actually sent.
          music,
        },
        // The verbosity dial's own budget, not the 500 this used to hardcode. The number is
        // rendered INTO the prompt as the length instruction, so measuring with a different
        // one measures a prompt she is not sent. `replyCharBudget(5)` is 500, so a bot at the
        // middle of the dial measures exactly as it did (migration 034).
        replyCharBudget(personality?.verbosity ?? 5),
      ).length;
    bare = build([]);
    full = build(worstCase) + Math.min(s.memory.maxChars, worstCase.length * 208);
  } catch {
    // No registry loaded in this process. The card says so rather than showing zeroes.
    return card(
      'What it costs',
      html`<p class="text-sm text-slate-600">
        The rule registry is not loaded in this process, so there is nothing to measure yet.
      </p>`,
    );
  }

  const tokens = Math.round(full / 3.2);
  const tight = tokens > 6000;
  return card(
    'What it costs',
    html`<dl class="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="font-medium text-slate-700">Her rules, voice and facts alone</dt>
          <dd class="text-slate-600">${String(bare)} characters</dd>
        </div>
        <div>
          <dt class="font-medium text-slate-700">With a full history at these settings</dt>
          <dd class="text-slate-600">${String(full)} characters</dd>
        </div>
        <div>
          <dt class="font-medium text-slate-700">Roughly, in tokens</dt>
          <dd class="text-slate-600">~${String(tokens)} of 8192</dd>
        </div>
      </dl>
      ${
        /* WHOSE PROMPT WAS MEASURED (D-229). The voice section differs per bot, so a figure
           that names no bot is a figure an operator cannot act on: he lowers the history
           budget for the bot with the long origin and reads the number for another one.

           IT LISTS WHAT IT ACTUALLY COUNTED. D-220 and D-229 both added a per-bot input to
           this measurement, and the sentence named only one of them for as long as the two
           branches were apart: a card that under-counted for months should not then describe
           itself incompletely. The library clause appears exactly when the library is in the
           figure. */ ''
      }
      <p class="mt-3 text-sm text-slate-500">
        ${botName === null
          ? "Measured with no bot's character or dials, because none is selected. Pick a bot above to see what one is actually sent."
          : `Measured for ${botName}, carrying that bot's own dials, base character and origin${
              music ? ', and the music library it can reach' : ''
            }, exactly as its replies carry them.`}
      </p>
      <p class="mt-2 text-sm text-slate-500">
        ${tight
          ? 'That is a large share of the context window. Her reply needs room too, and a rule set that gets crowded out is a safety problem rather than a slow one. Consider lowering the character budget.'
          : 'Assembled as a real prompt at these settings rather than estimated. Her reply needs a few hundred tokens on top.'}
      </p>`,
  );
}

function saveButton(): SafeHtml {
  return html`<button
    type="submit"
    class="self-start rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
  >
    Save
  </button>`;
}

/**
 * Her own messages in the archive (CCB-S3-007).
 *
 * It lives on this page rather than getting its own, because it is inseparable
 * from the copy directly below it: the placeholder that replaces a name is one of
 * the persona strings, and an operator deciding whether her replies are public
 * wants to see what those replies actually say.
 */
function archiveCard(a: ArchiveSettings, csrf: string): SafeHtml {
  return card(
    'Her own messages in the archive',
    html`<form method="post" action="/interaction" class="flex flex-col gap-4">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="section" value="archive" />
      <p class="text-sm text-slate-600">
        Publication here is decided by these switches alone — she is not a member and has no
        consent record, and nothing on this page writes to one. Members' own messages are
        unaffected by everything below.
      </p>
      ${checkbox(
        'publishBotMessages',
        'Publish her replies on the public archive',
        a.publishBotMessages,
      )}
      <span class="text-xs text-slate-500">
        Turning this off removes her messages from the public stream immediately. Nothing is
        deleted — turning it back on restores them, because publication is worked out on every
        read rather than stored.
      </span>

      ${labelled(
        'When one of her replies names a member who has not opted in',
        selectField('mentionGuard', a.mentionGuard, [
          ['redact', 'Replace the name (keeps the sentence readable)'],
          ['withhold', 'Withhold the whole message'],
        ]),
        'Checked on every read, so a member who opts out later also disappears from replies of ' +
          'hers that were already public. Note that "replace the name" leaves the message in ' +
          'place, so a copy already fetched by a feed reader or a crawler keeps the old text; ' +
          '"withhold" takes the message out of the feed entirely.',
      )}
      <span class="text-xs text-slate-500">
        The stand-in text is the persona string
        <em>“Stands in for a member who has not opted in”</em>, further down this page.
      </span>

      ${checkbox(
        'stripMediaMetadata',
        'Strip metadata from published media',
        a.stripMediaMetadata,
      )}
      <span class="text-xs text-slate-500">
        Removes EXIF, IPTC and XMP from published images — GPS coordinates, camera make, model
        and serial number, capture time, and any owner or copyright name. Photographs from
        phones routinely carry the coordinates of where they were taken. The stored original is
        never modified; the public archive serves a stripped copy, and image orientation is
        applied to the pixels first so nothing appears rotated. Video and document formats have
        no stripper on this instance, and are listed as such rather than assumed clean.
      </span>

      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium text-slate-700">
          Which member questions are archived
        </span>
        <span class="text-xs text-slate-500">
          A member's question is that member's message, so these publish on the ordinary consent
          rules unless switched off here. Note the opposite default from her replies below: her
          words need a reason to be public, an opted-in member's words need a reason not to be.
          An answer whose question is excluded is excluded with it, so the archive never shows
          her answering nobody.
        </span>
        ${MEMBER_CATEGORIES.map(
          (c) => html`<div class="flex flex-col">
            ${checkbox(`mcat:${c}`, MEMBER_CATEGORY_LABELS[c].label, a.memberCategories[c])}
            <span class="ml-6 text-xs text-slate-500">${MEMBER_CATEGORY_LABELS[c].help}</span>
          </div>`,
        )}
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium text-slate-700">Which of her replies are archived</span>
        ${REPLY_CATEGORIES.map(
          (c) => html`<div class="flex flex-col">
            ${checkbox(`cat:${c}`, CATEGORY_LABELS[c].label, a.categories[c])}
            <span class="ml-6 text-xs text-slate-500">${CATEGORY_LABELS[c].help}</span>
          </div>`,
        )}
        <span class="text-xs text-slate-500">
          A reply from a handler that declares no category at all is never published, so a new
          plugin cannot land in the archive unclassified.
        </span>
      </div>
      ${saveButton()}
    </form>`,
  );
}

/** Human labels and the placeholders each persona string may use. */
const PERSONA_META: Record<PersonaKey, { label: string; vars: string }> = {
  publishConfirm: { label: 'Publish — asking for confirmation', vars: '' },
  published: { label: 'Publish — done', vars: '' },
  unpublishConfirm: { label: 'Unpublish — asking for confirmation', vars: '' },
  unpublished: { label: 'Unpublish — done', vars: '' },
  refuseThirdParty: { label: 'Refusing to act for someone else', vars: '{name}' },
  status: { label: 'Status answer', vars: '{total} {public}' },
  searchResult: { label: 'Search answer', vars: '{n} {query}' },
  notUnderstood: { label: 'Not understood', vars: '' },
  conversationUnavailable: { label: 'Free conversation unavailable', vars: '' },
  moderationWarning: { label: 'Moderation warning (rides out with the retort)', vars: '{n} {total}' },
  searchNoQuery: { label: 'Archive search with nothing to search for', vars: '' },
  searchSources: {
    label: 'Web search sources (appended verbatim, never reworded)',
    vars: '{sources}',
  },
  knowledgeSources: {
    label: 'Knowledge base sources (appended verbatim, never reworded)',
    vars: '{sources}',
  },
  searchUnavailable: { label: 'Web search could not be reached', vars: '' },
  rulesNoElimination: {
    label: 'Refuses to narrow down which rules are withheld (answered by the application)',
    vars: '',
  },
  rulesNoSuchLaw: {
    label: 'Asked for a law by a page number she has none for (answered by the application)',
    vars: '{n} {total}',
  },
  searchRefused: {
    label: 'Web search refused before it ran (nothing was queried, no sources)',
    vars: '',
  },
  searchEmpty: { label: 'Web search ran and found nothing (closes an announcement)', vars: '' },
  searchIrrelevant: {
    label: 'Web search found things, none of them about the question',
    vars: '',
  },
  searchUnchecked: {
    label: 'Web search found things and their relevance could not be checked',
    vars: '',
  },
  searchNoWords: {
    label: 'A lookup ran and found something, and the reply was then lost',
    vars: '',
  },
  bridgeAttribution: {
    label: 'Channel bridge: the attribution under a forwarded post',
    vars: '{channel} {when}',
  },
  bridgeMore: {
    label: 'Channel bridge: the digest line naming posts it did not show',
    vars: '{channel} {n}',
  },
  bridgeAnonymousChannel: {
    label: 'Channel bridge: what stands in for the channel name when it is published unnamed',
    vars: '',
  },
  musicPlaylists: { label: 'Music: the playlists this bot holds (locked: the list is application fact)', vars: '{playlists}' },
  musicNoPlaylists: { label: 'Music: asked for playlists while holding none', vars: '' },
  musicOverview: { label: 'Music: what she holds and how to use it, for a music question that plays nothing (locked)', vars: '{tracks} {genres} {playlists}' },
  musicUnknownPlaylist: { label: 'Music: asked what is on a playlist she does not hold', vars: '' },
  musicTracks: { label: 'Music: what is on a named playlist (locked: the list is application fact)', vars: '{playlist} {tracks}' },
  musicUnknownTrack: { label: 'Music: asked to play a title she does not hold (names no title on purpose)', vars: '' },
  musicBusy: { label: 'Music: asked while a send is still on its way to this room', vars: '' },
  musicUnavailable: { label: 'Music: the library or the transport is unreachable', vars: '' },
  musicGenreYes: { label: 'Music: a genre she holds, confirmed with its own count and an offer', vars: '{genre} {tracks}' },
  musicGenresSome: { label: 'Music: several named genres confirmed at once, each with its count', vars: '{list}' },
  musicNotHeld: { label: 'Music: a have-ask naming nothing she holds (echo-free on purpose)', vars: '' },
  musicGenreTracks: { label: 'Music: the numbered listing of one genre (locked: the list is application fact)', vars: '{genre} {tracks}' },
  musicNothingToFollow: { label: 'Music: asked for the next one in a room where nothing has played yet', vars: '' },
  musicSendFailed: { label: 'Music: the track was found and the SEND failed (never a caption that reads as success)', vars: '' },
  musicUploadNotAudio: { label: 'Member upload: refused, not an MP3 (the allow-list, both sides)', vars: '' },
  musicUploadTooLarge: { label: 'Member upload: refused, over the size bound (the live bound, so raising it cannot stale the line)', vars: '{limit}' },
  musicUploadNoFile: { label: 'Member upload: asked to play back with no file of theirs in sight', vars: '' },
  musicUploadOff: { label: 'Member upload: the capability is off for this bot', vars: '' },
  moderationAction: {
    label: 'Moderation step announced (only when armed and announcements are on)',
    vars: '{action} {duration}',
  },
  undo: { label: 'Undo — done', vars: '' },
  undoNothing: { label: 'Undo — nothing to undo', vars: '' },
  undoNotRevocation: {
    label: 'Undo — a revocation cannot be undone',
    vars: 'Shown when a member asks to undo taking their words back.',
  },
  cancelled: { label: 'Confirmation declined', vars: '' },
  help: {
    label: 'Help reply (template)',
    vars: '{wake} = her name; {commands} = the generated capability list (required); {consent} = the three publishing properties (required); {label} = what she is. Blank restores the default.',
  },
  price: { label: 'Price answer', vars: '{amount} {base} {value} {quote}' },
  conversion: { label: 'Conversion answer', vars: '{amount} {base} {value} {quote}' },
  priceUnknownAsset: { label: 'Price — asset not in the registry', vars: '{symbol}' },
  priceAmbiguous: { label: 'Price — symbol is ambiguous', vars: '{symbol} {options}' },
  priceUnavailable: { label: 'Price — market data unreachable', vars: '' },
  priceThrottled: { label: 'Price — asked too often, try again shortly', vars: '' },
  redactedMember: {
    label: 'Stands in for a member who has not opted in',
    vars: 'Not a reply. When one of her published messages names a member who has not opted in, this replaces the name.',
  },
  revokeChoice: {
    label: 'Revocation — hide or delete?',
    vars: 'Asked straight after a revocation. There is deliberately no default: until the member answers, their content stays hidden.',
  },
  hidden: { label: 'Revocation — hidden, and restorable', vars: '{wake}' },
  deleteConfirm: {
    label: 'Revocation — confirming destruction',
    vars: 'Must name the exact word the member has to write. A bare "yes" is refused on purpose.',
  },
  deleteNeedsWord: {
    label: 'Revocation — a "yes" is not enough to destroy',
    vars: 'Shown when a member answers the destruction question with an affirmation instead of the required word.',
  },
  deleted: { label: 'Revocation — destroyed', vars: '{n} = messages destroyed' },
  deleteDeferred: {
    label: 'Revocation — destroyed in part, some items held',
    vars: '{n} = destroyed; {held} = held for review. Must never reveal who reported the item or what the report said.',
  },
  deleteNothing: { label: 'Revocation — the archive held nothing of theirs', vars: '' },
  // CCB-S3-031. Each of these covers a state the reply used to guess at from
  // destruction counts, which is how a member who had chosen HIDE came to be told
  // their retained, restorable archive did not exist.
  deleteRetrying: {
    label: 'Revocation — destruction failed and is being retried',
    vars: '{held} = still present. Must not claim the content is gone: it is hidden and still here.',
  },
  choiceNotRevoked: {
    label: 'Revocation — asked to hide or delete with nothing withdrawn',
    vars: '{wake} = her name. Should name the command that does work.',
  },
  alreadyHidden: {
    label: 'Revocation — asked to hide what is already hidden',
    vars:
      '{wake} = her name. Must say the words are RETAINED and restorable, and must never ' +
      'claim they are gone or that the archive is empty.',
  },
  alreadyDestroyed: {
    label: 'Revocation — asked to hide or delete what is already destroyed',
    vars: '{wake} = her name. This is the one case where "destroyed" is the truth.',
  },
  restored: { label: 'Restore — hidden content is back', vars: '' },
  restoreNotDeleted: {
    label: 'Restore — it was destroyed, not hidden',
    vars: '{wake}',
  },
  restoreConfirm: {
    label: 'Restore — asking for confirmation',
    vars: 'Restoring puts content back into public view, so it confirms first, like publishing.',
  },
};

const REPLY_MODE_LABELS: Record<ReplyMode, string> = {
  plain: 'Plain — a normal group message (recommended)',
  mention: "Mention — a normal message, opened with the member's name",
  quote: "Quote — repeats the member's message above the answer",
};

const ADDRESSING_MODE_LABELS: Record<string, string> = {
  relaxed: 'Relaxed — a message starting with her name counts as an address',
  strict: 'Strict — a greeting must come first (Hey CIND3R3LLA ...)',
};

const REPLY_LANGUAGE_MODE_LABELS: Record<string, string> = {
  auto: 'Auto — answer in the language of the message',
  fixed: 'Fixed — always answer in the default language',
};

const LANG_LABELS: Record<string, string> = { en: 'English', de: 'Deutsch' };

function langLabel(code: string): string {
  return LANG_LABELS[code] ?? code.toUpperCase();
}

/** Deep copy of the current settings — the base every section edit merges into. */
function cloneSettings(s: InteractionSettings): Record<string, unknown> {
  return JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
}

function bodyString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v : '';
}


/**
 * Which of this page's settings are shared, and which belong to one bot (CCB-S5-006).
 *
 * ── WHY IT IS GENERATED FROM THE INVENTORY ──────────────────────────────────
 *
 * The scopes live in `SETTING_SCOPES`, so this renders them rather than restating them.
 * A hand-written list here would be a second copy of the answer, and the drift would run
 * in the worst direction: the page would say "shared" for something the database had
 * started accepting per bot, and an operator would edit one bot expecting to change all.
 *
 * ── WHY IT MATCHES THE BOOK RATHER THAN INVENTING A SECOND LANGUAGE ─────────
 *
 * The operator's standing requirement carries over word for word from CCB-S5-001: it must
 * always be visible which is which. The Book already answers it with a badge per law, the
 * deviating bots named, and a count on the edit warning. Same three, same words, same
 * colours: an operator who has learned to read one page should not have to learn a second.
 */
/**
 * Which of the two states this bot's wake word is in, said plainly (CCB-S5-030).
 *
 * The operator renamed a bot and it went on answering to its old name. The value being wrong
 * was half the problem; the other half was that nothing anywhere said so, and the page showed
 * the stale word with no hint that it had stopped tracking the name above it.
 *
 * So the page states the state, always, in both directions. "Follows the display name" is as
 * worth printing as "the operator chose this": a bot that silently agrees today is a bot the
 * operator can rename tomorrow without wondering.
 */
function wakeWordStateNote(state: WakeWordState | null): SafeHtml {
  if (state === null) return html``;

  if (state.derived) {
    return html`<p class="mt-1 text-xs text-emerald-700">
      Follows the display name. Rename this bot and its wake word follows.
    </p>`;
  }

  // The interesting case, and the one the operator hit. Naming the value it WOULD have is what
  // turns "this is custom" into something actionable: it is exactly what to type to hand the
  // bot back to its own name.
  const matches =
    state.fromDisplayName !== null &&
    state.fromDisplayName.toLocaleLowerCase() === state.word.toLocaleLowerCase();

  if (matches) {
    return html`<p class="mt-1 text-xs text-slate-500">
      Set by you. It happens to match the display name today, but it will not follow a rename.
      Save it again to hand it back to the name.
    </p>`;
  }

  return html`<p class="mt-1 text-xs text-amber-700">
      Set by you, and it does not follow the display name.
      ${state.fromDisplayName === null
        ? html`This bot's display name yields no usable wake word, so a custom one is the only
          option.`
        : html`This bot answers to <strong>${state.word}</strong>, not to
          <strong>${state.fromDisplayName}</strong>. If it was renamed and should follow, save
          <strong>${state.fromDisplayName}</strong> here.`}
    </p>`;
}

/**
 * The scope panel for one interaction section.
 *
 * The RENDERING moved to `ui.ts` under CCB-S5-043 so the Bridge page shows the same surface
 * rather than a second one beside it (D-213). What stays here is the part that is this page's
 * own: which keys belong to this section, and where its per-bot links point.
 */
function interactionScopePanel(
  section: string,
  scopes: Map<string, SettingScopeView>,
  bots: { id: number; displayName: string }[],
  selectedBotId: number | null,
  slug: string,
): SafeHtml | null {
  const lines: ScopeLine[] = [];
  for (const p of SETTING_SCOPES) {
    if (p.section !== section) continue;
    const v = scopes.get(p.key);
    if (!v) continue;
    lines.push({
      key: p.key,
      scope: v.scope,
      deviatingBotIds: v.deviatingBotIds,
      sharedBotCount: v.sharedBotCount,
      reason: v.reason,
    });
  }
  return scopePanel({
    lines,
    bots,
    selectedBotId,
    switcherHref: (id) => (id === null ? `/interaction/${slug}?bot=shared` : `/interaction/${slug}?bot=${String(id)}`),
  });
}

/**
 * Interaction is split into sub-sections (CCB-S3-015 Stage 1). Each has its own
 * URL under /interaction/<slug>, its own submenu entry, and saves independently.
 * The page had grown into one long scroll with every briefing this season; the
 * split gives an operator a bookmarkable, linkable place for each concern.
 *
 * Every setting lands in exactly ONE section, and the round-trip is proven by
 * verify:admin-views — nothing was dropped in the move.
 *
 * WELCOME IS IN THIS TABLE AND NOT IN THIS FILE (D-228). Its row here puts it in
 * the section submenu on every interaction page; its PAGE stays with its plugin
 * (`welcome.ts`), registered at the static route /interaction/welcome, which the
 * router prefers over the :section parameter below. The first attempt gave it a
 * nav KEY and left the page at /welcome, and the screenshot showed exactly what
 * that buys: a sidebar entry pointing at a page that stands outside the section
 * it claims to live in.
 */
const SECTIONS: { slug: string; title: string; desc: string }[] = [
    { slug: 'addressing', title: 'Addressing', desc: 'How she is addressed: her name, greetings, and which channels reach her.' },
    { slug: 'guards', title: 'Guards', desc: 'When matching her name does NOT mean she was spoken to.' },
    { slug: 'followup', title: 'Follow-up', desc: 'The window after she replies, and what a short follow-up may carry.' },
    { slug: 'welcome', title: 'Welcome', desc: 'What she says to somebody who has just joined a room. Per bot.' },
    { slug: 'language', title: 'Language', desc: 'Which language she answers in.' },
    { slug: 'memory', title: 'Memory', desc: 'How much of the conversation she can see.' },
    { slug: 'replies', title: 'Replies', desc: 'How her answers appear, and how often she may send them.' },
    { slug: 'nicknames', title: 'Nicknames', desc: 'The names she refuses to answer to, and her retorts.' },
    { slug: 'consent', title: 'Consent behaviour', desc: 'Confirmation words, undo window, and the consent handshake.' },
    { slug: 'voice', title: 'Voice', desc: 'Every persona string, per language, plus the help-footer links.' },
    { slug: 'archiving', title: 'Archiving', desc: 'Whether her own messages and members’ questions are published.' },
    { slug: 'diagnostics', title: 'Diagnostics', desc: 'The near-miss log, and the resolver currently in use.' },
];

/**
 * The section table as a submenu. Exported because the Welcome page lives in the
 * table while its markup lives with its plugin: one renderer, so the table and
 * the page borrowing it cannot drift.
 */
export function interactionSectionsNav(slug: string): SafeHtml {
  return html`<nav class="mb-6 flex flex-wrap gap-1 border-b border-slate-200 pb-2">
    ${SECTIONS.map(
      (x) =>
        html`<a
          href="/interaction/${x.slug}"
          class="rounded-lg px-3 py-1.5 text-sm ${x.slug === slug ? 'bg-slate-900 font-medium text-white' : 'text-slate-600 hover:bg-slate-100'}"
          >${x.title}</a
        >`,
    )}
  </nav>`;
}

export function registerInteraction(app: FastifyInstance, ctx: ViewContext): void {
  const { interaction } = ctx;

  app.get<{ Params: { section?: string }; Querystring: { saved?: string; tested?: string; error?: string; bot?: string } }>(
    '/interaction/:section',
    async (req, reply) => {
      const slug = req.params.section ?? 'addressing';
      const meta = SECTIONS.find((x) => x.slug === slug);
      if (!meta) return reply.redirect('/interaction/addressing');

      const csrf = req.session?.csrfToken ?? '';

      // WHICH BOT this page is editing (CCB-S5-006). No `?bot=` means the shared values,
      // which is what a single-bot deployment always wants and what every existing
      // bookmark resolves to, so nothing changes for an operator with one bot.
      const botProfiles = await listBotOnboardingProfiles(ctx.db);
      const bots = botProfiles.map((b) => ({ id: b.id, displayName: b.displayName }));
      // ── ONE RESOLVER, NOT THIS PAGE'S OWN (CCB-S5-011) ────────────────
      //
      // This read `?bot=` and nothing else, so a selection made here did not survive a
      // move to the Personality page and back. `resolveSelectedBot` is the same answer
      // every settings page now gives: the URL when it names a bot, otherwise the
      // session's standing choice, otherwise the first bot.
      const selection = resolveSelectedBot(
        botProfiles,
        req.query.bot,
        req.session?.selectedBotProfileId ?? null,
      );
      const selectedBotId = selection.selectedId;
      const settingOverrides = await listAllSettingOverrides(ctx.db);
      const settingScopes = describeSettingScopes(settingOverrides, bots.length);

      // ── THE ROWS, NOT THE CACHE (CCB-S5-011) ─────────────────────────────
      //
      // This read `interaction.get(selectedBotId)`, and `get` answers with the SHARED record
      // on a cache miss. That is deliberate and correct for the reply path, where a bot
      // briefly reading what it inherits is a smaller wrong than reading nothing, and the
      // window is one query. It is exactly wrong for this page: `kickRefreshFor` is
      // fire-and-forget, so the FIRST request for any bot renders before the refresh lands
      // and shows the shared values under that bot's name. For a bot the operator just
      // created that is every time he looks, which is how selecting the new bot showed the
      // first bot's nicknames.
      //
      // It also fed the save. The form posts what it rendered, so an operator who opened a
      // new bot and pressed Save on any section would have written the SHARED values in as
      // that bot's own deviations, silently, and been unable to tell afterwards.
      //
      // The save path already read the rows and already carried this reasoning in a comment
      // next to it. The two halves of one page disagreeing about where the truth lives is
      // the defect; they agree now.
      // The selected bot's own rows, kept rather than consumed, because the wake word state
      // below is told from whether a row EXISTS and not from the resolved value (CCB-S5-030).
      const ownOverrides =
        selectedBotId === null ? [] : await listSettingOverridesForBot(ctx.db, selectedBotId);
      const selectedName =
        selectedBotId === null
          ? null
          : (bots.find((b) => b.id === selectedBotId)?.displayName ?? null);
      const s =
        selectedBotId === null
          ? interaction.get()
          : applySettingOverrides(
              interaction.get(),
              ownOverrides,
              // THE DISPLAY NAME, for the same reason this block reads the rows rather than
              // the cache: the reply path now resolves an absent wake word from the bot's own
              // name, and a page resolving it from the shared value would print one word while
              // the bot answered to another. That is the disagreement the comment above is
              // about, one setting further on.
              selectedName ?? undefined,
            );
      const wakeState =
        selectedBotId === null || selectedName === null
          ? null
          : wakeWordState(interaction.get(), ownOverrides, selectedName);

      // ── THE SELECTED BOT'S VOICE, FOR THE CONTEXT-SIZE CARD (D-229) ───────
      //
      // The rows, for the same reason everything above reads the rows: the reply path's
      // cache answers a miss with null and refreshes in the background, so the first load
      // for any bot would measure a prompt with no character in it and the second would
      // measure the real one, with nothing on the page distinguishing them.
      const personality = await previewPersonality(ctx.db, selectedBotId);
      // The DJ sheet for the same card and the same reason (D-220): the measured headroom
      // must count the has-music rules when this bot's prompt actually carries them.
      const music = await previewMusicFacts(ctx, selectedBotId);

      const notice = req.query.tested
        ? html`<div
            class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            Connection test passed. The configured Ollama model is available.
          </div>`
        : req.query.saved
        ? html`<div
            class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            Saved. Changes apply to the next message she hears — no restart needed.
          </div>`
        : req.query.error
          ? html`<div
              class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              ${req.query.error}
            </div>`
          : null;

      const form = (section: string, inner: SafeHtml): SafeHtml =>
        html`<form method="post" action="/interaction" class="flex flex-col gap-3">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="section" value="${section}" />
          ${selectedBotId === null
            ? html`<input type="hidden" name="botScope" value="shared" />`
            : html`<input type="hidden" name="botProfileId" value="${String(selectedBotId)}" />`}
          ${inner}
        </form>`;

      const cardsFor: Record<string, () => SafeHtml> = {
        addressing: () =>
          card(
            'Addressing',
            html`<p class="mb-3 text-sm text-slate-500">
                She answers to her name, and only to her name. A message is addressed to her when it
                <strong>starts</strong> with the wake word (an optional greeting may come first), when
                it replies directly to one of her messages, or inside the follow-up window. Talking
                <em>about</em> her is never an address.
              </p>
              ${form(
                'addressing',
                html`
                  ${checkbox('naturalAddressing', 'Natural addressing (she responds to her name)', s.naturalAddressing)}
                  <p class="text-xs text-slate-400">
                    The consent commands <code>/publish</code> and <code>/unpublish</code> are
                    always available and cannot be switched off. Withdrawing consent is not a
                    convenience feature, and the switch that used to disable them made
                    <code>/unpublish</code> do nothing and say nothing (CCB-S3-031).
                  </p>
                  ${selectedBotId === null && bots.length > 0
                    ? html`<p class="text-xs text-slate-500">
                        The wake word is per bot - it is her name, and two bots cannot share
                        one. Pick a bot above to change it.
                      </p>`
                    : html`${labelled('Wake word', textField('wakeWord', s.wakeWord), 'Her name. Rename her for your community — small typos in it are still understood.')}
                      ${wakeWordStateNote(wakeState)}`}
                  ${labelled('Greeting prefixes', textField('greetings', s.greetings.join(', ')), 'Comma separated. Allowed in front of the wake word and stripped before the instruction.')}
                  ${saveButton()}
                `,
              )}`,
          ),
        guards: () =>
          card(
            'Guards',
            html`<p class="mb-3 text-sm text-slate-500">
                Matching her name is not the same as being spoken to. Each guard can be switched off
                independently — turning them all off restores the behaviour that made her answer a
                forwarded announcement.
              </p>
              <p class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Since free conversation arrived, the three signal switches and the silence switch no
                longer decide whether she <em>answers</em>. When she has nothing to execute she now
                talks back in her own words first, and these settings decide what happens when the
                model cannot speak: either silence, or the canned "I could not find my words" line.
                They still decide nothing about consent, commands, or the deterministic replies.
              </p>
              <p class="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <strong>She is never completely silent when she was plainly addressed.</strong> The
                length guard below used to return nothing at all, and a long spell-check request that
                named her got no answer, no refusal and no sign she had seen it. It now stops the
                <em>command</em> and lets the message through to conversation. The only remaining
                silence is the switch above, and it needs three things at once: a weak signal, no
                command to run, and a model that could not speak.
              </p>
              ${form(
                'guards',
                html`
                  ${labelled('Addressing mode', selectField('addressingMode', s.addressing.mode, ADDRESSING_MODES.map((m) => [m, ADDRESSING_MODE_LABELS[m] ?? m] as [string, string])), 'Strict mode still allows direct replies, the follow-up window and slash commands.')}
                  ${checkbox('ignoreForwarded', 'Ignore forwarded messages', s.addressing.ignoreForwarded)}
                  ${checkboxWithHelp(
                    'silenceOnUnknown',
                    'Stay silent when the model cannot speak and the signal was weak',
                    s.addressing.silenceOnUnknown,
                    'Applies only after free conversation has already failed. On: she says nothing rather than a canned line to something that may not have been aimed at her. Off: she sends the "I could not find my words" reply instead.',
                  )}
                  ${checkboxWithHelp(
                    'strongSignalGreeting',
                    'A greeting is a strong signal (Hey CIND3R3LLA ...)',
                    s.addressing.strongSignalGreeting,
                    'A strong signal is what lets the canned line through when the model is unavailable. None of the three decides whether she converses.',
                  )}
                  ${checkbox('strongSignalReply', 'A direct reply is a strong signal', s.addressing.strongSignalReply)}
                  ${checkbox('strongSignalWindow', 'Being mid-conversation is a strong signal', s.addressing.strongSignalWindow)}
                  ${labelled('Confidence threshold', numberField('confidenceThreshold', s.confidenceThreshold, 0, 1, '0.05'), 'Below this she asks instead of acting. Higher is more cautious.')}
                  ${labelled('Maximum instruction length (characters)', numberField('maxInstructionLength', s.addressing.maxInstructionLength, 20, 4000), 'Longer than this and she will not EXECUTE a command unless the intent is very confident. She still answers: a long message she was plainly addressed in goes to free conversation instead. It never causes silence.')}
                  ${labelled('Confidence required above that length', numberField('lengthGuardConfidence', s.addressing.lengthGuardConfidence, 0, 1, '0.05'), 'Raise it to send more long text to conversation rather than to a command. It does not decide whether she replies, only whether a command may run.')}
                  ${labelled('Filler prefixes', textField('fillerPrefixes', s.fillerPrefixes.join(', ')), 'Short discourse words allowed before her name (so, hey, also). Comma separated.')}
                  ${labelled('Max filler words before the name', numberField('maxPrefixWords', s.maxPrefixWords, 0, 8))}
                  ${labelled('Max filler characters before the name', numberField('maxPrefixChars', s.maxPrefixChars, 0, 60))}
                  ${checkbox('logNearMisses', 'Record ignored messages (see Diagnostics)', s.addressing.logNearMisses)}
                  ${saveButton()}
                `,
              )}`,
          ),
        followup: () =>
          card(
            'Follow-up',
            html`<p class="mb-3 text-sm text-slate-500">
                After she replies, that member may keep talking for a short while without repeating
                her name. A brief elliptical follow-up can inherit the previous read-only intent —
                but only a known asset, never a fresh lookup, and never an interjection.
              </p>
              ${form(
                'followup',
                html`
                  ${labelled('Follow-up window (seconds)', numberField('followUpSeconds', s.followUpSeconds, 0, 3600), '0 disables it.')}
                  ${checkbox('intentCarryover', 'Let a short follow-up inherit the previous intent', s.intentCarryover)}
                  ${labelled('Interjection stop list', textField('carryOverStopWords', s.carryOverStopWords.join(', ')), 'Words that never carry an intent forward — nice, cool, thanks, danke … Comma separated.')}
                  ${saveButton()}
                `,
              )}`,
          ),
        memory: () =>
          card(
            'Memory',
            html`<p class="mb-3 text-sm text-slate-500">
                Until CCB-S4-044 every reply was written from the current message alone. She
                asked what she had just said, repeated herself, and once claimed to recall
                something nobody had told her. She can now see the recent thread.
              </p>
              <div class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p class="font-medium">What she can see</p>
                <ul class="mt-1 list-disc space-y-1 pl-5">
                  <li>The <strong>whole group thread</strong>, not only the messages of the
                    person she is answering, so she can react to what somebody else said a few
                    messages ago.</li>
                  <li><strong>Her own replies</strong>, marked as hers, so she can follow her
                    own thread.</li>
                </ul>
                <p class="mt-2 font-medium">What she cannot, ever</p>
                <ul class="mt-1 list-disc space-y-1 pl-5">
                  <li><strong>Destroyed messages.</strong> Destruction deletes the row, so
                    there is nothing to read. A destruction deferred by an evidence hold is
                    excluded too: the hold defers the erasure, never the intent.</li>
                  <li><strong>Deleted messages</strong>, whether the member deleted them in the
                    group or you marked them, and anything moderation rejected.</li>
                  <li><strong>Anything from a member who has revoked.</strong> This was a
                    judgement call and you should know which way it went: a revocation is the
                    strongest signal a member can send about their own words, and honouring it
                    on the public archive but not in her head would make it mean less than it
                    says. The cost is real. She still sees that member's CURRENT message, so
                    she can answer them; she cannot recall their earlier lines.</li>
                </ul>
              </div>
              <p class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>Everything she remembers is untrusted text.</strong> Anybody can type
                an instruction into this group and wait for her to read it later, which is a
                nastier trick than one in a search result because they choose the timing. The
                history reaches her as clearly quoted material, fenced and labelled, never as
                part of her instructions, and she is told plainly that she obeys nothing inside
                it. It can change no consent record, run no command and reach no moderation
                ladder. Raising the limits below raises how much of that she is holding at once.
              </p>
              ${form(
                'memory',
                html`
                  ${labelled('Messages she can see', numberField('memoryMaxMessages', s.memory.maxMessages, 0, MAX_HISTORY_LIMITS.maxMessages), `How many of the most recent messages, at most. 0 turns memory off entirely and is the way back if it ever misbehaves. Higher means a longer prompt and a slower reply.`)}
                  ${labelled('How far back (minutes)', numberField('memoryWindowMinutes', s.memory.windowMinutes, 0, MAX_HISTORY_LIMITS.windowMinutes), `Nothing older than this, whatever the count says. The tighter of the two wins. A long window in a quiet group costs nothing; in a busy one it is the count that binds.`)}
                  ${labelled('Hard character budget', numberField('memoryMaxChars', s.memory.maxChars, 0, MAX_HISTORY_LIMITS.maxChars), `The ceiling on the assembled history, independent of the other two, because a few long messages can fill the context on their own. When it binds, the oldest are dropped. Bounded at ${String(MAX_HISTORY_LIMITS.maxChars)} in code rather than here: a history that crowds her own rules out of the context would be a safety failure, not a slow reply.`)}
                  ${saveButton()}
                `,
              )}
              ${memorySizeCard(s, personality, selectedName, music)}`,
          ),
        language: () =>
          card(
            'Language',
            html`<p class="mb-3 text-sm text-slate-500">
                She answers in the language of the message she is answering. Only languages that have
                real persona copy are offered, never a machine-translated website locale.
              </p>
              <div class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p class="font-medium">How the language is decided, in order</p>
                <ol class="mt-1 list-decimal space-y-1 pl-5">
                  <li><strong>Fixed mode</strong> ends it: always the default below.</li>
                  <li>An <strong>open confirmation</strong> keeps its own language, so a question and
                    its answer never switch mid-exchange.</li>
                  <li>A <strong>function-word contest</strong> on the member's own words. German and
                    English words are counted against each other and the winner needs a clear lead,
                    so one stray <em>hallo</em> cannot carry a whole English announcement.</li>
                  <li>If the contest is inconclusive, <strong>German-only evidence</strong> decides: a
                    German imperative (<em>erkläre, zeige, gib</em>) or a German-only character
                    (ä, ö, ü, ß). This is what stops a short technical question like
                    <em>"erkläre Geheimdienstselektoren"</em> being answered in English, which is
                    exactly what used to happen: two words, no function words, nothing to count.</li>
                  <li>Otherwise the <strong>remembered language</strong> for that member, if the
                    switch below is on.</li>
                  <li>Otherwise the <strong>default</strong>.</li>
                </ol>
                <p class="mt-2">
                  Getting it wrong costs one reply in the wrong language and nothing else. It never
                  touches consent, and it never changes what a command does.
                </p>
              </div>
              ${form(
                'language',
                html`
                  ${labelled('Reply language mode', selectField('replyLanguageMode', s.replyLanguageMode, REPLY_LANGUAGE_MODES.map((m) => [m, REPLY_LANGUAGE_MODE_LABELS[m] ?? m] as [string, string])), 'Auto detects per message; falls back to the default when the text gives no clear signal.')}
                  ${labelled('Default language', textField('defaultLanguage', s.defaultLanguage), `Used when the instruction gives no clue. Available: ${Object.keys(s.persona).join(', ')}.`)}
                  ${checkbox('rememberMemberLanguage', "Remember a member's language for the follow-up window", s.rememberMemberLanguage)}
                  ${saveButton()}
                `,
              )}`,
          ),
        replies: () =>
          card(
            'Replies',
            html`<p class="mb-3 text-sm text-slate-500">
                She sends plain messages rather than quoting the member she answers. Confirmation
                prompts never quote, whatever this is set to.
              </p>
              ${form(
                'replies',
                html`
                  ${labelled('Reply mode', selectField('replyMode', s.replyMode, REPLY_MODES.map((m) => [m, REPLY_MODE_LABELS[m]] as [string, string])), 'Plain and Mention keep the group readable. Quote is the old behaviour.')}
                  ${checkbox('namePrefixEnabled', 'Use the name prefix (Mention mode only)', s.namePrefix.enabled)}
                  ${Object.keys(s.namePrefix.templates).sort().map((lang) => labelled(`Name prefix — ${langLabel(lang)}`, textField(`prefix:${lang}`, s.namePrefix.templates[lang] as string), "{name} is the member's display name. A single space is added after it."))}
                  ${labelled('Replies per member, per minute', numberField('replyLimitPerMember', s.replyLimitPerMember, 1, 120))}
                  ${labelled('Replies per chat, per minute', numberField('replyLimitPerChat', s.replyLimitPerChat, 1, 600))}
                  ${saveButton()}
                `,
              )}`,
          ),
        nicknames: () =>
          html`${card(
            'Nicknames',
            html`<p class="mb-3 text-sm text-slate-500">
                She does not answer to "Cindy". A nickname in the wake-word position earns a retort and
                <strong>nothing else</strong>. Retorts rotate without repeating the previous one.
              </p>
              ${form(
                'nicknames',
                html`
                  ${checkbox('enabled', 'Nickname retorts enabled', s.nicknames.enabled)}
                  ${labelled('Nicknames', textField('words', s.nicknames.words.join(', ')), 'Comma separated. Matched exactly, so short names never fire on ordinary words.')}
                  ${labelled('Anti-spam limit', numberField('spamLimit', s.nicknames.spamLimit, 1, 1000), 'Consecutive nicknames from one member before she stops answering. Set it high to let the nickname game run.')}
                  ${saveButton()}
                `,
              )}`,
          )}
          ${Object.keys(s.retorts)
            .sort()
            .map((lang) =>
              card(
                `Retorts — ${langLabel(lang)}`,
                form(`retorts:${lang}`, html`<p class="text-sm text-slate-500">One retort per line. Emptying the list restores the shipped twelve.</p>${textArea('retorts', (s.retorts[lang] as string[]).join('\n'), 12)} ${saveButton()}`),
              ),
            )}`,
        consent: () =>
          card(
            'Consent behaviour',
            html`<p class="mb-3 text-sm text-slate-500">
                Publishing and unpublishing by natural language always take two messages: she asks,
                the member agrees. Slash commands stay immediate.
              </p>
              ${form(
                'consent',
                html`
                  ${labelled('Affirmation words', textField('affirmations', s.affirmations.join(', ')), 'Comma separated. Fuzzy matched, so "jup" and "yeah" work without listing every spelling.')}
                  ${labelled('Decline words', textField('declines', s.declines.join(', ')), 'Comma separated. Cancels a pending confirmation.')}
                  ${labelled('Undo window (seconds)', numberField('undoWindowSeconds', s.undoWindowSeconds, 0, 86400), 'How long a member may undo their own last consent decision. 0 means no time limit.')}
                  ${saveButton()}
                `,
              )}`,
          ),
        voice: () =>
          html`${card(
            'Two voices, and which one this page sets',
            html`<p class="text-sm text-slate-600">
                <strong>This page is her deterministic voice.</strong> Every string below is a
                reply the application composes when a command or a consent decision produced an
                answer: what she says when someone publishes, when she reports a count, when she
                quotes a price. The local model may reword some of them, but the meaning is the
                application's and these strings are the source.
              </p>
              <p class="mt-3 text-sm text-slate-600">
                <strong>Her conversational voice is set elsewhere.</strong> When nobody asked her
                to do anything and she simply talks back, none of the copy below is used: there is
                no draft to follow. That voice is her base character and the four dials on the
                <a class="underline" href="/ai/personality">Personality page</a>, and since
                CCB-S4-031 the same dials shape her nickname retorts.
              </p>
              <p class="mt-3 text-xs text-slate-500">
                So rewriting every field on this page changes what she says when she is executing,
                and changes nothing about how she sounds when she is chatting.
              </p>`,
          )}
          ${Object.keys(s.persona)
            .sort()
            .map((lang) =>
              card(
                `Her voice — ${langLabel(lang)}`,
                form(`persona:${lang}`, html`<p class="text-sm text-slate-500">Chat only. Leave a field empty to restore its shipped default.</p>${PERSONA_KEYS.map((key) => labelled(PERSONA_META[key].label, textArea(key, (s.persona[lang] as Record<PersonaKey, string>)[key], 2), PERSONA_META[key].vars ? `Placeholders: ${PERSONA_META[key].vars}` : undefined))} ${saveButton()}`),
              ),
            )}
          ${card(
            'Help footer and attribution',
            form('links', html`${labelled('Archive link', textField('archiveUrl', s.archiveUrl, 'https://…'), 'Shown at the foot of the help reply. https only; blank hides it.')}${labelled('Project link', textField('projectUrl', s.projectUrl, 'https://…'), 'Shown at the foot of the help reply, and the link her attribution points at. https only; blank hides it.')}${labelled('Attribution label', textField('botLabel', s.botLabel, '(SimpleX AI Bot)'), 'Shown after her name in the help reply, e.g. what she is. Blank hides it.')} ${saveButton()}`),
          )}`,
        archiving: () => archiveCard(ctx.archive.get(), csrf),
        diagnostics: () => {
          const nearMisses = recentNearMisses(25);
          const conversations = recentConversations(25);
          const conversationStats = conversationSummary();
          const forged = recentForgedLines(25);
          const forgedTotal = forgedLineCount();
          const blocked = recentBlockedNames(25);
          const blockedTotal = blockedNameCount();
          const refusals = recentInventedRefusals(25);
          const refusalTotal = inventedRefusalCount();
          const refusalLost = refusals.filter((r) => r.cost !== 'stripped').length;
          // Counted over what is SHOWN, and the label says so. The buffer is capped and the
          // total is not, so presenting this as a share of the total would understate it the
          // moment the cap is reached.
          const blockedSilent = blocked.filter((b) => b.cost === 'silence').length;
          // Recomputed from the persona this page is already showing, so the card states
          // what is guarded RIGHT NOW rather than what was guarded at boot. The unguarded
          // count is the one that matters: it is how an operator finds out that rewording a
          // line to open with its placeholder removed the guard on it (CCB-S5-027).
          const guardedMarkers = markersFromTemplates(
            Object.values(s.persona).flatMap((strings) =>
              Object.values(strings as Record<string, string>).filter(
                (value): value is string => typeof value === 'string',
              ),
            ),
          );
          const runtime = aiRuntimeSnapshot();
          const metrics = runtime.metrics;
          const probe = runtime.probe;
          const averageLatency =
            metrics.averageLatencyMs === null ? '-' : `${metrics.averageLatencyMs.toFixed(1)} ms`;
          const lastLatency =
            metrics.lastLatencyMs === null ? '-' : `${metrics.lastLatencyMs.toFixed(1)} ms`;

          return html`${card(
            'AI runtime',
            html`<div class="mb-4 flex flex-wrap items-center gap-2">
                ${badge(runtime.enabled ? 'local AI active' : 'rules active', runtime.enabled ? 'green' : 'slate')}
                ${badge(
                  probe.ok === true
                    ? 'model reachable'
                    : probe.ok === false
                      ? 'model unreachable'
                      : 'not tested',
                  probe.ok === true ? 'green' : probe.ok === false ? 'red' : 'slate',
                )}
              </div>
              <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-slate-500">Active resolver</dt>
                <dd><code class="rounded bg-slate-100 px-1">${runtime.activeResolver}</code></dd>
                <dt class="text-slate-500">Environment permission</dt>
                <dd>${runtime.available ? 'enabled' : 'disabled'}</dd>
                <dt class="text-slate-500">Stored preference</dt>
                <dd>${runtime.requestedEnabled ? 'local AI' : 'rules'}</dd>
                <dt class="text-slate-500">Model</dt>
                <dd><code class="rounded bg-slate-100 px-1">${runtime.model || '-'}</code></dd>
                <dt class="text-slate-500">Private endpoint</dt>
                <dd><code class="rounded bg-slate-100 px-1">${runtime.baseUrl || '-'}</code></dd>
                <dt class="text-slate-500">Timeout</dt>
                <dd>${runtime.timeoutMs > 0 ? `${runtime.timeoutMs} ms` : '-'}</dd>
                <dt class="text-slate-500">Classifications</dt>
                <dd>${metrics.requests} total, ${metrics.successes} successful, ${metrics.fallbacks} rule fallback(s)</dd>
                <dt class="text-slate-500">Safety overrides</dt>
                <dd>${metrics.guardOverrides}</dd>
                <dt class="text-slate-500">Average / last latency</dt>
                <dd>${averageLatency} / ${lastLatency}</dd>
                <dt class="text-slate-500">Last successful call</dt>
                <dd>${fmtDate(metrics.lastSuccessAt)}</dd>
                <dt class="text-slate-500">Last failed call</dt>
                <dd>${fmtDate(metrics.lastFailureAt)}</dd>
                <dt class="text-slate-500">Last model / final intent</dt>
                <dd>${metrics.lastModelIntent ?? '-'} / ${metrics.lastFinalIntent ?? '-'}</dd>
                <dt class="text-slate-500">Last probe</dt>
                <dd>${fmtDate(probe.at)}${probe.latencyMs === null ? '' : ` (${probe.latencyMs.toFixed(1)} ms)`}</dd>
                <dt class="text-slate-500">Last error</dt>
                <dd class="break-all ${metrics.lastError || probe.error ? 'text-red-700' : 'text-slate-500'}">
                  ${metrics.lastError ?? probe.error ?? 'none'}
                </dd>
              </dl>
              ${runtime.available
                ? html`<form method="post" action="/interaction" class="mt-4 flex flex-wrap gap-2">
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    <input type="hidden" name="section" value="ai-runtime" />
                    <button
                      type="submit"
                      name="action"
                      value="test"
                      class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Test model
                    </button>
                    ${runtime.enabled
                      ? html`<button type="submit" name="action" value="disable" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100">Use rules</button>`
                      : html`<button type="submit" name="action" value="enable" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Use local AI</button>`}
                  </form>`
                : html`<p class="mt-4 text-sm text-amber-700">
                    Local AI is unavailable because <code>LOCAL_AI_ENABLED</code> is false. This
                    environment gate cannot be bypassed from the admin console.
                  </p>`}
              <p class="mt-3 text-xs text-slate-500">
                Enabling first probes the private endpoint and confirms that the configured model is
                installed. A model error never executes an action; the deterministic resolver handles
                that message instead. Disabling switches to rules before the preference is written.
              </p>`,
          )}
          ${card(
            'Recently ignored (near misses)',
            nearMisses.length === 0
              ? html`<p class="text-sm text-slate-500">Nothing ignored since the last restart. Messages the guards catch appear here with the reason.</p>`
              : html`<div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead>
                      <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th class="py-2 pr-3">When</th><th class="py-2 pr-3">Who</th><th class="py-2 pr-3">Why</th><th class="py-2 pr-3">Message</th><th class="py-2">Resolver</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${nearMisses.map((n) => html`<tr class="border-b border-slate-100 align-top">
                        <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${new Date(n.at).toISOString().replace('T', ' ').slice(0, 16)}</td>
                        <td class="py-2 pr-3">${n.who}</td>
                        <td class="py-2 pr-3 text-slate-600">${NEAR_MISS_REASONS[n.reason]}</td>
                        <td class="py-2 pr-3 text-slate-500">${n.excerpt}</td>
                        <td class="whitespace-nowrap py-2 text-slate-500">${n.intent ? `${n.intent} ${(n.confidence ?? 0).toFixed(2)}` : '—'}</td>
                      </tr>`)}
                    </tbody>
                  </table>
                </div>`,
          )}
          ${card(
            'Free conversation',
            html`<p class="mb-3 text-sm text-slate-500">
                When she answered in her own words rather than executing something. Content free
                on purpose: no member text and no generated reply is kept here, only that it
                happened, where, and how long the model took.
              </p>
              <dl class="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-slate-500">Since restart</dt>
                <dd>
                  ${conversationStats.total} attempt(s): ${conversationStats.spoken} answered,
                  ${conversationStats.rateLimited} dropped by the reply limit,
                  ${conversationStats.unavailable} with the model unable to speak
                </dd>
                <dt class="text-slate-500">Average model latency</dt>
                <dd>
                  ${conversationStats.averageLatencyMs === null
                    ? '-'
                    : `${conversationStats.averageLatencyMs.toFixed(1)} ms`}
                </dd>
              </dl>
              ${conversations.length === 0
                ? html`<p class="text-sm text-slate-500">
                    She has not held a free conversation since the last restart. Buffer holds the
                    most recent 50 and does not survive a restart.
                  </p>`
                : html`<div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead>
                        <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th class="py-2 pr-3">When</th><th class="py-2 pr-3">Chat</th><th class="py-2 pr-3">Outcome</th><th class="py-2">Model latency</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${conversations.map((c) => html`<tr class="border-b border-slate-100 align-top">
                          <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${new Date(c.at).toISOString().replace('T', ' ').slice(0, 16)}</td>
                          <td class="py-2 pr-3 text-slate-500">${String(c.groupId)}</td>
                          <td class="py-2 pr-3 ${c.outcome === 'spoken' ? 'text-slate-600' : 'text-amber-700'}">${CONVERSATION_OUTCOMES[c.outcome]}</td>
                          <td class="whitespace-nowrap py-2 text-slate-500">${c.latencyMs} ms</td>
                        </tr>`)}
                      </tbody>
                    </table>
                  </div>`}`,
          )}
          ${card(
            'Lines she wrote that are not hers to write',
            html`<p class="mb-3 text-sm text-slate-500">
                The source line, the warning count and every other persona line whose
                placeholders the application fills are written by the application, never by
                her. When a reply comes back containing one anyway it is removed before the
                message is composed, and the removal is counted here. She is not told off for
                it and the member never sees it; this is the only place it shows.
              </p>
              <dl class="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-slate-500">Removed since restart</dt>
                <dd class="${forgedTotal > 0 ? 'text-amber-700' : ''}">${forgedTotal}</dd>
                <dt class="text-slate-500">Guarded lines</dt>
                <dd>
                  ${guardedMarkers.markers.length} of this bot's persona lines carry a
                  placeholder and are guarded${guardedMarkers.unguarded.length > 0
                    ? html`; ${guardedMarkers.unguarded.length} start with one too early to
                        recognise and are <strong>not</strong> guarded`
                    : ''}
                </dd>
              </dl>
              ${forged.length === 0
                ? html`<p class="text-sm text-slate-500">
                    Nothing removed since the last restart. Buffer holds the most recent 50 and
                    does not survive a restart.
                  </p>`
                : html`<div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead>
                        <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th class="py-2 pr-3">When</th><th class="py-2 pr-3">Lane</th><th class="py-2 pr-3">Where</th><th class="py-2">What was removed</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${forged.map((f) => html`<tr class="border-b border-slate-100 align-top">
                          <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${new Date(f.at).toISOString().replace('T', ' ').slice(0, 16)}</td>
                          <td class="py-2 pr-3 text-slate-500">${f.kind}</td>
                          <td class="py-2 pr-3 text-slate-500">${f.where === 'line' ? 'own line' : 'end of a sentence'}</td>
                          <td class="py-2 text-slate-600">${f.text}</td>
                        </tr>`)}
                      </tbody>
                    </table>
                  </div>`}`,
          )}
          ${card(
            'The member name taken out of her answers',
            html`<p class="mb-3 text-sm text-slate-500">
                A reply may not carry the display name of the member who just spoke. Nothing
                tells her that name directly; she reads it off the conversation history,
                where every message is rendered with its speaker in front of it. The name is
                now taken OUT instead of the whole reply being thrown away: a vocative like
                "Alice, good question" loses the address, an inline mention becomes second
                person, and the rest of the answer ships. Only when the strip cannot get the
                name out is the reply rejected as before - then a lane with a fallback line
                sends that, and free conversation loses the answer, which is the expensive
                case and counted separately.
              </p>
              <dl class="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-slate-500">Names caught since restart</dt>
                <dd class="${blockedTotal > 0 ? 'text-amber-700' : ''}">${blockedTotal}</dd>
                <dt class="text-slate-500">Answers lost outright</dt>
                <dd class="${blockedSilent > 0 ? 'text-amber-700' : ''}">
                  ${blockedSilent} of the most recent ${blocked.length} left the member with
                  nothing at all
                </dd>
                <dt class="text-slate-500">Shortest name guarded</dt>
                <dd>
                  ${MIN_BLOCKED_NAME_CHARS} characters, matched as a whole word. A shorter
                  display name is not guarded, because below that a name cannot be told from
                  an ordinary word and every reply containing one would be destroyed.
                </dd>
              </dl>
              ${blocked.length === 0
                ? html`<p class="text-sm text-slate-500">
                    Nothing rejected since the last restart. Buffer holds the most recent 50 and
                    does not survive a restart.
                  </p>`
                : html`<div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead>
                        <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th class="py-2 pr-3">When</th><th class="py-2 pr-3">Lane</th><th class="py-2 pr-3">Name</th><th class="py-2 pr-3">Cost</th><th class="py-2">What she had written</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${blocked.map((b) => html`<tr class="border-b border-slate-100 align-top">
                          <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${new Date(b.at).toISOString().replace('T', ' ').slice(0, 16)}</td>
                          <td class="py-2 pr-3 text-slate-500">${b.kind}</td>
                          <td class="py-2 pr-3 text-slate-600">${b.literal}</td>
                          <td class="py-2 pr-3 ${b.cost === 'silence' ? 'text-amber-700' : 'text-slate-500'}">${b.cost === 'stripped' ? 'name removed, reply shipped' : b.cost === 'silence' ? 'answer lost' : 'fell back to a draft'}</td>
                          <td class="py-2 text-slate-600">${b.text}</td>
                        </tr>`)}
                      </tbody>
                    </table>
                  </div>`}`,
          )}
          ${card(
            'Refusals she invented',
            html`<p class="mb-3 text-sm text-slate-500">
                A sentence is removed when it refuses, first person, a capability this
                bot actually holds - "I won't look it up for you" from a bot whose web
                lookup is on. The judgment is deterministic, against the bot's own
                capability catalog, so a refusal that is TRUE for this bot always
                stands. Usually the rest of the answer ships without the lying
                sentence; when nothing survives, the member gets the fallback line or
                nothing, and that is counted separately because it is the expensive
                case.
              </p>
              <dl class="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-slate-500">Removed since restart</dt>
                <dd class="${refusalTotal > 0 ? 'text-amber-700' : ''}">${refusalTotal}</dd>
                <dt class="text-slate-500">Answers lost with them</dt>
                <dd class="${refusalLost > 0 ? 'text-amber-700' : ''}">
                  ${refusalLost} of the most recent ${refusals.length} left nothing worth
                  sending after the strip
                </dd>
              </dl>
              ${refusals.length === 0
                ? html`<p class="text-sm text-slate-500">
                    Nothing removed since the last restart. Buffer holds the most recent 50
                    and does not survive a restart.
                  </p>`
                : html`<div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                      <thead>
                        <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th class="py-2 pr-3">When</th><th class="py-2 pr-3">Lane</th><th class="py-2 pr-3">Refused</th><th class="py-2 pr-3">Cost</th><th class="py-2">The sentence removed</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${refusals.map((r) => html`<tr class="border-b border-slate-100 align-top">
                          <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${new Date(r.at).toISOString().replace('T', ' ').slice(0, 16)}</td>
                          <td class="py-2 pr-3 text-slate-500">${r.kind}</td>
                          <td class="py-2 pr-3 text-slate-600">${r.ability}</td>
                          <td class="py-2 pr-3 ${r.cost === 'stripped' ? 'text-slate-500' : 'text-amber-700'}">${r.cost === 'stripped' ? 'sentence removed, rest shipped' : r.cost === 'draft' ? 'fell back to a draft' : 'answer lost'}</td>
                          <td class="py-2 text-slate-600">${r.text}</td>
                        </tr>`)}
                      </tbody>
                    </table>
                  </div>`}`,
          )}
          ${card(
            'Reset',
            html`<p class="mb-3 text-sm text-slate-500">Restores every interaction setting to the values CIND3R3LLA ships with. Consent data is untouched.</p>
              ${form('reset', html`<button type="submit" class="self-start rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">Restore defaults</button>`)}`,
          )}`;
        },
      };

      const submenu = interactionSectionsNav(slug);

      const body = html`
        ${pageHeader(`Interaction — ${meta.title}`, meta.desc)} ${submenu} ${notice}
        <div class="flex flex-col gap-6">
          ${interactionScopePanel(slug, settingScopes, bots, selectedBotId, slug)}
          ${cardsFor[slug]?.()}
        </div>
      `;

      reply.type('text/html');
      return page({
        title: `Interaction — ${meta.title}`,
        active: `interaction:${slug}`,
        csrfToken: csrf,
        // Every section of this page edits one bot, so every section carries the switcher.
        botSwitcher: { ...selection, returnTo: `/interaction/${slug}`, scope: 'mixed' },
        body,
      });
    },
  );

  // Old bookmarks and any link to the un-suffixed page land on the first section.
  app.get('/interaction', async (_req, reply) => reply.redirect('/interaction/addressing'));

  app.post('/interaction', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const section = bodyString(body, 'section');
    const actor = req.session?.username ?? 'unknown';
    /**
     * WHICH BOT IS BEING EDITED, decided BEFORE the merge rather than after it (CCB-S5-006).
     *
     * `next` has to start from the settings this save is editing. For the shared record that
     * is the shared one; for a bot it is that bot's own effective settings, and the difference
     * is not cosmetic. A page can carry two per-bot settings edited by two different forms:
     * Nicknames has the word list and the retorts, Voice has the persona and the label. The
     * loop below writes an override for every per-bot key on the page, so starting from the
     * shared record made each unsubmitted one compare equal to shared and CLEAR the bot's
     * deviation. Saving the retorts form wiped the bot's nickname list; saving the links form
     * wiped its persona.
     */
    const requested = Number.parseInt(bodyString(body, 'botProfileId'), 10);
    const targetBot = Number.isSafeInteger(requested) && requested > 0 ? requested : null;
    // The explicit shared view (D-228). A save from `?bot=shared` must land back ON the
    // shared view: the redirect used to drop the parameter, so after saving (or being
    // refused) the operator was silently looking at his session bot again - the same
    // stale-surface shape as the per-bot redirect before it gained `&bot=` at 1652.
    const sharedRequested = targetBot === null && bodyString(body, 'botScope') === 'shared';

    // Which section PAGE a save should return to (CCB-S3-015 Stage 1).
    const pageFor = (sec: string): string => {
      if (sec.startsWith('persona:') || sec === 'links') return 'voice';
      if (sec.startsWith('retorts:')) return 'nicknames';
      if (sec === 'archive') return 'archiving';
      if (sec === 'reset') return 'diagnostics';
      if (sec === 'ai-runtime') return 'diagnostics';
      return sec;
    };
    const back = (extra: string): string =>
      `/interaction/${pageFor(section)}${extra}${sharedRequested ? '&bot=shared' : ''}`;

    try {
      // Read INSIDE the try, and read the rows rather than the cache. `interaction.get(id)`
      // answers with the shared record on a cache miss, which is the right trade for a reply
      // and the wrong one for a save: it would silently rebase this bot on shared values and
      // clear every deviation the form did not carry. A read that fails throws to the handler
      // below and the operator is told, instead of losing settings quietly.
      const next = cloneSettings(
        targetBot === null
          ? interaction.get()
          : applySettingOverrides(
              interaction.get(),
              await listSettingOverridesForBot(ctx.db, targetBot),
            ),
      );

      if (section === 'addressing') {
        // REFUSED HERE, not left to the normalizer (CCB-S5-013). `normalizeInteraction`
        // must always produce a usable wake word, so an unusable one falls back to the
        // shipped default: saving "Rick Sanchez" would have silently renamed the bot to
        // Cinderella under a "Saved." banner, which is the masking this repo forbids. The
        // reason comes from `wakeWordProblem`, so this page and bot creation print the
        // same sentence rather than inventing two.
        //
        // VALIDATED ONLY WHEN SUBMITTED (D-228): the shared view does not render the
        // field, because the wake word is per bot (CCB-S5-006) and the shared record may
        // legitimately hold none - demanding one there made every shared addressing save
        // refuse for a field the operator could not see the point of.
        if (typeof body['wakeWord'] === 'string') {
          const problem = wakeWordProblem(bodyString(body, 'wakeWord'));
          if (problem !== null) throw new Error(problem);
          next['wakeWord'] = bodyString(body, 'wakeWord');
        }
        next['naturalAddressing'] = 'naturalAddressing' in body;
        next['greetings'] = bodyString(body, 'greetings');
      } else if (section === 'guards') {
        next['addressing'] = {
          mode: bodyString(body, 'addressingMode'),
          ignoreForwarded: 'ignoreForwarded' in body,
          silenceOnUnknown: 'silenceOnUnknown' in body,
          strongSignalGreeting: 'strongSignalGreeting' in body,
          strongSignalReply: 'strongSignalReply' in body,
          strongSignalWindow: 'strongSignalWindow' in body,
          maxInstructionLength: bodyString(body, 'maxInstructionLength'),
          lengthGuardConfidence: bodyString(body, 'lengthGuardConfidence'),
          logNearMisses: 'logNearMisses' in body,
        };
        next['confidenceThreshold'] = bodyString(body, 'confidenceThreshold');
        next['fillerPrefixes'] = bodyString(body, 'fillerPrefixes');
        next['maxPrefixWords'] = bodyString(body, 'maxPrefixWords');
        next['maxPrefixChars'] = bodyString(body, 'maxPrefixChars');
      } else if (section === 'followup') {
        next['followUpSeconds'] = bodyString(body, 'followUpSeconds');
        next['intentCarryover'] = 'intentCarryover' in body;
        next['carryOverStopWords'] = bodyString(body, 'carryOverStopWords');
      } else if (section === 'memory') {
        next['memory'] = {
          maxMessages: bodyString(body, 'memoryMaxMessages'),
          windowMinutes: bodyString(body, 'memoryWindowMinutes'),
          maxChars: bodyString(body, 'memoryMaxChars'),
        };
      } else if (section === 'language') {
        next['replyLanguageMode'] = bodyString(body, 'replyLanguageMode');
        next['defaultLanguage'] = bodyString(body, 'defaultLanguage');
        next['rememberMemberLanguage'] = 'rememberMemberLanguage' in body;
      } else if (section === 'replies') {
        next['replyMode'] = bodyString(body, 'replyMode');
        const templates: Record<string, string> = {};
        for (const key of Object.keys(body)) {
          if (key.startsWith('prefix:')) templates[key.slice('prefix:'.length)] = bodyString(body, key);
        }
        next['namePrefix'] = { enabled: 'namePrefixEnabled' in body, templates };
        next['replyLimitPerMember'] = bodyString(body, 'replyLimitPerMember');
        next['replyLimitPerChat'] = bodyString(body, 'replyLimitPerChat');
      } else if (section === 'nicknames') {
        next['nicknames'] = {
          enabled: 'enabled' in body,
          words: bodyString(body, 'words'),
          spamLimit: bodyString(body, 'spamLimit'),
        };
      } else if (section === 'consent') {
        next['affirmations'] = bodyString(body, 'affirmations');
        next['declines'] = bodyString(body, 'declines');
        next['undoWindowSeconds'] = bodyString(body, 'undoWindowSeconds');
      } else if (section === 'links') {
        next['archiveUrl'] = bodyString(body, 'archiveUrl');
        next['projectUrl'] = bodyString(body, 'projectUrl');
        next['botLabel'] = bodyString(body, 'botLabel');
      } else if (section.startsWith('persona:')) {
        const lang = section.slice('persona:'.length);
        const persona = (next['persona'] ?? {}) as Record<string, Record<string, string>>;
        const strings: Record<string, string> = {};
        for (const key of PERSONA_KEYS) strings[key] = bodyString(body, key);
        // The help field is a TEMPLATE the machine fills (CCB-S3-021 §3). A non-blank
        // help must keep {commands} and {consent}, or the reply would ship with no
        // command list or no publishing properties. Reject and name what is missing,
        // rather than silently saving a broken help. Blank is fine (restores default).
        const missing = missingHelpPlaceholders(strings['help'] ?? '');
        if (missing.length > 0) {
          throw new Error(
            `The Help reply is missing a required placeholder: ${missing.join(', ')}. ` +
              `Add it back, or clear the field to restore the default.`,
          );
        }
        persona[lang] = strings;
        next['persona'] = persona;
      } else if (section.startsWith('retorts:')) {
        const lang = section.slice('retorts:'.length);
        const retorts = (next['retorts'] ?? {}) as Record<string, unknown>;
        retorts[lang] = bodyString(body, 'retorts');
        next['retorts'] = retorts;
      } else if (section === 'archive') {
        const categories: Record<string, boolean> = {};
        for (const c of REPLY_CATEGORIES) categories[c] = `cat:${c}` in body;
        const memberCategories: Record<string, boolean> = {};
        for (const c of MEMBER_CATEGORIES) memberCategories[c] = `mcat:${c}` in body;
        await ctx.archive.save(
          {
            publishBotMessages: 'publishBotMessages' in body,
            stripMediaMetadata: 'stripMediaMetadata' in body,
            mentionGuard: bodyString(body, 'mentionGuard'),
            categories,
            memberCategories,
          },
          actor,
        );
        return reply.redirect(back('?saved=1'));
      } else if (section === 'reset') {
        await interaction.save(DEFAULT_INTERACTION, actor);
        return reply.redirect(back('?saved=1'));
      } else if (section === 'ai-runtime') {
        const action = bodyString(body, 'action');
        if (action === 'test') {
          await testAiRuntimeConnection();
          return reply.redirect(back('?tested=1'));
        }
        if (action === 'enable') {
          await setAiRuntimeEnabled(true, actor);
          return reply.redirect(back('?saved=1'));
        }
        if (action === 'disable') {
          await setAiRuntimeEnabled(false, actor);
          return reply.redirect(back('?saved=1'));
        }
        throw new Error('Unknown local AI runtime action.');
      } else {
        return reply.redirect(`/interaction/addressing?error=${encodeURIComponent('Unknown section.')}`);
      }

      // ── SHARED SAVE, OR ONE BOT'S DEVIATION (CCB-S5-006) ──────────────────
      //
      // The whole `next` object has already been parsed by the section handlers above, so
      // this reuses every one of them rather than adding a second parser that would drift.
      // What it changes is WHERE the result goes: with a bot selected, only the per-bot
      // keys are written, as deviations, and a value equal to the shared one CLEARS the
      // deviation rather than storing a copy of it. Storing the copy would freeze that bot
      // at today's shared value and quietly stop later shared edits reaching it.
      if (targetBot !== null) {
        const shared = interaction.get();
        /**
         * NORMALIZED BEFORE IT IS STORED (CCB-S5-006).
         *
         * This file's first rule is that everything arriving from the admin form is untrusted
         * and `normalizeInteraction` clamps it. The per-bot branch was skipping that entirely,
         * because it read out of the merged form data and returned before the shared save that
         * normalizes. Measured, it stored a confidence threshold as the string "0.9", a
         * nickname list as one newline-joined string that `for (const nick of ...)` then walked
         * CHARACTER BY CHARACTER, and a wake word with the operator's spaces still on it. The
         * bot with the deviation was the one running on unclamped values, which is the wrong
         * way round.
         */
        const normalized = normalizeInteraction(next);
        // What this bot's wake word would be if it followed its own name (CCB-S5-030). Null
        // when nothing usable derives, in which case the shared value stays the baseline.
        const derivedWake = wakeWordForNewBot((await botDisplayName(ctx.db, targetBot)) ?? '');
        let written = 0;
        let cleared = 0;
        for (const placement of SETTING_SCOPES) {
          if (placement.scope !== 'per-bot') continue;
          if (placement.section !== pageFor(section)) continue;
          // Retorts are the one setting where blank is a VALUE rather than a request for the
          // shipped default; see `retortsForBot`.
          const submitted =
            placement.key === 'retorts'
              ? retortsForBot(next['retorts'], normalized)
              : readPath(normalized, placement.key);
          // WHAT COUNTS AS "NO DEVIATION" DIFFERS FOR THE WAKE WORD (CCB-S5-030).
          //
          // Every other setting falls back to the SHARED value, so submitting the shared value
          // means "I have not deviated" and the row goes. The wake word falls back to the
          // bot's own DISPLAY NAME, so the value meaning "I have not deviated" is the one
          // derived from that name. Comparing against the shared value here would keep a row
          // for every bot whose wake word is its own name, which is every bot, and freeze it
          // at today's spelling exactly as creation used to.
          //
          // Case-insensitively, matching how detectAddress and wakeWordTakenBy compare: a word
          // differing only in case is the same word and should not pin a bot to it.
          const baseline =
            placement.key === 'wakeWord' && derivedWake !== null
              ? derivedWake
              : readPath(shared, placement.key);
          const unchanged =
            placement.key === 'wakeWord'
              ? typeof submitted === 'string' &&
                typeof baseline === 'string' &&
                submitted.toLocaleLowerCase() === baseline.toLocaleLowerCase()
              : JSON.stringify(submitted) === JSON.stringify(baseline);
          if (unchanged) {
            if (await clearSettingOverride(ctx.db, targetBot, placement.key)) cleared++;
          } else {
            await setSettingOverride(ctx.db, targetBot, placement.key, submitted);
            written++;
          }
        }
        // Every bot's effective settings derive from the shared record plus its own rows,
        // so the cache has to drop or the next message answers from the old wake word.
        interaction.invalidate();
        await writeAudit(ctx.db, actor, 'interaction.per-bot.update', `bot-profile:${targetBot}`, {
          section: pageFor(section),
          written,
          cleared,
        });
        return reply.redirect(`${back('?saved=1')}&bot=${String(targetBot)}`);
      }

      await interaction.save(next, actor);
      return reply.redirect(back('?saved=1'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save these settings.';
      return reply.redirect(back(`?error=${encodeURIComponent(message)}`));
    }
  });
}

/** Re-exported so the shipped language list stays a single source of truth. */
export { SHIPPED_LANGS };
