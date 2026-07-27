/**
 * The hash-screening seam (CCB-S3-012 §3).
 *
 * Modelled deliberately on the price-provider chain (`src/plugins/crypto-prices/
 * providers/types.ts`), which has proven itself: a narrow interface, an
 * `isConfigured()` gate that makes "not configured" mean "never contacted", and
 * health kept outside the provider so the console can see it.
 *
 * WHAT A PROVIDER IS ALLOWED TO DO, and it is deliberately almost nothing:
 * compare a file, or a hash of it, against a list of hashes of KNOWN material and
 * return a verdict. That is the only operation permitted here. No human review,
 * no general-purpose classifier, no visual inspection, no "does this look like".
 * The operator may not analyse suspect images, and neither may this code.
 *
 * THE LIMIT, which must never be dressed up as more than it is: hash matching
 * detects KNOWN material. It does not detect new material, and it cannot. A
 * provider returning `no-match` means "not on the list", never "safe". Nothing in
 * the product may present it otherwise.
 *
 * NOTHING LEAVES THE HOST UNLESS A PROVIDER IS EXPLICITLY CONFIGURED AND ENABLED.
 * The default is {@link nullScreeningProvider}, which answers `not-screened`
 * without opening a socket. This is the analytics-off-by-default discipline, and
 * it matters more here: the content in question is the most sensitive the system
 * will ever hold, and a misdirected upload is not recoverable.
 */

/**
 * What a provider concluded.
 *
 * `not-screened` is a first-class outcome, not a failure code. It is what the
 * null provider always returns, and what a configured provider degrades to when
 * it is unreachable. It means exactly "no opinion was formed", and the item
 * proceeds through capture untouched.
 */
export type ScreeningVerdict = 'match' | 'no-match' | 'not-screened' | 'error';

export interface ScreeningResult {
  verdict: ScreeningVerdict;
  /** The provider that answered, for the audit record and the health table. */
  provider: string;
  /**
   * Provider-side reference for a match, e.g. a list identifier. NEVER the
   * content, and never anything derived from it that could be used to reconstruct
   * or recognise it outside this system.
   */
  reference?: string;
  /** Operator-facing cause when `verdict` is `error`. Never content. */
  detail?: string;
}

export interface ScreeningRequest {
  /** Internal message id. The only identifier a provider ever receives from us. */
  messageId: number;
  /** Declared mime, so a provider can refuse a type it does not handle. */
  mime: string | null;
  /**
   * The PLAINTEXT bytes, supplied lazily.
   *
   * A function rather than a Buffer on purpose: the null provider must be able to
   * decline without the original ever being decrypted. Reading the bytes is the
   * moment custody material becomes plaintext in memory, so it happens only when
   * a configured provider has actually asked for it.
   */
  bytes: () => Promise<Buffer>;
}

export interface ScreeningProvider {
  /** Stable slug. Doubles as the settings key and the health-table row key. */
  readonly name: string;
  readonly label: string;
  /**
   * Whether this provider will do anything. False means it is never called and
   * nothing is transmitted. The chain skips it silently, because "off" is a
   * choice and not a fault.
   */
  isConfigured(): boolean;
  /** True when answering requires sending content off this host. */
  readonly transmitsContent: boolean;
  screen(req: ScreeningRequest): Promise<ScreeningResult>;
}

/**
 * The default provider: forms no opinion, contacts nothing, reads nothing.
 *
 * `transmitsContent` is false and `isConfigured()` is true, which together are the
 * point: the pipeline runs end to end in the shipped configuration, exercising
 * every path including quarantine, while no byte of member content is read or
 * sent anywhere.
 */
export const nullScreeningProvider: ScreeningProvider = {
  name: 'none',
  label: 'No screening provider',
  transmitsContent: false,
  isConfigured: () => true,
  screen: (req) =>
    Promise.resolve({ verdict: 'not-screened', provider: 'none', messageId: req.messageId } as
      ScreeningResult),
};
