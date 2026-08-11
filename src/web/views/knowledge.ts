/**
 * The Knowledge Base console (CCB-S5-022, D-176; every control CCB-S5-023, D-177).
 *
 * Three surfaces, and the third is the point of the other two:
 *
 *   /plugins/knowledge-base              documents, grants, and every setting
 *   /plugins/knowledge-base/diagnostics  a question, and exactly what would be retrieved
 *
 * ── WHY THIS PAGE CARRIES THE BOT SWITCHER AND THE OTHER PLUGIN PAGES DO NOT ─
 *
 * Because part of it genuinely is per bot. Web Search and Crypto Prices have nothing per bot
 * but their on/off switch, so their pages say "deployment-wide" and carry no switcher. Here
 * the GRANTS are per bot - which documents this bot was given is the whole product direction -
 * so the switcher belongs, and every setting that is NOT per bot says so beside itself.
 *
 * ── THE DIAGNOSTICS PAGE IS NOT A LUXURY ─────────────────────────────────────
 *
 * Every number on the settings page is unknowable in advance. The relevance floor in
 * particular was shipped at 0.45 as a guess, and a live run answered a question about mercury
 * from the model while printing a document name underneath it. It is 0.55 now because it was
 * MEASURED, and the only reason it could be measured is that the scores are visible.
 *
 * So the diagnostics page shows every candidate with its keyword score, its vector score, its
 * fused score, the document weight, whether it cleared the floor, and whether it made the
 * budget. Without it the operator is turning knobs blind; with it every control becomes
 * adjustable by evidence.
 */

import type { FastifyInstance } from 'fastify';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, pageHeader } from './ui.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';
import { resolveSelectedBot } from '../selected-bot.js';
import { enqueueJob } from '../../queue/store.js';
import {
  KNOWLEDGE_INGEST_JOB,
  knowledgeIngestKey,
} from '../../queue/jobs/knowledge-ingest.js';
import {
  deleteDocument,
  listDocuments,
  listGrants,
  setDocumentState,
  setDocumentWeight,
  setGrant,
  upsertDocument,
  type KbDocument,
} from '../../db/knowledge.js';
import {
  KnowledgeService,
  checksumOf,
  contentTypeFor,
  ACCEPTED_TYPES,
} from '../../knowledge/service.js';
import { Embedder } from '../../knowledge/embed.js';
import { ingestSignature, INGEST_SETTING_KEYS } from '../../knowledge/chunk.js';
import {
  RETRIEVAL_TRIGGERS,
  TRIGGER_NOTES,
  type KnowledgeSettings,
} from '../../plugins/knowledge-base/settings.js';
import { KNOWLEDGE_BASE_ID } from '../../plugins/knowledge-base/plugin.js';
import { loadLocalAiConfig } from '../../config.js';
import { EMBEDDING_MODEL, EMBEDDING_LICENCE, EMBEDDING_DIMENSIONS } from '../../knowledge/embed.js';

const INPUT = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';

/** The largest document accepted, in bytes of decoded text. */
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

function num(name: string, value: number, min: number, max: number, step = '1'): SafeHtml {
  return html`<input
    name="${name}"
    type="number"
    min="${String(min)}"
    max="${String(max)}"
    step="${step}"
    value="${String(value)}"
    class="${INPUT} sm:w-40"
  />`;
}

function field(label: string, control: SafeHtml, help?: string): SafeHtml {
  return html`<label class="flex flex-col gap-1 text-sm">
    <span class="font-medium text-slate-700">${label}</span>
    ${control} ${help ? html`<span class="text-xs text-slate-500">${help}</span>` : null}
  </label>`;
}

function save(label = 'Save'): SafeHtml {
  return html`<button
    type="submit"
    class="self-start rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
  >
    ${label}
  </button>`;
}

/** Every setting on this page is deployment-wide EXCEPT the grants. Said, not implied. */
function sharedBadge(): SafeHtml {
  return badge('deployment-wide', 'slate');
}

function fmtBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} kB`;
}

export function registerKnowledge(app: FastifyInstance, ctx: ViewContext): void {
  const { db, plugins } = ctx;

  /**
   * A service for the console.
   *
   * Built per request rather than taken from the process-wide registration, so the page and
   * the diagnostics work before the bot has started. It reads the same settings the reply
   * path reads, so what the operator sees here is what she will actually do.
   */
  const service = (): KnowledgeService =>
    new KnowledgeService({
      db,
      embedder: new Embedder({ config: loadLocalAiConfig() }),
      settings: () => plugins.getKnowledge(),
      // READ-ONLY BY CONSTRUCTION. The console never ingests: uploads go on the queue, and
      // the queue handler uses the process-wide service that holds the real transaction
      // runner. Throwing here rather than passing a same-handle runner means a future edit
      // that tried to ingest from a request fails loudly instead of writing chunks through a
      // pool with no transaction around them.
      transaction: () => {
        throw new Error(
          'The console builds a read-only knowledge service. Ingest runs on the durable ' +
            'queue, which holds the transactional one.',
        );
      },
    });

  const notice = (q: { saved?: string; error?: string; note?: string }): SafeHtml | null =>
    q.error
      ? html`<div
          class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          ${q.error}
        </div>`
      : q.saved || q.note
        ? html`<div
            class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            ${q.note ?? 'Saved.'}
          </div>`
        : null;

  /* ── The main page ───────────────────────────────────────────────────────── */

  app.get<{ Querystring: { saved?: string; error?: string; note?: string; bot?: string } }>(
    '/plugins/knowledge-base',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const botProfiles = await listBotOnboardingProfiles(db);
      const selection = resolveSelectedBot(
        botProfiles,
        req.query.bot,
        req.session?.selectedBotProfileId ?? null,
      );
      const selectedBotId = selection.selectedId;

      const settings = plugins.getKnowledge();
      const enabledForBot =
        selectedBotId === null ? false : plugins.isEnabledFor(selectedBotId, KNOWLEDGE_BASE_ID);
      const documents = await listDocuments(db);
      const grants = await listGrants(db);
      const currentSignature = ingestSignature(settings);
      const grantOf = (docId: number): { given: boolean; enabled: boolean } => {
        const g = grants.find(
          (x) => x.documentId === docId && x.botProfileId === selectedBotId,
        );
        return { given: g !== undefined, enabled: g?.enabled === true };
      };
      const isStale = (d: KbDocument): boolean =>
        d.state === 'ready' && d.ingestSignature !== currentSignature;
      const staleCount = documents.filter(isStale).length;

      const body = html`
        ${pageHeader(
          'Knowledge Base',
          selection.selectedName
            ? `Documents you give her. The grants below are ${selection.selectedName}'s; every setting is deployment-wide.`
            : 'Documents you give her',
        )}
        ${notice(req.query)}
        ${
          selectedBotId !== null && !enabledForBot
            ? html`<div
                class="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <p class="font-semibold">
                  The knowledge base is switched off for ${selection.selectedName}.
                </p>
                <p class="mt-1">
                  Documents can still be uploaded and granted here, and nothing will be
                  retrieved for this bot until it is switched on. That switch is per bot and
                  lives on the <a class="underline" href="/plugins">plugin list</a>.
                </p>
              </div>`
            : null
        }

        ${card(
          'What is stored, and what is not',
          html`<p class="text-sm text-slate-600">
              Her chunks hold <strong>your words, verbatim</strong>. Nothing is summarised and
              no model rewrites a document into "facts" before storing it. That is a measured
              choice rather than a shortcut: in a controlled ablation
              (<a class="underline" href="https://arxiv.org/abs/2601.00821">arXiv 2601.00821</a>)
              verbatim chunks beat model-extracted artefacts by 15.9 points on one benchmark
              and 22.0 on another, and the mechanism was lossy distillation. Extraction looks
              like it works and quietly loses the detail that made the document worth keeping.
            </p>
            <p class="mt-3 text-sm text-slate-600">
              Retrieved passages reach her <strong>fenced as reference material</strong>, in
              the user message and never in her instructions, exactly as web results and
              remembered conversation do. The source line under an answer is written by the
              application, never by her, so she cannot cite a document she was not given.
            </p>
            <p class="mt-3 text-xs text-slate-500">
              Embedding model <strong>${EMBEDDING_MODEL}</strong> (${EMBEDDING_LICENCE},
              ${String(EMBEDDING_DIMENSIONS)} dimensions), measured at 0.32 GB of VRAM
              alongside the resident reply model. Accepted formats:
              ${Object.keys(ACCEPTED_TYPES).join(', ')}. PDF is deliberately not accepted:
              extraction has a silent quality cliff, and a badly extracted PDF produces chunks
              that look like text and retrieve like noise.
            </p>`,
        )}

        <div class="mt-4">
          ${card(
            'Add a document',
            html`<form
              method="post"
              action="/plugins/knowledge-base/upload"
              class="flex flex-col gap-3"
              data-image-upload
              data-upload-ready=" is ready. It is stored verbatim; nothing rewrites it."
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="imageData" data-upload-payload value="" />
              <input type="hidden" name="fileName" data-upload-name value="" />
              ${field(
                'Title',
                html`<input name="title" class="${INPUT}" placeholder="What this document is" />`,
                'Shown to you here, and printed under an answer she draws from it. Left blank, the filename is used.',
              )}
              <label class="flex flex-col gap-1 text-sm">
                <span class="font-medium text-slate-700">File</span>
                <input type="file" name="file" accept=".md,.markdown,.txt,.text" class="text-sm" />
                <span class="text-xs text-slate-500" data-image-upload-status>
                  Markdown or plain text, up to ${fmtBytes(MAX_DOCUMENT_BYTES)}.
                </span>
              </label>
              ${save('Upload and ingest')}
              <p class="text-xs text-slate-500">
                Ingest runs on the durable queue, not in this request: embedding is about
                660 ms a chunk, so a large document is minutes. The document appears below
                immediately and becomes retrievable when it reaches <em>ready</em>.
              </p>
            </form>`,
          )}
        </div>

        <div class="mt-4">
          ${card(
            `Documents (${String(documents.length)})`,
            documents.length === 0
              ? html`<p class="text-sm text-slate-500">
                  Nothing yet. Until a document is uploaded AND granted to this bot, she
                  retrieves nothing and answers as she always has.
                </p>`
              : html`
                  ${staleCount > 0
                    ? html`<div
                        class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      >
                        <strong>${String(staleCount)} document(s) are stale.</strong> Their
                        chunks were cut under different ingest settings. They are still
                        retrievable, because they are still your words correctly stored, but
                        a store cut two ways is a store nobody can reason about.
                        <form
                          method="post"
                          action="/plugins/knowledge-base/reingest-all"
                          class="mt-2"
                        >
                          <input type="hidden" name="_csrf" value="${csrf}" />
                          <button
                            type="submit"
                            class="rounded-lg border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                          >
                            Rebuild all ${String(staleCount)} under the current settings
                          </button>
                        </form>
                      </div>`
                    : null}
                  <div class="flex flex-col gap-3">
                    ${documents.map((d) => {
                      const g = grantOf(d.id);
                      const stale = isStale(d);
                      return html`<section
                        class="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                      >
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p class="font-semibold text-slate-800">${d.title}</p>
                            <p class="text-xs text-slate-500">
                              ${d.sourceName} · ${fmtBytes(d.byteSize)} ·
                              ${String(d.chunkCount)} chunk(s)
                              ${d.ingestedAt ? html` · ingested ${d.ingestedAt.slice(0, 16)}` : null}
                            </p>
                          </div>
                          <p class="flex flex-wrap items-center gap-2">
                            ${d.state === 'ready'
                              ? badge('ready', 'green')
                              : d.state === 'failed'
                                ? badge('failed', 'red')
                                : badge(d.state, 'amber')}
                            ${stale ? badge('stale: settings changed', 'amber') : null}
                            ${selectedBotId === null
                              ? null
                              : g.given && g.enabled
                                ? badge('given to this bot', 'green')
                                : g.given
                                  ? badge('given, switched off', 'amber')
                                  : badge('not given to this bot', 'slate')}
                          </p>
                        </div>
                        ${d.ingestError
                          ? html`<p class="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                              ${d.ingestError}
                            </p>`
                          : null}
                        <div class="mt-3 flex flex-wrap items-end gap-3">
                          ${selectedBotId === null
                            ? null
                            : html`<form
                                method="post"
                                action="/plugins/knowledge-base/${String(d.id)}/grant"
                                class="flex items-center gap-1"
                              >
                                <input type="hidden" name="_csrf" value="${csrf}" />
                                <input
                                  type="hidden"
                                  name="botProfileId"
                                  value="${String(selectedBotId)}"
                                />
                                <button
                                  type="submit"
                                  name="state"
                                  value="on"
                                  class="rounded-lg border px-2 py-1 text-xs ${g.given && g.enabled
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'}"
                                >
                                  Give it
                                </button>
                                <button
                                  type="submit"
                                  name="state"
                                  value="off"
                                  class="rounded-lg border px-2 py-1 text-xs ${g.given && !g.enabled
                                    ? 'border-amber-400 bg-amber-50 text-amber-800'
                                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'}"
                                >
                                  Pause
                                </button>
                                <button
                                  type="submit"
                                  name="state"
                                  value="revoke"
                                  class="rounded-lg border px-2 py-1 text-xs ${!g.given
                                    ? 'border-slate-400 bg-slate-100 text-slate-700'
                                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'}"
                                >
                                  Not given
                                </button>
                              </form>`}
                          <form
                            method="post"
                            action="/plugins/knowledge-base/${String(d.id)}/weight"
                            class="flex items-end gap-2"
                          >
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <label class="flex flex-col gap-1 text-xs text-slate-600">
                              Weight
                              <input
                                name="weight"
                                type="number"
                                min="0.1"
                                max="10"
                                step="0.1"
                                value="${d.weight.toFixed(1)}"
                                class="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs"
                              />
                            </label>
                            <button
                              type="submit"
                              class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            >
                              Set
                            </button>
                          </form>
                          <form
                            method="post"
                            action="/plugins/knowledge-base/${String(d.id)}/reingest"
                          >
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <button
                              type="submit"
                              class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            >
                              Re-ingest
                            </button>
                          </form>
                          <form
                            method="post"
                            action="/plugins/knowledge-base/${String(d.id)}/delete"
                          >
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <button
                              type="submit"
                              class="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                            >
                              Remove
                            </button>
                          </form>
                        </div>
                        <p class="mt-2 text-xs text-slate-400">
                          Weight multiplies the fused score, so it changes ORDER only. It
                          cannot lift a chunk over the relevance floor.
                        </p>
                      </section>`;
                    })}
                  </div>
                `,
          )}
        </div>

        <div class="mt-4">
          ${card(
            'Retrieval',
            html`<form
              method="post"
              action="/plugins/knowledge-base/settings"
              class="flex flex-col gap-4"
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="section" value="retrieval" />
              <p class="flex items-center gap-2 text-xs text-slate-500">
                ${sharedBadge()} These apply to every bot. What is per bot is which documents
                it was given, above.
              </p>

              ${field(
                'When she consults it',
                html`<select name="trigger" class="${INPUT}">
                  ${RETRIEVAL_TRIGGERS.map(
                    (t) =>
                      html`<option value="${t}" ${t === settings.trigger ? raw('selected') : ''}>
                        ${t}
                      </option>`,
                  )}
                </select>`,
                TRIGGER_NOTES[settings.trigger],
              )}

              <div class="grid gap-4 sm:grid-cols-2">
                ${field(
                  'Minimum relevance (cosine)',
                  num('minScore', settings.minScore, -1, 1, '0.01'),
                  'THE control that decides whether this is trustworthy. Below it nothing is retrieved and she says she has nothing rather than delivering the least-bad chunk. Measured on your material: a relevant chunk scores 0.62 to 0.75, an unrelated question 0.39 to 0.43, a different topic from this project 0.49.',
                )}
                ${field(
                  'Prompt budget (characters)',
                  num('budgetChars', settings.budgetChars, 200, 6000),
                  'The hard cap on retrieved text reaching one prompt. When it binds, whole chunks are dropped from the bottom; nothing is ever truncated, because half a chunk reads as a different chunk than it is. The same number web search uses, because it is the same quantity.',
                )}
                ${field(
                  'Candidates per search',
                  num('candidatesPerSearch', settings.candidatesPerSearch, 1, 100),
                  'How many each of the two searches returns before they are fused.',
                )}
                ${field(
                  'Chunks in the prompt',
                  num('maxChunks', settings.maxChunks, 1, 20),
                  'The most that survive the floor. The budget usually binds first.',
                )}
                ${field(
                  'Keyword weight',
                  num('keywordWeight', settings.keywordWeight, 0, 10, '0.1'),
                  'Raise it and an exact identifier (apiListGroups, CCB-S4-041) wins. Keyword search finds those exactly; embeddings blur them.',
                )}
                ${field(
                  'Vector weight',
                  num('vectorWeight', settings.vectorWeight, 0, 10, '0.1'),
                  'Raise it and a paraphrase wins. Conceptual questions need this half.',
                )}
              </div>
              <p class="text-xs text-slate-500">
                The two weights are real: results are fused by weighted reciprocal rank, so a
                weight changes which list dominates the top. They are not normalised against
                each other, because <code>ts_rank</code> and cosine similarity are not
                comparable and never become comparable.
              </p>
              ${save()}
            </form>`,
          )}
        </div>

        <div class="mt-4">
          ${card(
            'Ingest',
            html`<form
              method="post"
              action="/plugins/knowledge-base/settings"
              class="flex flex-col gap-4"
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="section" value="ingest" />
              <div
                class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                <strong>Changing any of these invalidates what is already stored.</strong>
                Every existing chunk was cut under the current values. Saving here does NOT
                re-ingest anything automatically: the affected documents are marked
                <em>stale</em> above and stay retrievable, with a one-click rebuild. Automatic
                re-ingest would spend minutes of GPU on every adjustment, and hiding stale
                chunks would switch the knowledge base off the moment you moved a slider.
              </div>
              <p class="flex items-center gap-2 text-xs text-slate-500">
                ${sharedBadge()} There is one store, so there is one way of cutting it.
              </p>
              <div class="grid gap-4 sm:grid-cols-2">
                ${field(
                  'Chunk size (characters)',
                  num('targetChars', settings.targetChars, 200, 4000),
                  'Smaller chunks retrieve more precisely and carry less of the surrounding sentence that makes an identifier interpretable. Larger ones carry the context and spend the budget on paragraphs about other things.',
                )}
                ${field(
                  'Overlap (characters)',
                  num('overlapChars', settings.overlapChars, 0, 2000),
                  'Repeated at the start of the next chunk, so a definition straddling a boundary stays retrievable from either side. Capped at half the chunk size.',
                )}
                ${field(
                  'Hard ceiling (characters)',
                  num('maxChars', settings.maxChars, 200, 8000),
                  'Nothing stored exceeds this, whatever the document structure suggests.',
                )}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="contextualPrefix"
                    ${settings.contextualPrefix ? raw('checked') : ''}
                    class="rounded"
                  />
                  Contextual prefixing
                </label>
              </div>
              <p class="text-xs text-slate-500">
                Contextual prefixing indexes each chunk with a derived line saying which
                document and heading it came from. Reported to cut failed retrievals by about
                half. It costs nothing at ingest here, because the line is
                <strong>derived</strong> from the title and heading path rather than written
                by a model: a model-written line would be a model-written artefact in the
                store, which is the thing this design rules out.
              </p>
              ${save('Save, and mark affected documents stale')}
            </form>`,
          )}
        </div>

        <div class="mt-4">
          ${card(
            'Controls that deliberately do not exist',
            html`<dl class="grid gap-3 text-sm">
              <div>
                <dt class="font-medium text-slate-700">A recency weight</dt>
                <dd class="text-slate-600">
                  There is no honest date to sort by. The only dates stored are when
                  <em>you uploaded</em> a document and when it was last <em>ingested</em>, and
                  the second one moves whenever you change a chunking setting. A recency slider
                  would silently re-rank your corpus because you adjusted the chunk size, which
                  is a slider that sorts by a date nobody chose.
                </dd>
              </div>
              <div>
                <dt class="font-medium text-slate-700">A reranker</dt>
                <dd class="text-slate-600">
                  A cross-encoder reranker is the highest-value addition after hybrid search
                  and it is not built, because <strong>Ollama has no rerank endpoint</strong>.
                  Driving a reranker model through the embedding endpoint returns the wrong
                  layer and looks like it works, which is worse than not having one. Serving
                  it properly means a second inference service beside Ollama.
                </dd>
              </div>
              <div>
                <dt class="font-medium text-slate-700">Per-bot keyword and vector weights</dt>
                <dd class="text-slate-600">
                  The weights are a property of the corpus, and there is one corpus. What
                  differs between bots is which documents they were given, and the control for
                  "this document should outrank that one" is the per-document weight above,
                  which is finer than a per-bot slider would be.
                </dd>
              </div>
            </dl>`,
          )}
        </div>

        <p class="mt-4 text-sm">
          <a class="underline" href="/plugins/knowledge-base/diagnostics"
            >Open the retrieval diagnostics</a
          >
          to see exactly what a question would retrieve, with every score.
        </p>
      `;

      reply.type('text/html');
      return page({
        title: 'Knowledge Base',
        active: `plugin:${KNOWLEDGE_BASE_ID}`,
        csrfToken: csrf,
        body,
        botSwitcher: { ...selection, returnTo: '/plugins/knowledge-base' },
      });
    },
  );

  /* ── Diagnostics ─────────────────────────────────────────────────────────── */

  app.get<{ Querystring: { q?: string; bot?: string } }>(
    '/plugins/knowledge-base/diagnostics',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const botProfiles = await listBotOnboardingProfiles(db);
      const selection = resolveSelectedBot(
        botProfiles,
        req.query.bot,
        req.session?.selectedBotProfileId ?? null,
      );
      const selectedBotId = selection.selectedId;
      const settings = plugins.getKnowledge();
      const question = (req.query.q ?? '').trim();

      let result: Awaited<ReturnType<KnowledgeService['query']>> | null = null;
      let failure: string | null = null;
      if (question && selectedBotId !== null) {
        try {
          result = await service().query(selectedBotId, question);
        } catch (error) {
          // An honest failure, not an empty table. The usual cause is Ollama being
          // unreachable, and an operator staring at zero rows would read that as "nothing
          // matched" (CCB-S3-023).
          failure = error instanceof Error ? error.message : String(error);
        }
      }

      const body = html`
        ${pageHeader(
          'Retrieval diagnostics',
          selection.selectedName
            ? `What ${selection.selectedName} would retrieve, and why.`
            : 'What would be retrieved, and why',
        )}
        ${card(
          'Ask what she would find',
          html`<form method="get" action="/plugins/knowledge-base/diagnostics" class="flex flex-col gap-3">
            <input
              name="q"
              value="${question}"
              placeholder="Type a question exactly as a member would ask it"
              class="${INPUT}"
            />
            ${save('Show me')}
            <p class="text-xs text-slate-500">
              This runs the real retrieval against the documents this bot was given, with the
              settings in force now. Nothing is sent to her and no reply is generated: this is
              the retrieval half on its own, so a score can be read without spending a model
              call.
            </p>
          </form>`,
        )}
        ${
          failure
            ? html`<div
                class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                Retrieval failed: ${failure}. This is a fault rather than an empty result;
                the usual cause is the embedding model being unreachable.
              </div>`
            : null
        }
        ${
          result
            ? html`<div class="mt-4">
                ${card(
                  'Candidates',
                  result.outcome.candidates.length === 0
                    ? html`<p class="text-sm text-slate-600">
                        Nothing came back at all. Either this bot has been given no documents,
                        or neither search matched anything. She would answer without the store
                        and cite nothing.
                      </p>`
                    : html`
                        <p class="mb-3 text-sm text-slate-600">
                          ${String(result.outcome.selected.length)} of
                          ${String(result.outcome.candidates.length)} candidate(s) reach the
                          prompt, spending ${String(result.outcome.charsUsed)} of
                          ${String(settings.budgetChars)} characters.
                          ${result.outcome.emptyBecauseOfFloor
                            ? html`<strong
                                >Everything was below the relevance floor of
                                ${String(settings.minScore)}, so she is given nothing and says
                                so.</strong
                              >`
                            : null}
                        </p>
                        <div class="overflow-x-auto">
                          <table class="w-full text-left text-sm">
                            <thead>
                              <tr
                                class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
                              >
                                <th class="py-2 pr-3">Document</th>
                                <th class="py-2 pr-3">Chunk</th>
                                <th class="py-2 pr-3">Keyword</th>
                                <th class="py-2 pr-3">Vector</th>
                                <th class="py-2 pr-3">Weight</th>
                                <th class="py-2 pr-3">Fused</th>
                                <th class="py-2 pr-3">Outcome</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${result.outcome.candidates.map(
                                (c) => html`<tr class="border-b border-slate-100 align-top">
                                  <td class="py-2 pr-3 text-slate-700">${c.documentTitle}</td>
                                  <td class="py-2 pr-3 text-slate-500">#${String(c.ord)}</td>
                                  <td class="py-2 pr-3 text-slate-600">
                                    ${c.keywordRank === null
                                      ? html`<span class="text-slate-400">not found</span>`
                                      : `${c.keywordScore.toFixed(4)} (rank ${String(c.keywordRank)})`}
                                  </td>
                                  <td
                                    class="py-2 pr-3 ${c.vectorScore < settings.minScore
                                      ? 'text-red-600'
                                      : 'text-emerald-700'}"
                                  >
                                    ${c.vectorScore.toFixed(4)}
                                    ${c.vectorRank === null
                                      ? null
                                      : ` (rank ${String(c.vectorRank)})`}
                                  </td>
                                  <td class="py-2 pr-3 text-slate-600">
                                    ${c.documentWeight.toFixed(1)}
                                  </td>
                                  <td class="py-2 pr-3 text-slate-600">
                                    ${c.finalScore.toFixed(5)}
                                  </td>
                                  <td class="py-2 pr-3">
                                    ${c.selected
                                      ? badge('in the prompt', 'green')
                                      : c.rejectedBecause === 'below-floor'
                                        ? badge('below the floor', 'red')
                                        : c.rejectedBecause === 'over-budget'
                                          ? badge('over budget', 'amber')
                                          : badge('past the chunk limit', 'slate')}
                                  </td>
                                </tr>`,
                              )}
                            </tbody>
                          </table>
                        </div>
                        <p class="mt-3 text-xs text-slate-500">
                          The floor is applied to the <strong>vector</strong> score and only to
                          it, because it is the one calibrated number: cosine similarity means
                          the same thing for every question. The fused score decides ORDER and
                          is not comparable between questions, so it is not a threshold you can
                          reason about.
                        </p>
                      `,
                )}
                ${result.sources.length > 0
                  ? html`<div class="mt-4">
                      ${card(
                        'What she would be given',
                        html`<p class="mb-3 text-sm text-slate-600">
                            The source line printed under her answer would read:
                            <strong>${result.sources.join(', ')}</strong>
                          </p>
                          ${result.passages.map(
                            (p) => html`<div class="mb-3 rounded-lg bg-slate-50 p-3">
                              <p class="text-xs font-medium text-slate-500">${p.title}</p>
                              <p class="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                                ${p.text}
                              </p>
                            </div>`,
                          )}`,
                      )}
                    </div>`
                  : null}
              </div>`
            : null
        }
      `;

      reply.type('text/html');
      return page({
        title: 'Retrieval diagnostics',
        active: `plugin:${KNOWLEDGE_BASE_ID}`,
        csrfToken: csrf,
        body,
        botSwitcher: { ...selection, returnTo: '/plugins/knowledge-base/diagnostics' },
      });
    },
  );

  /* ── Writes ──────────────────────────────────────────────────────────────── */

  const back = (q = ''): string => `/plugins/knowledge-base${q}`;
  const fail = (message: string): string =>
    back(`?error=${encodeURIComponent(message)}`);

  app.post<{ Body: Record<string, unknown> }>(
    '/plugins/knowledge-base/upload',
    async (req, reply) => {
      const body = req.body ?? {};
      const encoded = typeof body['imageData'] === 'string' ? body['imageData'] : '';
      const filename = typeof body['fileName'] === 'string' ? body['fileName'] : '';
      const title = (typeof body['title'] === 'string' ? body['title'] : '').trim();
      if (!encoded) return reply.redirect(fail('No file was read. Choose one and try again.'));

      const contentType = contentTypeFor(filename || title || '.md');
      if (contentType === null) {
        return reply.redirect(
          fail(
            `"${filename}" is not a format this accepts. Markdown and plain text only: ` +
              `${Object.keys(ACCEPTED_TYPES).join(', ')}. PDF is deliberately not accepted.`,
          ),
        );
      }

      let text: string;
      try {
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
          return reply.redirect(
            fail(`That file is ${fmtBytes(bytes.byteLength)}, over the ${fmtBytes(MAX_DOCUMENT_BYTES)} limit.`),
          );
        }
        text = bytes.toString('utf8');
        // A NUL byte means this is not text, whatever the extension said. Refused rather
        // than stored, because a binary file stored as text produces chunks that look like
        // text and retrieve like noise, and it would also make the row unsearchable by grep
        // for anybody reading a dump of it later.
        if (text.includes('\u0000')) {
          return reply.redirect(
            fail('That file contains binary data rather than text, so it was not stored.'),
          );
        }
      } catch {
        return reply.redirect(fail('That file could not be decoded.'));
      }

      if (text.trim() === '') {
        return reply.redirect(fail('That file is empty, so there would be nothing to retrieve.'));
      }

      try {
        const stored = await upsertDocument(db, {
          title: title || filename || 'Untitled',
          sourceName: filename || 'upload',
          contentType,
          body: text,
          checksum: checksumOf(text),
        });
        if (stored.alreadyStored) {
          return reply.redirect(
            back('?note=' + encodeURIComponent('Those exact bytes are already stored, so nothing was re-embedded.')),
          );
        }
        await enqueueJob(db, KNOWLEDGE_INGEST_JOB, {
          idempotencyKey: knowledgeIngestKey(stored.id),
          lane: 'bulk',
          payload: { documentId: stored.id },
        });
        return reply.redirect(
          back('?note=' + encodeURIComponent('Stored. Ingest is queued; it becomes retrievable when it reaches ready.')),
        );
      } catch (error) {
        return reply.redirect(fail(error instanceof Error ? error.message : String(error)));
      }
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/plugins/knowledge-base/:id/grant',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const rawBot = (req.body ?? {})['botProfileId'];
      const botProfileId = Number.parseInt(typeof rawBot === 'string' ? rawBot : '', 10);
      const state = (req.body ?? {})['state'];
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(botProfileId)) {
        return reply.redirect(fail('That grant named no document or no bot.'));
      }
      const enabled = state === 'on' ? true : state === 'off' ? false : null;
      try {
        await setGrant(db, id, botProfileId, enabled);
      } catch (error) {
        return reply.redirect(fail(error instanceof Error ? error.message : String(error)));
      }
      return reply.redirect(back(`?saved=1&bot=${String(botProfileId)}`));
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/plugins/knowledge-base/:id/weight',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const rawWeight = (req.body ?? {})['weight'];
      const weight = Number.parseFloat(typeof rawWeight === 'string' ? rawWeight : '1');
      if (!Number.isSafeInteger(id)) return reply.redirect(fail('No document was named.'));
      await setDocumentWeight(db, id, weight);
      return reply.redirect(back('?saved=1'));
    },
  );

  const enqueueIngest = async (documentId: number): Promise<void> => {
    // Back to `pending` first, so the list says what is happening. Without this a re-ingest
    // of a ready document looks like nothing happened until it finishes.
    await setDocumentState(db, documentId, 'pending', { error: null });
    await enqueueJob(db, KNOWLEDGE_INGEST_JOB, {
      idempotencyKey: `${knowledgeIngestKey(documentId)}:${String(Date.now())}`,
      lane: 'bulk',
      payload: { documentId },
    });
  };

  app.post<{ Params: { id: string } }>(
    '/plugins/knowledge-base/:id/reingest',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isSafeInteger(id)) return reply.redirect(fail('No document was named.'));
      await enqueueIngest(id);
      return reply.redirect(back('?note=' + encodeURIComponent('Re-ingest queued.')));
    },
  );

  app.post('/plugins/knowledge-base/reingest-all', async (req, reply) => {
    const settings = plugins.getKnowledge();
    const current = ingestSignature(settings);
    const stale = (await listDocuments(db)).filter(
      (d) => d.state === 'ready' && d.ingestSignature !== current,
    );
    for (const d of stale) await enqueueIngest(d.id);
    return reply.redirect(
      back('?note=' + encodeURIComponent(`Queued ${String(stale.length)} document(s) for rebuild.`)),
    );
  });

  app.post<{ Params: { id: string } }>(
    '/plugins/knowledge-base/:id/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isSafeInteger(id)) return reply.redirect(fail('No document was named.'));
      const removed = await deleteDocument(db, id);
      return reply.redirect(
        back(
          '?note=' +
            encodeURIComponent(
              removed
                ? 'Removed, with every chunk it had. Nothing of it is retrievable.'
                : 'That document was already gone.',
            ),
        ),
      );
    },
  );

  app.post<{ Body: Record<string, unknown> }>(
    '/plugins/knowledge-base/settings',
    async (req, reply) => {
      const body = req.body ?? {};
      const section = typeof body['section'] === 'string' ? body['section'] : '';
      const actor = req.session?.username ?? 'unknown';
      const before = plugins.getKnowledge();

      // Only the fields of the section that was submitted. Posting the whole settings object
      // from one form would let the retrieval form silently rewrite the ingest values it
      // never rendered, which is how a store gets cut two ways without anybody choosing it.
      const keys: (keyof KnowledgeSettings)[] =
        section === 'ingest'
          ? [...INGEST_SETTING_KEYS]
          : ['trigger', 'candidatesPerSearch', 'maxChunks', 'keywordWeight', 'vectorWeight', 'minScore', 'budgetChars'];

      const next: Record<string, unknown> = {};
      for (const key of keys) {
        if (key === 'contextualPrefix') {
          // An unchecked checkbox posts nothing, so absence is false rather than unset.
          next[key] = body[key] === 'on';
          continue;
        }
        if (key in body) next[key] = body[key];
      }

      try {
        const { ingestChanged } = await plugins.saveKnowledge(next, actor);
        const stale = ingestChanged
          ? (await listDocuments(db)).filter(
              (d) => d.state === 'ready' && d.ingestSignature !== ingestSignature(plugins.getKnowledge()),
            ).length
          : 0;
        return reply.redirect(
          back(
            '?note=' +
              encodeURIComponent(
                ingestChanged
                  ? `Saved. ${String(stale)} document(s) are now stale: their chunks were cut ` +
                      `under the previous settings. They stay retrievable until you rebuild them.`
                  : 'Saved. This takes effect on the next question; nothing is re-ingested.',
              ),
          ),
        );
      } catch (error) {
        void before;
        return reply.redirect(fail(error instanceof Error ? error.message : String(error)));
      }
    },
  );
}
