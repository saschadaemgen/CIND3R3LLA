/**
 * The Personality page (CCB-S4-029, D-133): who a bot is, and the four dials that
 * decide how it sounds.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────
 *
 * Until this briefing the page was a `personalityBody()` inside `ai.ts` that rendered
 * a definition list whose own rows read "Permanent personality profile: Not configured"
 * beside a roadmap of unbuilt things. It is now an editor with a write path, and
 * `ai.ts` was already 2000 lines of read-only status. It keeps the AI section's chrome
 * by importing `renderAiPage` rather than by copying it.
 *
 * ── WHAT THE OPERATOR CAN SEE HERE, AND WHY IT MATTERS ───────────────────────
 *
 * The page shows the actual voice lines the conversation prompt is built from, for the
 * SAVED values. That is deliberate: this whole briefing exists because a slider that
 * renders but does not change behaviour is the failure to avoid, and the cheapest
 * possible proof that a dial reaches the model is to show the operator the text the
 * model gets. When the dial moves, that block changes; if it ever did not, the page
 * would say so in plain sight.
 *
 * The permissiveness ceiling is rendered too, and it is NOT a form control. It is not
 * editable here or anywhere, because it is not configuration.
 */

import type { FastifyInstance } from 'fastify';
import {
  AXIS_DEFINITIONS,
  AXIS_MAX,
  AXIS_MIN,
  BASE_CHARACTER_MAX_CHARS,
  PERMISSIVENESS_CEILING,
  PERSONALITY_AXES,
  bandFor,
  conversationVoice,
  referenceFor,
  type BotPersonality,
  type PersonalityAxis,
} from '../../interaction/personality.js';
import { aiRuntimeSnapshot } from '../../interaction/ai-runtime.js';
import {
  listBotOnboardingProfiles,
  updateBotPersonality,
  type BotOnboardingProfile,
} from '../../profiles/bot-onboarding.js';
import { invalidateBotPersonality } from '../../profiles/bot-personality.js';
import { html, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card } from './ui.js';
import { renderAiPage, type AiPageQuery } from './ai.js';

interface PersonalityQuery extends AiPageQuery {
  /** Which bot profile is being edited. Defaults to the runtime one. */
  bot?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The profile the page is editing.
 *
 * Defaults to the runtime bot rather than to the first row, because that is the one
 * whose personality is actually reaching members. `listBotOnboardingProfiles` already
 * orders `selected_for_runtime` first, so the default falls out of the query.
 */
function selectedProfile(
  profiles: BotOnboardingProfile[],
  requested: string | undefined,
): BotOnboardingProfile | null {
  if (profiles.length === 0) return null;
  const id = Number.parseInt(requested ?? '', 10);
  return profiles.find((profile) => profile.id === id) ?? profiles[0]!;
}

function whichBotCard(
  profiles: BotOnboardingProfile[],
  active: BotOnboardingProfile,
  csrf: string,
): SafeHtml {
  return card(
    'Bot being edited',
    html`
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-lg font-semibold text-slate-900">${active.displayName}</span>
        <code class="text-xs text-slate-500">${active.slug}</code>
        ${active.selectedForRuntime
          ? badge('primary runtime bot', 'green')
          : badge('not the runtime bot', 'amber')}
      </div>
      <p class="mt-2 text-sm text-slate-600">
        ${active.selectedForRuntime
          ? 'This is the profile the conversation prompt is built from. Saving here changes how she sounds on her next reply, with no restart.'
          : 'This profile is stored but is not the one the runtime hosts, so saving here changes nothing a member hears until it becomes the primary runtime bot.'}
      </p>
      ${profiles.length > 1
        ? html`<form method="get" action="/ai/personality" class="mt-4 flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1 text-sm">
              <span class="font-medium text-slate-700">Edit a different bot</span>
              <select
                name="bot"
                class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:w-72"
              >
                ${profiles.map(
                  (profile) =>
                    html`<option
                      value="${String(profile.id)}"
                      ${profile.id === active.id ? raw('selected') : ''}
                    >
                      ${profile.displayName}${profile.selectedForRuntime ? ' (runtime)' : ''}
                    </option>`,
                )}
              </select>
            </label>
            <button
              type="submit"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open
            </button>
          </form>`
        : null}
      <input type="hidden" name="_csrf" value="${csrf}" />
    `,
  );
}

/** One dial: the range input, its live readout, and the guidance for the saved value. */
function axisControl(axis: PersonalityAxis, value: number): SafeHtml {
  const definition = AXIS_DEFINITIONS[axis];
  // The client-side readout needs the same band text the prompt uses, so it is handed
  // over as data rather than reimplemented in the asset. One source, two readers.
  const bands = JSON.stringify(definition.bands.map((band) => [band.upTo, band.guidance]));

  return html`<div class="personality-axis" data-personality-axis="${axis}">
    <div class="personality-axis-head">
      <label class="personality-axis-label" for="axis-${axis}">${definition.label}</label>
      <output class="personality-axis-value" data-personality-value>${String(value)}</output>
    </div>
    <p class="personality-axis-summary">${definition.summary}</p>
    <input
      id="axis-${axis}"
      class="personality-slider"
      type="range"
      name="${axis}"
      min="${String(AXIS_MIN)}"
      max="${String(AXIS_MAX)}"
      step="1"
      value="${String(value)}"
      data-personality-bands="${bands}"
    />
    <div class="personality-axis-ends">
      <span>${String(AXIS_MIN)} ${definition.lowLabel}</span>
      <span>${definition.highLabel} ${String(AXIS_MAX)}</span>
    </div>
    <p class="personality-axis-guidance" data-personality-guidance>${bandFor(axis, value).guidance}</p>
    <details class="personality-axis-references">
      <summary>Calibration: ${definition.situation}</summary>
      <ul>
        ${definition.references.map(
          (reference) =>
            html`<li>
              <strong>${String(reference.at)} of 10</strong>
              <span
                >"${reference.reply}"${reference.at === referenceFor(axis, value).at
                  ? ' (anchored at the saved value)'
                  : ''}</span
              >
            </li>`,
        )}
      </ul>
    </details>
  </div>`;
}

function editorCard(active: BotOnboardingProfile, csrf: string): SafeHtml {
  const personality = active.personality;

  return card(
    'Character and voice',
    html`<form method="post" action="/ai/personality" class="flex flex-col gap-5">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="id" value="${String(active.id)}" />

      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium text-slate-700">Base character</span>
        <textarea
          name="baseCharacter"
          rows="5"
          maxlength="${String(BASE_CHARACTER_MAX_CHARS)}"
          placeholder="Who she is, in your own words. This outranks any generic idea of a chat assistant."
          class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        >
${personality.baseCharacter}</textarea
        >
        <span class="text-xs text-slate-500">
          Up to ${String(BASE_CHARACTER_MAX_CHARS)} characters, sent at the top of every
          conversation prompt. Leaving it empty is a valid choice and reads as not configured:
          she then falls back to a plain cyberpunk framing and the dials alone.
        </span>
      </label>

      <div class="personality-axes">
        ${PERSONALITY_AXES.map((axis) => axisControl(axis, personality[axis]))}
      </div>

      <button
        type="submit"
        class="self-start rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        Save personality
      </button>
    </form>`,
  );
}

/**
 * The limit, stated where an operator dialling permissiveness to 10 will read it.
 *
 * Rendered from the same constant the prompt uses, so this card cannot drift into
 * describing a boundary the code does not send.
 */
function ceilingCard(): SafeHtml {
  return card(
    'The limit that is not a dial',
    html`
      <p class="text-sm text-slate-600">
        Permissiveness scales how cheeky she is <strong>below</strong> a fixed line. It does not
        move the line, and no value of it can. These four sentences are sent on every
        conversation prompt, at every dial value, and also when no personality is configured at
        all.
      </p>
      <ul class="mt-3 space-y-2 text-sm text-slate-700">
        ${PERMISSIVENESS_CEILING.map((line) => html`<li>${line}</li>`)}
      </ul>
    `,
  );
}

/** What the model is actually told, for the SAVED values. The proof the dial reaches it. */
function promptCard(personality: BotPersonality, botName: string): SafeHtml {
  return card(
    'What the model is told',
    html`
      <p class="text-sm text-slate-600">
        The voice section of the conversation prompt, built from the values saved above. Her name
        comes from the wake word on the
        <a class="underline" href="/interaction/addressing">Addressing page</a>, not from here.
        Command replies do not use this: they rephrase a decision the application already made,
        and the personality has no reach into those.
      </p>
      <pre class="personality-prompt">${conversationVoice(personality, botName).join('\n')}</pre>
    `,
  );
}

function emptyBody(): SafeHtml {
  return card(
    'No bot profile yet',
    html`
      <p class="text-sm text-slate-600">
        A personality belongs to a bot, and there is no bot profile to dial. Create one first, and
        give it a base character while you are there.
      </p>
      <a
        class="mt-3 inline-flex rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        href="/ai/onboarding"
        >Open the bot setup</a
      >
    `,
  );
}

function body(
  profiles: BotOnboardingProfile[],
  requested: string | undefined,
  csrf: string,
  botName: string,
): SafeHtml {
  const active = selectedProfile(profiles, requested);
  if (!active) return emptyBody();

  return html`
    ${whichBotCard(profiles, active, csrf)}
    <div class="mt-4">${editorCard(active, csrf)}</div>
    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      ${ceilingCard()} ${promptCard(active.personality, botName)}
    </div>
  `;
}

export function registerAiPersonality(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{ Querystring: PersonalityQuery }>('/ai/personality', async (req, reply) => {
    const profiles = await listBotOnboardingProfiles(ctx.db);
    reply.type('text/html');

    return renderAiPage(
      'AI Personality',
      'Her base character and the four dials that decide how she sounds when she is talking rather than executing.',
      'ai:personality',
      req.session?.csrfToken ?? '',
      req.query,
      aiRuntimeSnapshot(),
      // Her name comes from the Addressing page's wake word, not from this page, and
      // the preview must show the prompt that is actually built or it would be a
      // second implementation of it that can quietly disagree (CCB-S4-030).
      body(profiles, req.query.bot, req.session?.csrfToken ?? '', ctx.interaction.get().wakeWord),
      html`<script src="/assets/admin-personality.js" defer></script>`,
    );
  });

  app.post<{ Body: Record<string, unknown> }>('/ai/personality', async (req, reply) => {
    const id = Number.parseInt(text(req.body['id']), 10);
    const back = Number.isSafeInteger(id) && id > 0 ? `?bot=${id}` : '';

    try {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('No bot profile was selected.');

      await updateBotPersonality(
        ctx.db,
        id,
        // The four axes arrive as strings from range inputs. `updateBotPersonality`
        // normalizes and clamps, so a tampered value is bounded rather than fatal, and
        // the DDL refuses anything that somehow gets past that.
        {
          baseCharacter: text(req.body['baseCharacter']),
          sharpness: text(req.body['sharpness']),
          warmth: text(req.body['warmth']),
          humor: text(req.body['humor']),
          permissiveness: text(req.body['permissiveness']),
        },
        req.session?.username ?? 'unknown',
      );

      // The reply path caches the personality, so the save has to say so. Without this
      // an operator would move a slider, talk to her, and hear the old voice.
      invalidateBotPersonality();

      return reply.redirect(`/ai/personality${back}${back ? '&' : '?'}saved=1`);
    } catch (error) {
      return reply.redirect(
        `/ai/personality${back}${back ? '&' : '?'}error=` +
          encodeURIComponent(errorMessage(error)),
      );
    }
  });
}
