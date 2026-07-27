/**
 * Stage 7: SimpleX sanitisation (briefing §8).
 *
 * MUST RUN LAST, and only on the assembled display form. Running it earlier would
 * corrupt culturally correct names before they are formed: `O'Hara` has to exist as
 * `O'Hara` through stages 1 to 6, and only then become something SimpleX accepts.
 *
 * SimpleX rejects `.` and `'` in display names. The CLI path hangs on an
 * interactive prompt when it encounters them, which is how this was originally
 * found: not an error, a hang.
 *
 * Both forms are returned so a stripped character is visible rather than silent.
 * That is the same principle as the rest of this repository: a degraded result must
 * not be presented as a clean one.
 */

/**
 * Characters SimpleX refuses in a display name.
 *
 * Deliberately a small, explicit allow-refusal set rather than a broad "strip
 * anything unusual" filter. Unicode letters, diacritics and hyphens are legal and
 * must survive: stripping them would defeat the point of culture-correct names.
 */
const REJECTED = /['.]/g;

export interface SanitisedName {
  /** Safe to hand to SimpleX. */
  displayName: string;
  /** True when sanitisation actually changed something. */
  sanitised: boolean;
}

/**
 * Strip the characters SimpleX rejects.
 *
 * `O'Hara` becomes `OHara` rather than `O Hara`: closing up preserves the name as
 * one token, where substituting a space would invent a second name part and change
 * how the name reads. `St. John` likewise becomes `St John` only because the space
 * was already there.
 *
 * Whitespace introduced by removal is collapsed, and the result is trimmed, so a
 * name cannot end up with a leading, trailing or doubled space.
 */
export function sanitiseForSimplex(name: string): SanitisedName {
  const stripped = name.replace(REJECTED, '');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  return { displayName: collapsed, sanitised: collapsed !== name };
}

/** Whether a string would survive SimpleX unchanged. Used by the harness. */
export function isSimplexSafe(name: string): boolean {
  return !/['.]/.test(name);
}
