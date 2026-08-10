/**
 * The public demo surface (CCB-S4-001, Phase 1).
 *
 * A visitor types into a chat pane; the message goes through the REAL resolver,
 * the REAL consent logic and the REAL persistence, and the REAL admin views
 * beside it update. Only SimpleX is replaced, by the in-memory adapter from
 * CCB-S3-020 §6.
 *
 * ── The visitor is authenticated, not exempted ───────────────────────────────
 *
 * `/demo/enter` mints an ORDINARY admin session through the ordinary
 * `SessionStore`. Every admin route then stays behind exactly the session check it
 * has always had, and no route learns that a demo exists. The exposure is
 * therefore "anyone can obtain a demo session on a database containing only
 * synthetic data", not "the admin console is now unauthenticated" - a much smaller
 * and much more legible claim.
 *
 * ── Phase 1 runs the deterministic layer only ────────────────────────────────
 *
 * No model. The four guided prompts do not need one: publish, price, unpublish and
 * the third-party refusal all resolve through the rule resolver, the plugin and
 * the consent layer. The refusal in particular - the thing the demo is for - is
 * enforced by application logic, not by the model's cooperation. The interface
 * says so plainly rather than implying a model is answering.
 *
 * ── Nothing here is retained ─────────────────────────────────────────────────
 *
 * Visitor text lands in the demo database, which resets hourly and on demand. It
 * is never written to the production database, never reaches production logs, and
 * the demo instance has no route back to production.
 */

import type { FastifyInstance } from 'fastify';

import { FakeChatAdapter } from '../adapter/fake.js';
import type { CapturedMessage } from '../capture/message.js';
import { InteractionEngine } from '../interaction/engine.js';
import { log } from '../log.js';
import type { ViewContext } from '../web/server.js';

/** Messages one visitor may send before the demo asks them to reset. */
export const SESSION_MESSAGE_BUDGET = 25;
/** How often the demo database resets by itself. */
export const RESET_INTERVAL_MS = 60 * 60 * 1000;

/** The synthetic member a visitor speaks as. */
const DEMO_MEMBER = 'demo-visitor';
const DEMO_GROUP = 1;

interface DemoSession {
  used: number;
  startedAt: number;
}

const budgets = new Map<string, DemoSession>();

export function demoBudgetFor(sessionId: string): DemoSession {
  let s = budgets.get(sessionId);
  if (!s) {
    s = { used: 0, startedAt: Date.now() };
    budgets.set(sessionId, s);
  }
  return s;
}

export function clearDemoBudgets(): void {
  budgets.clear();
}

/**
 * Wipes the demo archive back to empty.
 *
 * Deliberately narrow: the tables a visitor can write, and nothing else. It does
 * NOT touch `settings`, because the demo marker lives there and wiping it would
 * disable the demo until it was reseeded.
 */
export async function resetDemoData(ctx: ViewContext): Promise<void> {
  // Order matters only where a foreign key would complain; `messages` cascades to
  // links, mentions, reports and pending destructions.
  await ctx.db.query('DELETE FROM evidence_holds');
  await ctx.db.query('DELETE FROM messages');
  await ctx.db.query('DELETE FROM consent_actions');
  await ctx.db.query('DELETE FROM consent_gaps');
  await ctx.db.query('DELETE FROM consent');
  await ctx.db.query('DELETE FROM jobs');
  clearDemoBudgets();
  log.info('Demo: archive reset to empty.');
}

/** Builds the domain message a visitor's typing becomes. */
function visitorMessage(text: string, itemId: number): CapturedMessage {
  return {
    groupId: DEMO_GROUP,
    groupName: 'Demo Group',
    itemId,
    sharedMsgId: `demo-${String(itemId)}`,
    senderMemberId: DEMO_MEMBER,
    senderDisplayName: 'You',
    sentAt: new Date().toISOString(),
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: { demo: true, itemId },
  } as unknown as CapturedMessage;
}

export interface DemoReply {
  from: 'cinderella';
  text: string;
}

export function registerDemo(app: FastifyInstance, ctx: ViewContext): void {
  // The transport. A browser message becomes an inbound event; her replies come
  // back out of the same object. Everything between is production code.
  const transport = new FakeChatAdapter();
  let nextItemId = 1000;

  const engine = new InteractionEngine({
    db: ctx.db,
    settings: () => ctx.interaction.get(),
    // The demo has no bot, so it gets the DEPLOYMENT'S capabilities (CCB-S5-021). Stated
    // rather than inherited: with no bot named there is nothing to deviate from, and the
    // demo showing a capability the visitor's imaginary bot does not have is not a
    // question that exists here.
    capabilities: () => ctx.plugins.capabilitiesFor(),
    // Phase 1: no `personalize`, so the deterministic persona strings answer.
    send: async (_msg, text) => {
      await transport.sendText({ to: 'group', groupId: DEMO_GROUP }, text);
      return Promise.resolve();
    },
  });

  /**
   * Mints an ordinary admin session for the visitor.
   *
   * `authMethod: 'password'` on purpose, NOT 'passkey': a passkey login counts as
   * a fresh step-up, and a demo visitor should not arrive already cleared for
   * step-up-guarded mutations.
   */
  app.post('/demo/enter', async (req, reply) => {
    const { id } = await ctx.sessions.create('demo-visitor', 'password');
    reply.setCookie('cinderella_session', id, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
    });
    return reply.send({ ok: true });
  });

  /** One visitor message in, her replies out. */
  app.post<{ Body: { text?: string } }>('/demo/chat', async (req, reply) => {
    const session = req.session;
    if (!session) return reply.code(401).send({ error: 'start the demo first' });

    const budget = demoBudgetFor(session.sessionId);
    if (budget.used >= SESSION_MESSAGE_BUDGET) {
      return reply.send({
        replies: [],
        budgetExhausted: true,
        note: `This demo session has reached its ${String(SESSION_MESSAGE_BUDGET)} message limit. Reset the demo to carry on.`,
      });
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
    if (!text) return reply.send({ replies: [] });

    budget.used += 1;
    const before = transport.sends.length;

    try {
      await engine.handle(visitorMessage(text, nextItemId++));
    } catch (err) {
      log.error(`Demo: engine failed on a visitor message: ${err instanceof Error ? err.message : String(err)}`);
      return reply.send({
        replies: [{ from: 'cinderella', text: 'Something went wrong in the demo. Try a reset.' }],
      });
    }

    const replies: DemoReply[] = transport.sends
      .slice(before)
      .map((s) => ({ from: 'cinderella' as const, text: s.text }));

    return reply.send({
      replies,
      used: budget.used,
      budget: SESSION_MESSAGE_BUDGET,
      // Phase 1 is always the deterministic layer. Stated on every response so the
      // interface can show it as the architectural point rather than a fallback
      // notice that appears only when something breaks.
      engine: 'rules',
    });
  });

  /** The visible reset button. */
  app.post('/demo/reset', async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: 'start the demo first' });
    await resetDemoData(ctx);
    return reply.send({ ok: true });
  });

  // The scheduled reset. Unref'd so it never holds the process open.
  const timer = setInterval(() => {
    void resetDemoData(ctx).catch((err: unknown) => {
      log.error(`Demo: scheduled reset failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, RESET_INTERVAL_MS);
  timer.unref();

  log.info('Demo: chat surface registered (deterministic layer, no model).');
}
