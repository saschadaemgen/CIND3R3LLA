/**
 * Which face each hosted bot wears (CCB-S5-007, D-161).
 *
 * ── WHY THIS IS A FILE AND NOT A LOOP INSIDE `host.ts` ───────────────────────
 *
 * It shipped as a loop inside `startRuntimeHost`, which is correct code in a place nothing
 * can drive: reaching it needs a real SimpleX core, so the only proof the decision was right
 * was reading it. The decision is small and has four outcomes that matter, one of which is a
 * fault, so it is worth being able to ask it questions.
 *
 * Nothing here imports the SDK, deliberately, and `verify:runtime-host` asserts that under
 * D-105: it is a new file under `src/bot/runtime/`, so the standing check was walked against
 * it rather than assumed to cover it.
 *
 * ── THE MODEL: A PATH PER BOT, AND `null` IS AN ANSWER ───────────────────────
 *
 * `AVATAR_PATH` is one image in the environment, so before this the operator could dress the
 * first bot and no other. Applying that one image to every profile was considered and
 * rejected: several bots wearing one face looks deliberate and is not, where a bot with no
 * picture at least looks unfinished.
 *
 * Now each bot carries its own path or `null`, and `null` means the deployment default, which
 * is that same `AVATAR_PATH`. So there is no special primary case anywhere: the first bot
 * keeps exactly the picture it has because it has no upload and falls back, and a second bot
 * gets its own the moment one is uploaded for it.
 *
 * ── AND WHY A BAD PATH DOES NOT WEAR THE DEFAULT ─────────────────────────────
 *
 * A configured-but-unreadable avatar is a FAULT and not a choice (CCB-S3-023). Falling back
 * to the deployment default there would dress the bot as somebody else and say nothing, and
 * the operator's evidence that the upload worked would be a picture that is not theirs. So
 * that bot's stored profile is left exactly as it is, and the fault goes to the log AND to
 * the admin dashboard, because it is on the plugin/media path in the sense that matters: a
 * guarantee was lost and only the operator can restore it.
 *
 * One bot's bad path never stops another bot being dressed, and never stops the boot. That is
 * why the resolve and the read are both inside the try: a path that escapes the asset root
 * used to throw out of the boot loop entirely, which would have taken every other bot with it.
 */

/** One bot to dress, reduced to what the decision actually needs. */
export interface FaceTarget {
  /** For the log line and the operator-facing fault. */
  displayName: string;
  /** This bot's own image, relative to the asset root, or null for the deployment default. */
  avatarPath: string | null;
}

/** What was decided for one bot, so a caller can report it and a check can read it. */
export interface FaceOutcome<B extends FaceTarget> {
  bot: B;
  /** Where the image came from. `default` covers "no image configured anywhere" too. */
  source: 'own' | 'default' | 'fault';
  /** The data URI to dress with, or undefined for no image. Never set when `source` is 'fault'. */
  image: string | undefined;
  /** The operator-facing sentence, set only when `source` is 'fault'. */
  fault: string | null;
}

export interface FaceDeps {
  /**
   * The deployment default, already budgeted into the profile envelope, or undefined when
   * `AVATAR_PATH` names nothing readable. Undefined here is NOT a fault: a deployment with no
   * avatar at all is a choice, and it is the state every fresh install starts in.
   */
  defaultImage: string | undefined;
  /** Resolve a stored relative path against the asset root. Throws if it escapes. */
  resolve: (relativePath: string) => string;
  /** Read one image and budget it into the SimpleX profile envelope. */
  load: (absolutePath: string) => Promise<string | undefined>;
}

/**
 * The operator-facing sentence for a bot whose configured avatar could not be read.
 *
 * Composed here rather than at the call site so there is one wording, and so a check can
 * assert it names the bot: a dashboard line that said an avatar failed without saying whose
 * is unactionable the moment there are two bots, which is the whole subject of this briefing.
 */
export function avatarFault(displayName: string): string {
  return (
    `The avatar configured for "${displayName}" could not be read, so its profile was left ` +
    `as it was. Upload the image again on the AI bot page.`
  );
}

/**
 * Decide what every hosted bot wears, in order, without applying anything.
 *
 * Deciding and applying are separate so the decision is answerable on its own. The caller
 * walks the outcomes: dress the ones that have a face, raise the ones that do not.
 */
export async function decideFaces<B extends FaceTarget>(
  bots: readonly B[],
  deps: FaceDeps,
): Promise<FaceOutcome<B>[]> {
  const outcomes: FaceOutcome<B>[] = [];
  for (const bot of bots) {
    const own = bot.avatarPath;
    if (own === null) {
      outcomes.push({ bot, source: 'default', image: deps.defaultImage, fault: null });
      continue;
    }
    let image: string | undefined;
    try {
      image = await deps.load(deps.resolve(own));
    } catch {
      // Resolve refused the path, or the read threw. Same outcome either way, and both are
      // the operator's to fix; the distinction is in the log line the loader already wrote.
      image = undefined;
    }
    outcomes.push(
      image === undefined
        ? { bot, source: 'fault', image: undefined, fault: avatarFault(bot.displayName) }
        : { bot, source: 'own', image, fault: null },
    );
  }
  return outcomes;
}
