/**
 * The Recital page (CCB-S4-047, D-149): the Book as a performance.
 *
 * ── WHAT THIS PAGE IS FOR ────────────────────────────────────────────────────
 *
 * The Book page answers "what are her rules". This one answers "what does a member actually
 * hear when they ask for them", which is a different question with a different failure mode.
 * Every check on the recital can be green while the reading is wrong: chapters in an order
 * that makes no sense, an image nobody assigned, a bound that quietly drops two chapters, or
 * a law sitting in no chapter at all and therefore never read.
 *
 * So the page shows the PLAN, not the configuration: the beats in order, what each one holds,
 * how many rules it leaves unread, and, loudly, which nameable rules no chapter claims. That
 * last one exists because of D-105. A rule a later migration adds lands in a family's chapter
 * automatically; a rule in a NEW family lands nowhere, the recital keeps working, and nothing
 * would say a law had stopped being read out.
 *
 * ── AND WHY THE IMAGE ARRIVES AS BASE64 ──────────────────────────────────────
 *
 * The console has no multipart parser. Adding one means a new dependency parsing
 * attacker-shaped input on the most hostile surface in the product, to move a handful of
 * operator images the server re-encodes anyway. The browser base64s the file into an ordinary
 * form field instead, and `storeChapterImage` does the part that actually matters: decode,
 * re-encode through sharp, name from the content hash.
 */

import type { FastifyInstance } from 'fastify';
import {
  listRecitalChapters,
  setRecitalChapterImage,
  updateRecitalChapter,
} from '../../db/recital-chapters.js';
import { listPromptRules } from '../../db/prompt-rules.js';
import {
  ASSET_MAX_BYTES,
  AssetError,
  resolveAssetPath,
  storeChapterImage,
} from '../../media/assets.js';
import { FOLLOW_UP_MAX_RULES } from '../../interaction/rule-overview.js';
import { listRecentRuleInvocations } from '../../db/rule-invocations.js';
import {
  RECITAL_MAX_MESSAGES,
  RECITAL_MAX_PACING_MS,
  RECITAL_MIN_MESSAGES,
  RECITAL_MIN_PACING_MS,
  planRecital,
  recitalClosing,
  unassignedRules,
  type RecitalChapter,
} from '../../interaction/recital.js';
import { log } from '../../log.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, fmtDate, pageHeader } from './ui.js';

function bodyString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : '';
}

const INPUT_CLS =
  'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';

function chapterCard(
  chapter: RecitalChapter,
  claimed: number,
  read: number,
  csrf: string,
): SafeHtml {
  return card(
    `${String(chapter.ord)}. ${chapter.titleEn}`,
    html`
      <div class="mb-3 flex flex-wrap items-center gap-2">
        ${chapter.enabled ? badge('in the reading', 'green') : badge('skipped', 'slate')}
        ${chapter.imagePath ? badge('image', 'blue') : badge('text only', 'slate')}
        <span class="text-xs text-slate-500">
          ${String(read)} of ${String(claimed)} rules read
        </span>
      </div>
      <form method="post" action="/book/recital/chapter/${chapter.id}" class="grid gap-3">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-slate-700">Title (English)</span>
            <input name="titleEn" value="${chapter.titleEn}" class="${INPUT_CLS}" />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-slate-700">Title (German)</span>
            <input name="titleDe" value="${chapter.titleDe}" class="${INPUT_CLS}" />
          </label>
        </div>
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-slate-700">Rules in this chapter</span>
          <input name="rulePrefixes" value="${chapter.rulePrefixes.join(', ')}" class="${INPUT_CLS}" />
          <span class="text-xs text-slate-500">
            Rule id prefixes, comma separated. The LONGEST match wins across all chapters, so
            <code>prompt.</code> can be split by giving another chapter
            <code>prompt.person-name-guard.</code>. A rule a later migration adds to a family
            already listed here needs no action; one in a new family appears under "claimed by
            no chapter" below.
          </span>
        </label>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-slate-700">If the model says nothing usable (English)</span>
            <input name="fallbackEn" value="${chapter.fallbackEn}" class="${INPUT_CLS}" />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-slate-700">If the model says nothing usable (German)</span>
            <input name="fallbackDe" value="${chapter.fallbackDe}" class="${INPUT_CLS}" />
          </label>
        </div>
        <p class="text-xs text-slate-500">
          The fallback is what she reads when the model fails. It is never empty, because the
          chapter ships either way: a model failure costs the flourish, never the law.
        </p>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" ${chapter.enabled ? raw('checked') : ''} class="rounded" />
          <span>Read this chapter</span>
        </label>
        <div>
          <button
            type="submit"
            class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Save chapter
          </button>
        </div>
      </form>

      <div class="mt-4 border-t border-slate-200 pt-4">
        <p class="text-sm font-medium text-slate-700">Image</p>
        ${chapter.imagePath
          ? html`<div class="mt-2 flex flex-wrap items-center gap-3">
              <img
                src="/book/recital/chapter/${chapter.id}/image"
                alt="Chapter illustration"
                class="h-24 rounded-lg border border-slate-200"
              />
              <form method="post" action="/book/recital/chapter/${chapter.id}/image/clear">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button
                  type="submit"
                  class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Remove
                </button>
              </form>
            </div>`
          : html`<p class="mt-1 text-xs text-slate-500">
              No image. This chapter ships as text, which is a normal state: a missing image
              never blocks a chapter.
            </p>`}
        <form
          method="post"
          action="/book/recital/chapter/${chapter.id}/image"
          data-image-upload
          class="mt-3 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="imageData" value="" />
          <input type="file" accept="image/*" class="text-sm" />
          <button
            type="submit"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Upload
          </button>
          <span data-image-upload-status class="text-xs text-slate-500"></span>
        </form>
      </div>
    `,
  );
}

export function registerRecital(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{ Querystring: { saved?: string; error?: string } }>(
    '/book/recital',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const chapters = await listRecitalChapters(ctx.db);
      const rules = await listPromptRules(ctx.db);
      const s = ctx.interaction.get().recital;
      const plan = planRecital(chapters, rules, { lang: 'en', maxMessages: s.maxMessages });
      const orphans = unassignedRules(chapters, rules);
      const scene = ctx.interaction.get().bookScene;
      const record = ctx.interaction.get().invocationRecord;
      const invocations = record.enabled ? await listRecentRuleInvocations(ctx.db, 100) : [];

      // What each chapter HOLDS against what the plan actually reads, so a bound that quietly
      // drops laws is visible as a number rather than as a surprise in a group.
      const held = new Map<string, number>();
      for (const chapter of chapters) {
        held.set(
          chapter.id,
          planRecital([chapter], rules, { lang: 'en', maxMessages: RECITAL_MAX_MESSAGES }).beats
            .slice(1)
            .reduce((n, b) => n + b.rules.length + b.omitted, 0),
        );
      }
      const readPer = new Map<string, number>();
      for (const beat of plan.beats) {
        if (!beat.chapterId) continue;
        readPer.set(beat.chapterId, (readPer.get(beat.chapterId) ?? 0) + beat.rules.length);
      }

      reply.type('text/html');
      return page({
        title: 'The Recital | The Book of Elii',
        active: 'book:recital',
        csrfToken: csrf,
        body: html`
          ${pageHeader('The Recital', 'What a member hears when they ask for the Book.')}
          ${req.query.saved
            ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Saved.
              </div>`
            : null}
          ${req.query.error
            ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                ${req.query.error}
              </div>`
            : null}

          ${card(
            'How she answers a question about her rules',
            html`
              <form method="post" action="/book/recital/settings" class="grid gap-3">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <label class="flex flex-col gap-1 text-sm">
                  <span class="font-medium text-slate-700">Mode</span>
                  <select name="mode" class="${INPUT_CLS}">
                    <option value="overview" ${s.mode === 'overview' ? raw('selected') : ''}>
                      Overview, then answer the follow-up (recommended)
                    </option>
                    <option value="brief" ${s.mode === 'brief' ? raw('selected') : ''}>
                      Quote a few rules straight away
                    </option>
                    <option value="asked" ${s.mode === 'asked' ? raw('selected') : ''}>
                      Overview, and the full recital when asked for the Book by name
                    </option>
                    <option value="always" ${s.mode === 'always' ? raw('selected') : ''}>
                      Recite for any question about her rules
                    </option>
                  </select>
                  <span class="text-xs text-slate-500">
                    <strong>Overview</strong> is the default, and it changed in CCB-S4-048
                    after production testing. She says how many laws she has, what they broadly
                    cover, that some are withheld and why, and asks what you want to know. The
                    quoting happens on your follow-up, at most
                    ${String(FOLLOW_UP_MAX_RULES)} rules at a time, where it answers something
                    you actually asked.
                  </span>
                  <span class="text-xs text-slate-500">
                    <strong>Quote a few rules straight away</strong> is what "brief" used to
                    mean and is kept for an operator who prefers it. In a live group it reads
                    as a block of text nobody finishes.
                    <strong>Asked</strong> adds the full recital on top, for somebody who names
                    the Book. <strong>Always</strong> performs for every rules question, which
                    is pleasant in a quiet group and a lot of messages in a busy one.
                  </span>
                </label>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium text-slate-700">Messages per recital</span>
                    <input
                      name="maxMessages"
                      type="number"
                      min="${String(RECITAL_MIN_MESSAGES)}"
                      max="${String(RECITAL_MAX_MESSAGES)}"
                      value="${String(s.maxMessages)}"
                      class="${INPUT_CLS} sm:w-40"
                    />
                    <span class="text-xs text-slate-500">
                      The opening counts as one. A bigger bound reads MORE of each chapter
                      rather than a longer first chapter; a smaller one drops chapters from the
                      middle and always keeps the ending. Clamped to
                      ${String(RECITAL_MIN_MESSAGES)} to ${String(RECITAL_MAX_MESSAGES)} in code
                      as well as here, because this is the only setting standing between a
                      question and a group full of messages.
                    </span>
                  </label>
                  <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium text-slate-700">Pause between messages (ms)</span>
                    <input
                      name="pacingMs"
                      type="number"
                      min="${String(RECITAL_MIN_PACING_MS)}"
                      max="${String(RECITAL_MAX_PACING_MS)}"
                      step="500"
                      value="${String(s.pacingMs)}"
                      class="${INPUT_CLS} sm:w-40"
                    />
                    <span class="text-xs text-slate-500">
                      Consecutive messages with no gap read as a dump. The beats are queued
                      rather than held in the reply path, so a long pause costs nothing and
                      survives a restart.
                    </span>
                  </label>
                </div>
                <div>
                  <button
                    type="submit"
                    class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                  >
                    Save
                  </button>
                </div>
              </form>

              <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p class="font-medium">What a recital costs, and how often one can happen</p>
                <p class="mt-1">
                  A recital has its OWN allowance, taken whole before the first word:
                  <strong>one per member and two per chat, per minute</strong>, fixed in code.
                  If it is spent she gives the short answer instead. It also takes one ordinary
                  reply allowance, because it is still her speaking.
                </p>
                <p class="mt-1">
                  It is not charged as ${String(plan.beats.length)} replies, and that was a
                  correction rather than a preference: the reply budget ships at
                  ${String(ctx.interaction.get().replyLimitPerMember)} per member per minute, so
                  charging a reading against it meant no recital could ever start and every
                  check on the feature stayed green. A recital is one performance, not
                  ${String(plan.beats.length)} conversational turns.
                </p>
                <p class="mt-1">
                  At this setting the most this group can produce is
                  <strong>${String(plan.beats.length * 2)} messages in a minute</strong>, and
                  only if two different members ask inside the same one.
                </p>
              </div>
            `,
          )}

          ${card(
            'The reading, as it stands',
            html`
              <p class="text-sm text-slate-600">
                ${String(plan.beats.length)} messages ·
                ${String(plan.beats.slice(1).reduce((n, b) => n + b.rules.length, 0))} rules read
                · ${String(plan.omitted)} held back by the bound ·
                ${String(plan.withheld)} withheld from members entirely
                ${plan.truncated
                  ? raw(' · <span class="font-medium text-amber-700">cut short by the message bound</span>')
                  : null}
              </p>
              <ol class="mt-3 space-y-2 text-sm">
                ${plan.beats.map(
                  (beat) => html`<li class="rounded-lg border border-slate-200 px-3 py-2">
                    <span class="font-medium">${beat.title ?? 'Opening'}</span>
                    ${beat.imagePath ? badge('image', 'blue') : null}
                    <span class="text-xs text-slate-500">
                      ${beat.rules.length > 0
                        ? html`${String(beat.rules.length)} rules${beat.omitted > 0
                            ? html`, ${String(beat.omitted)} not read`
                            : null}`
                        : html`her voice only`}
                    </span>
                    ${beat.rules.length > 0
                      ? html`<ul class="mt-1 space-y-0.5 text-xs text-slate-500">
                          ${beat.rules.map((rule) => html`<li><code>${rule.id}</code></li>`)}
                        </ul>`
                      : null}
                  </li>`,
                )}
              </ol>
              <p class="mt-3 text-xs text-slate-500">
                The closing is appended by the application, not written by the model, because it
                is a promise rather than a flourish: <em>${recitalClosing(plan, false)}</em>
              </p>
            `,
          )}

          ${card(
            'The Book, told as a scene',
            html`
              <form method="post" action="/book/recital/story" class="grid gap-3">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="storyEnabled" ${scene.enabled ? raw('checked') : ''} class="rounded" />
                  <span>Play the scene when somebody asks for the Book by name</span>
                </label>
                <p class="text-xs text-slate-500">
                  <strong>When it triggers.</strong> Only a question that names the Book:
                  "show me the Book of Elii", "read me your book". A question about her RULES or
                  LAWS is unaffected and still gets the overview with its counts, then the
                  follow-up with quoted rules. The Book is the artefact; the rules are the
                  content, and they are different questions.
                </p>
                <p class="text-xs text-slate-500">
                  <strong>What she does.</strong> ONE message. Fire and light, a few lines about
                  what the book means to her, one law read out exactly, and an invitation to ask
                  about another. There is no length setting, deliberately: the answer this
                  replaced could be dialled up to six messages, and its volume was the whole
                  objection to it. The verbosity dial still moves her half of it underneath a
                  fixed ceiling.
                </p>
                <p class="text-xs text-slate-500">
                  <strong>Which law.</strong> The safety ceiling, rotating through its four
                  sentences and never the same one twice running in a chat. The application
                  hands the scene exactly one law, so a second one cannot appear. Switched off,
                  a question naming the Book falls back to the overview, which is a complete
                  answer.
                </p>
                <div>
                  <button
                    type="submit"
                    class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                  >
                    Save
                  </button>
                </div>
              </form>
            `,
          )}

          ${card(
            'The record: when a law was invoked',
            html`
              <form method="post" action="/book/recital/record" class="grid gap-3">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="recordEnabled" ${record.enabled ? raw('checked') : ''} class="rounded" />
                  <span>Record when a rule decides something</span>
                </label>
                <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p class="font-medium">What this can and cannot say</p>
                  <p class="mt-1">
                    It records the moments a rule actually DECIDED something, which in this
                    product means the deterministic gates: a lookup refused before any provider
                    was contacted, and a refusal to confirm or deny which rules are withheld.
                    Those are the places the application knows which law it was holding.
                  </p>
                  <p class="mt-1">
                    <strong>It says nothing about the model's own judgement.</strong> When she
                    declines something herself, no rule fired in a way this can attribute: the
                    ceiling is in her prompt and so are ninety-nine others, and which one she was
                    weighing is not knowable from outside. Those refusals leave no row rather
                    than a guessed one. That silence is what makes the rest of it worth reading.
                  </p>
                </div>
                <label class="flex flex-col gap-1 text-sm">
                  <span class="font-medium text-slate-700">Keep rows for (days)</span>
                  <input
                    name="recordRetention"
                    type="number"
                    min="0"
                    max="3650"
                    value="${String(record.retentionDays)}"
                    class="${INPUT_CLS} sm:w-40"
                  />
                  <span class="text-xs text-slate-500">
                    90 by default: long enough to answer "has this been happening", short enough
                    that nobody accumulates rows forever. 0 keeps everything. Nothing
                    member-written is stored, so this is a size choice rather than a privacy one.
                  </span>
                </label>
                <div>
                  <button
                    type="submit"
                    class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                  >
                    Save
                  </button>
                </div>
              </form>

              <div class="mt-4 border-t border-slate-200 pt-4">
                <p class="text-sm font-medium text-slate-700">
                  ${String(invocations.length)} recorded decisions
                </p>
                ${invocations.length === 0
                  ? html`<p class="mt-1 text-xs text-slate-500">
                      Nothing yet. A row appears the first time a gate refuses something.
                    </p>`
                  : html`<ul class="mt-2 space-y-1 text-xs text-slate-600">
                      ${invocations.slice(0, 25).map(
                        (row) => html`<li>
                          <code>${row.ruleId}</code>
                          <span class="text-slate-400">${row.kind}</span>
                          ${row.category ? html`<span class="text-slate-400">${row.category}</span>` : null}
                          <span class="text-slate-400">${fmtDate(row.occurredAt.toISOString())}</span>
                        </li>`,
                      )}
                    </ul>`}
              </div>
            `,
          )}

          ${orphans.length > 0
            ? card(
                `${String(orphans.length)} rules she may name are claimed by no chapter`,
                html`
                  <p class="text-sm text-slate-600">
                    These are never recited. That is a choice if you made it and a defect if you
                    did not: a rule in a family no chapter lists appears here rather than
                    vanishing quietly from the reading. Add its prefix to a chapter above.
                  </p>
                  <ul class="mt-2 space-y-0.5 text-xs text-slate-600">
                    ${orphans.map((rule) => html`<li><code>${rule.id}</code></li>`)}
                  </ul>
                `,
              )
            : null}

          <div class="mt-5 grid gap-4">
            ${chapters.map((chapter) =>
              chapterCard(chapter, held.get(chapter.id) ?? 0, readPer.get(chapter.id) ?? 0, csrf),
            )}
          </div>

          <script src="/assets/admin-image-upload.js" defer></script>
        `,
      });
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/book/recital/settings', async (req, reply) => {
    // The clamping is `normalizeRecitalSettings`'s, not this route's. One place decides what a
    // legal bound is, and it is the one a hand-crafted POST also goes through.
    const actor = req.session?.username ?? 'unknown';
    await ctx.interaction.save(
      {
        ...ctx.interaction.get(),
        recital: {
          mode: bodyString(req.body, 'mode'),
          maxMessages: bodyString(req.body, 'maxMessages'),
          pacingMs: bodyString(req.body, 'pacingMs'),
        },
      },
      actor,
    );
    return reply.redirect('/book/recital?saved=1');
  });

  app.post<{ Body: Record<string, unknown> }>('/book/recital/story', async (req, reply) => {
    const actor = req.session?.username ?? 'unknown';
    await ctx.interaction.save(
      {
        ...ctx.interaction.get(),
        bookScene: { enabled: 'storyEnabled' in req.body },
      },
      actor,
    );
    return reply.redirect('/book/recital?saved=1');
  });

  app.post<{ Body: Record<string, unknown> }>('/book/recital/record', async (req, reply) => {
    const actor = req.session?.username ?? 'unknown';
    await ctx.interaction.save(
      {
        ...ctx.interaction.get(),
        invocationRecord: {
          enabled: 'recordEnabled' in req.body,
          retentionDays: bodyString(req.body, 'recordRetention'),
        },
      },
      actor,
    );
    return reply.redirect('/book/recital?saved=1');
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/book/recital/chapter/:id',
    async (req, reply) => {
      const titleEn = bodyString(req.body, 'titleEn').trim();
      const titleDe = bodyString(req.body, 'titleDe').trim();
      const fallbackEn = bodyString(req.body, 'fallbackEn').trim();
      const fallbackDe = bodyString(req.body, 'fallbackDe').trim();
      if (!titleEn || !titleDe) {
        return reply.redirect(
          '/book/recital?error=' + encodeURIComponent('A chapter needs a title in both languages.'),
        );
      }
      if (!fallbackEn || !fallbackDe) {
        // Refused rather than defaulted. An empty fallback is a chapter that reads as a bare
        // list of rules the day the model is down, which is the failure this field exists for.
        return reply.redirect(
          '/book/recital?error=' +
            encodeURIComponent(
              'A chapter needs its fallback line in both languages. It is what she reads when the model fails.',
            ),
        );
      }
      const ok = await updateRecitalChapter(ctx.db, req.params.id, {
        titleEn,
        titleDe,
        rulePrefixes: bodyString(req.body, 'rulePrefixes')
          .split(',')
          .map((prefix) => prefix.trim())
          .filter(Boolean),
        fallbackEn,
        fallbackDe,
        enabled: 'enabled' in req.body,
      });
      if (!ok) {
        return reply.redirect('/book/recital?error=' + encodeURIComponent('No such chapter.'));
      }
      return reply.redirect('/book/recital?saved=1');
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/book/recital/chapter/:id/image',
    {
      // Base64 inflates by a third, so the body has to hold more than the file limit. Set on
      // THIS route only: every other admin form is small, and a console-wide limit this size
      // would be a gift to anybody who found an unauthenticated POST.
      bodyLimit: Math.ceil(ASSET_MAX_BYTES * 1.4) + 4096,
    },
    async (req, reply) => {
      const encoded = bodyString(req.body, 'imageData');
      if (!encoded) {
        return reply.redirect(
          '/book/recital?error=' + encodeURIComponent('No file arrived. Choose one and try again.'),
        );
      }
      try {
        const stored = await storeChapterImage(ctx.cfg.assetRoot, Buffer.from(encoded, 'base64'));
        await setRecitalChapterImage(ctx.db, req.params.id, stored.relativePath);
        return reply.redirect('/book/recital?saved=1');
      } catch (err) {
        // An AssetError is the operator's problem to see and fix (not an image, too big);
        // anything else is ours, and is logged as well as shown.
        if (!(err instanceof AssetError)) {
          log.error(
            `Chapter image upload failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return reply.redirect(
          '/book/recital?error=' +
            encodeURIComponent(err instanceof Error ? err.message : String(err)),
        );
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/book/recital/chapter/:id/image/clear',
    async (req, reply) => {
      // The row is cleared; the file is left on disk. Deleting it would be the one destructive
      // operation on this page, and an operator who clears an image by accident would rather
      // re-assign it than re-find it. Asset files are operator-supplied and few.
      await setRecitalChapterImage(ctx.db, req.params.id, null);
      return reply.redirect('/book/recital?saved=1');
    },
  );

  /** Serves a chapter's image to the console, by CHAPTER id and never by path. */
  app.get<{ Params: { id: string } }>(
    '/book/recital/chapter/:id/image',
    async (req, reply) => {
      const chapter = (await listRecitalChapters(ctx.db)).find((c) => c.id === req.params.id);
      if (!chapter?.imagePath) return reply.code(404).send('No image for that chapter.');
      try {
        // Addressed by chapter id, resolved through the guard, and never taken from a query
        // parameter: the same rule the media console follows (CCB-S3-013 §4).
        return await reply
          .type('image/jpeg')
          .send((await import('node:fs')).createReadStream(
            resolveAssetPath(ctx.cfg.assetRoot, chapter.imagePath),
          ));
      } catch (err) {
        log.warn(
          `Chapter image ${chapter.imagePath} could not be served: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return reply.code(404).send('That image could not be read.');
      }
    },
  );
}
