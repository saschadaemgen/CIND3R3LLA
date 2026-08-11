/**
 * What several bots cost each other at the model (CCB-S5-001, D-155).
 *
 * ── WHY THIS IS THE NUMBER THAT MATTERS ──────────────────────────────────────
 *
 * Bots do not cost VRAM. The model is shared and loaded once, so a second bot adds no
 * weights and no memory. What a second bot costs is QUEUE TIME: Ollama runs one request at
 * a time in this deployment (`OLLAMA_NUM_PARALLEL=1`, set deliberately during a Season 4
 * incident when a change pushed the model onto the CPU), so a bot answering while another
 * is mid-reply waits for it to finish.
 *
 * The operator asked to see this before deciding anything about it, which is the right
 * instinct and the reason this file measures and tunes nothing.
 *
 * ── WHAT IS MEASURED AND WHAT IS INFERRED, KEPT APART ────────────────────────
 *
 * MEASURED, from this process, with no cooperation from the model server:
 *   - when each request started and finished, so total latency is exact;
 *   - how many of our own requests were already in flight when one started, so
 *     "queued behind another" is a fact rather than an estimate;
 *   - replies per minute, per bot and overall.
 *
 * INFERRED, and labelled as such wherever it is shown:
 *   - the split between WAITING and GENERATING. Ollama reports neither, and there is no
 *     endpoint that does. The split rests on the serialisation assumption: with one slot,
 *     a request cannot begin generating until every request already in flight has
 *     finished, so the overlap with those requests IS the wait. That is sound while the
 *     server really does run one at a time and WRONG if somebody raises the parallelism,
 *     which is exactly why the console prints the assumed setting beside the numbers
 *     instead of hiding it.
 *
 * The parallelism itself cannot be read from the client either: it is a server-side
 * environment variable with no endpoint exposing it. What the console shows is the
 * operator's own record of it, said plainly as a record rather than as a reading.
 *
 * ── PURE, AND IN-PROCESS ─────────────────────────────────────────────────────
 *
 * No database. This is short-lived operational state of exactly the kind
 * `ConversationState` already keeps in memory, and persisting a row per model call would
 * put a write on the reply path to answer a question the operator asks occasionally.
 * Losing it on restart costs a window of history and nothing else.
 */

/** One completed model call. */
export interface ModelCallRecord {
  botProfileId: number | null;
  startedAt: number;
  finishedAt: number;
  /** Our own requests already in flight when this one started. */
  queuedBehind: number;
  /**
   * Inferred time this call spent waiting for the slot. See the header: this is the
   * overlap with requests that were already running, not a figure the server reported.
   */
  waitedMs: number;
  ok: boolean;
  /**
   * How many characters the call produced, when it produced any (CCB-S5-025).
   *
   * Absent on a failure, on a call whose reply was rejected by a guard, and on any caller
   * that does not report it. Present only so {@link ModelQueueMeter.observedCharsPerSecond}
   * can answer how fast this deployment actually writes, which is the one thing the
   * lookup announcement needs and the one thing no shipped constant can know.
   */
  replyChars?: number;
}

export interface BotModelStats {
  botProfileId: number | null;
  calls: number;
  failed: number;
  /** Calls that started while at least one other was in flight. */
  queued: number;
  totalMs: number;
  waitedMs: number;
  /** Longest single wait, because an average hides the reply that took nine seconds. */
  worstWaitMs: number;
}

export interface ModelQueueSnapshot {
  /** Rolling window these numbers cover, in minutes. */
  windowMinutes: number;
  inFlight: number;
  overall: BotModelStats;
  perBot: BotModelStats[];
  /** Completed calls per minute over the window, overall. */
  repliesPerMinute: number;
  /**
   * The parallelism the operator has recorded for the model server.
   *
   * Not a reading. Ollama exposes no endpoint for `OLLAMA_NUM_PARALLEL`, so this is what
   * the deployment says it set, and the inferred wait/generate split is only as true as
   * this value is.
   */
  assumedParallelism: number;
}

const WINDOW_MINUTES = 15;
const WINDOW_MS = WINDOW_MINUTES * 60_000;
/** Enough to cover the window at a busy rate without growing without bound. */
const MAX_RECORDS = 2000;

/**
 * How many replies must be in the window before {@link ModelQueueMeter.observedCharsPerSecond}
 * will answer (CCB-S5-025).
 *
 * Three, because the FIRST reply after a restart is unrepresentative by a wide margin: it
 * pays for loading the model, which measured 3 to 8 seconds against sub-second warm calls.
 * Answering from one sample would peg the rate at the slowest reading this process ever
 * takes and then hold it for fifteen minutes.
 */
const MIN_RATE_SAMPLES = 3;

function emptyStats(botProfileId: number | null): BotModelStats {
  return {
    botProfileId,
    calls: 0,
    failed: 0,
    queued: 0,
    totalMs: 0,
    waitedMs: 0,
    worstWaitMs: 0,
  };
}

/** One in-flight call, while it is running. */
interface Pending {
  botProfileId: number | null;
  startedAt: number;
}

export class ModelQueueMeter {
  private readonly records: ModelCallRecord[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /**
   * When each currently-running call is expected to free the slot, in start order.
   *
   * The wait a new call inherits is the time until the LAST of these finishes, because
   * one slot means they drain in order. Recomputed as calls complete rather than
   * predicted, so a slow call lengthens the inferred wait of everything behind it.
   */
  private slotFreeAt = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    /** The recorded server setting. See {@link ModelQueueSnapshot.assumedParallelism}. */
    public assumedParallelism = 1,
  ) {}

  /** Begin a call. Returns the handle {@link finish} takes. */
  start(botProfileId: number | null): number {
    const id = this.nextId++;
    const at = this.now();
    this.pending.set(id, { botProfileId, startedAt: at });
    // With one slot, a call arriving while the slot is busy waits for it. `slotFreeAt`
    // is the running estimate of when that is; a call arriving after it waits not at all.
    if (this.slotFreeAt < at) this.slotFreeAt = at;
    return id;
  }

  /** End a call, recording what it cost and how much of that was waiting. */
  finish(id: number, ok: boolean, replyChars?: number): void {
    const p = this.pending.get(id);
    if (p === undefined) return;
    this.pending.delete(id);
    const at = this.now();

    // Everything that was in flight when this started, this one excluded.
    const queuedBehind = [...this.pending.values()].filter(
      (o) => o.startedAt <= p.startedAt,
    ).length;

    // The inferred wait: how long after this call started the slot actually came free.
    // Bounded by the call's own duration, because a call cannot have waited longer than
    // it took, and floored at zero for a call that found the slot idle.
    const waited =
      this.assumedParallelism > 1
        ? 0
        : Math.max(0, Math.min(at - p.startedAt, this.slotFreeAtWhenStarted(p.startedAt)));

    this.records.push({
      botProfileId: p.botProfileId,
      startedAt: p.startedAt,
      finishedAt: at,
      queuedBehind,
      waitedMs: waited,
      ok,
      ...(ok && typeof replyChars === 'number' && replyChars > 0 ? { replyChars } : {}),
    });
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    this.slotFreeAt = Math.max(this.slotFreeAt, at);
  }

  /**
   * How long after `startedAt` the slot was still occupied by earlier work.
   *
   * Derived from the records of calls that had already started, rather than from a
   * predicted schedule: a call is only counted as blocking if it actually finished after
   * this one started.
   */
  private slotFreeAtWhenStarted(startedAt: number): number {
    let latest = startedAt;
    for (const r of this.records) {
      if (r.startedAt < startedAt && r.finishedAt > latest) latest = r.finishedAt;
    }
    for (const o of this.pending.values()) {
      if (o.startedAt < startedAt) return Math.max(latest - startedAt, 0);
    }
    return latest - startedAt;
  }

  /**
   * How fast this deployment actually writes, in characters a second, or null if it has
   * not written enough yet to say (CCB-S5-025).
   *
   * ── WHY THIS IS MEASURED AND NOT A CONSTANT ────────────────────────────────
   *
   * The lookup announcement is worth sending only when the member is going to be kept
   * waiting, and the wait is dominated by how long her reply takes to WRITE rather than by
   * the lookup, which is milliseconds. So the decision needs a generation rate. The first
   * build of this shipped one as a constant, measured on one model on one machine, and that
   * was wrong in a way worth recording: measured on the same box, the same prompt shape and
   * the same `reasoning_effort: 'none'` the transport sends, `qwen3:32b` wrote at ~138
   * characters a second and `qwen3.5:9b` at ~414. Both are models this repository ships a
   * default for, they are THREE TIMES apart, and the operator's own production figure of a
   * 16.4 second reply matches neither, because production is different hardware again.
   *
   * A constant would therefore have made her announce a two second wait on one deployment
   * and stay silent through a sixteen second one on another. There is no number that is
   * right for a deployment this code has never run on, so it is read from her own replies
   * instead. It costs one integer per call on a meter that was already recording the times.
   *
   * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
   *
   * Wall clock, including prefill and any queue wait, because that is the silence the
   * member actually sits through. The MEDIAN rather than the mean, so one reply that queued
   * behind another bot does not drag the estimate down for the next hour.
   *
   * Returns null until {@link MIN_RATE_SAMPLES} replies are in the window. A caller with no
   * reading should announce rather than stay quiet: a cold process is the slowest this will
   * ever be, since the first call also pays for loading the model, which was 3 to 8 seconds
   * of the measurements above.
   */
  observedCharsPerSecond(): number | null {
    const at = this.now();
    this.prune(at - WINDOW_MS);
    const rates: number[] = [];
    for (const r of this.records) {
      const chars = r.replyChars;
      if (chars === undefined) continue;
      const ms = r.finishedAt - r.startedAt;
      // A call the clock recorded as instantaneous cannot produce a rate, and dividing by
      // it would produce Infinity and silence every announcement from then on.
      if (ms <= 0) continue;
      rates.push(chars / (ms / 1000));
    }
    if (rates.length < MIN_RATE_SAMPLES) return null;
    rates.sort((a, b) => a - b);
    const mid = rates.length >> 1;
    return rates.length % 2 === 1
      ? (rates[mid] as number)
      : ((rates[mid - 1] as number) + (rates[mid] as number)) / 2;
  }

  /** Drop records older than the window. Called before every read. */
  private prune(cutoff: number): void {
    let drop = 0;
    while (drop < this.records.length && (this.records[drop]?.finishedAt ?? 0) < cutoff) drop++;
    if (drop > 0) this.records.splice(0, drop);
  }

  snapshot(): ModelQueueSnapshot {
    const at = this.now();
    this.prune(at - WINDOW_MS);

    const overall = emptyStats(null);
    const byBot = new Map<number | null, BotModelStats>();

    for (const r of this.records) {
      const dur = r.finishedAt - r.startedAt;
      const bucket = byBot.get(r.botProfileId) ?? emptyStats(r.botProfileId);
      for (const s of [overall, bucket]) {
        s.calls++;
        if (!r.ok) s.failed++;
        if (r.queuedBehind > 0) s.queued++;
        s.totalMs += dur;
        s.waitedMs += r.waitedMs;
        if (r.waitedMs > s.worstWaitMs) s.worstWaitMs = r.waitedMs;
      }
      byBot.set(r.botProfileId, bucket);
    }

    // Per minute over the window that has actually elapsed, not over the nominal window:
    // a process up for two minutes must not report a third of its real rate.
    const earliest = this.records[0]?.startedAt ?? at;
    const elapsedMinutes = Math.max(1 / 60, (at - earliest) / 60_000);

    return {
      windowMinutes: WINDOW_MINUTES,
      inFlight: this.pending.size,
      overall,
      perBot: [...byBot.values()].sort((a, b) => b.calls - a.calls),
      repliesPerMinute: overall.calls / elapsedMinutes,
      assumedParallelism: this.assumedParallelism,
    };
  }

  /** For the console's reset control, and for the harness. */
  reset(): void {
    this.records.length = 0;
    this.pending.clear();
    this.slotFreeAt = 0;
  }
}

/**
 * The process-wide meter.
 *
 * Registered like the other reply-path services rather than passed down: the transport
 * that calls the model is several layers below the wiring that knows which bot is
 * speaking, and threading a meter through every one of them to count something would be a
 * worse trade than a module-level instance.
 */
export const modelQueue = new ModelQueueMeter();

/** Average, guarding the empty case so a console never renders NaN. */
export function meanMs(total: number, calls: number): number {
  return calls === 0 ? 0 : Math.round(total / calls);
}
