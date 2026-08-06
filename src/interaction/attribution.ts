/**
 * The source line (CCB-S4-042, D-145): the domain a member can judge, and a link they can
 * actually open.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * The line printed hosts only, and a member asked directly: *"It lists only Domains, not
 * doc links?"* They were right. `example.org` is auto-detected as a link by SimpleX and
 * therefore looks clickable, so it reads as a broken one: tapping it lands on a homepage
 * rather than on the page the answer came from.
 *
 * ── WHAT SIMPLEX ACTUALLY RENDERS, MEASURED RATHER THAN ASSUMED ──────────────
 *
 * The briefing asked for the domain as the visible text with the URL behind it, and asked
 * that this be confirmed rather than assumed. It was, against the SHIPPED 6.5.4 core
 * (`chat_parse_markdown` is not exposed by the Node binding, so the oracle was a real
 * chat item in a throwaway group, read back through `chatItem.formattedText`), and the
 * result changed the design:
 *
 *   `[text](https://example.org/x)`        -> hyperLink{showText:"text", linkUri:"…"}  ✓
 *   `[example.org](https://example.org/x)` -> NO FORMATTING AT ALL, whole message literal
 *
 * A DOT IN THE DISPLAY TEXT KILLS THE PARSE, and not only for that run: the entire
 * message comes back unformatted, brackets and parentheses included. So the exact shape
 * the briefing asked for is the one shape SimpleX will not render, and shipping it blind
 * would have put `[example.org](https://…)` in the group as literal text. That is the
 * same class of failure `docs/wire-format.md` records from the asterisks incident.
 *
 * ── SO THE LINE IS DOMAIN, THEN A NUMBERED LINK ──────────────────────────────
 *
 *   🔎 From the web: example.org [1](https://example.org/a/deep/page), other.net [2](…)
 *
 * Measured: the domain renders as a `uri` run (visible, judgeable, and clickable to the
 * host exactly as before) and `[1]` renders as a `hyperLink` carrying the deep URL. Both
 * halves of what the briefing wanted, in the only arrangement the parser accepts. The
 * number is not decoration, it is the shortest display text that is guaranteed to contain
 * no dot.
 */

import type { SearchResult } from '../plugins/web-search/providers/types.js';

/**
 * How much of the reply budget the source line may take.
 *
 * The line is appended AFTER the model's answer and is not counted by the model's own
 * character bound, so without a limit here four long URLs could double the length of a
 * short answer. Sources are dropped from the end rather than truncated, because half a URL
 * is a broken link and a broken link is worse than an absent one.
 */
const MAX_ATTRIBUTION_CHARS = 400;

/** At most this many, however short they are. Four citations is already a lot to read. */
const MAX_SOURCES = 4;

/** The host, for the part a member reads to decide whether to trust the answer. */
function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The attribution entries for the results an answer actually used.
 *
 * `used` is the model's declaration of which results it drew on, as indices into
 * `results`. Everything about it is treated as untrusted input: out-of-range, duplicate,
 * non-integer and negative entries are dropped rather than clamped, because a clamped
 * index cites a page the answer did not use and a wrong citation is worse than none.
 *
 * An empty `used` yields an empty list. That is the fail-closed default the caller relies
 * on: no declaration, no attribution.
 */
export function attributionFor(
  results: readonly SearchResult[],
  used: readonly number[],
): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];
  let budget = MAX_ATTRIBUTION_CHARS;

  for (const index of used) {
    if (!Number.isInteger(index) || index < 0 || index >= results.length) continue;
    const result = results[index];
    if (!result) continue;

    const domain = host(result.url);
    if (!domain || seen.has(result.url)) continue;
    seen.add(result.url);

    // The numbering is the POSITION IN THIS LINE, not the index in the result set. A
    // member reading "[3]" next to the first citation would reasonably wonder what one and
    // two were, and the answer would be "results she did not use", which is not something
    // the line should be inviting questions about.
    const entry = `${domain} [${entries.length + 1}](${result.url})`;
    if (entry.length > budget) break;

    budget -= entry.length + 2; // the ", " that joins it to the previous one
    entries.push(entry);
    if (entries.length >= MAX_SOURCES) break;
  }

  return entries;
}
