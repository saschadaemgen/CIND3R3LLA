/**
 * Website settings model (CCB-S2-012) — the three admin-configurable "building
 * blocks" for the public marketing site, ALL disabled by default. Persisted in the
 * `settings` table under the `site` key (no migration — the table is a generic
 * key→JSONB store), edited in the admin console, audited on every change.
 *
 * Doctrine (D-025): analytics, the cookie banner and social share ship but default
 * OFF; the operator opts in and carries the legal responsibility (requirements
 * differ by country). Analytics is consent-gated — it can only load once the cookie
 * banner has gathered consent (see {@link shouldLoadAnalytics}). Share is script-free
 * links, so it needs no banner. Values are normalized from untrusted input.
 */


/** Share targets that are pure link builders — no third-party script, no tracking.
 * Kept in step with {@link SHARE_NETWORKS} in src/web/share.ts (the URL/label/icon
 * source of truth); this is the settings-layer validation vocabulary. */
export const KNOWN_NETWORKS = [
  'x',
  'facebook',
  'reddit',
  'whatsapp',
  'telegram',
  'linkedin',
  'email',
] as const;
export type ShareNetwork = (typeof KNOWN_NETWORKS)[number];

export interface SiteSettings {
  analytics: {
    /** Master switch. Off by default; never loads before consent (see the banner). */
    enabled: boolean;
    /** Free-text provider label for the admin (e.g. "Plausible") — informational. */
    provider: string;
    /** HTTPS URL of the (first-party preferred) analytics snippet; '' = none. */
    scriptUrl: string;
  };
  cookieBanner: {
    /** Consent banner on/off. Gates analytics + any non-essential storage. */
    enabled: boolean;
    /** Link to the privacy policy shown in the banner; '' → the site's /legal page. */
    policyUrl: string;
  };
  socialShare: {
    /** Show script-free share links. Off by default; needs no banner. */
    enabled: boolean;
    /** Which networks to offer (subset of {@link KNOWN_NETWORKS}). */
    networks: ShareNetwork[];
  };
  /**
   * The public demo, if one is running (CCB-S3-030 / CCB-S4-001).
   *
   * Empty until the demo ships, and the header then renders a labelled chip rather
   * than a link. A nav entry that leads to a 404 is worse than one that says the
   * thing is coming, and the briefing forbids the 404 explicitly.
   */
  demoUrl: string;
}

export const DEFAULT_SITE: SiteSettings = {
  analytics: { enabled: false, provider: '', scriptUrl: '' },
  cookieBanner: { enabled: false, policyUrl: '' },
  socialShare: { enabled: false, networks: [...KNOWN_NETWORKS] },
  demoUrl: '',
};

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function bool(v: unknown, d: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'on' || v === 'true') return true;
  if (v === 'off' || v === 'false') return false;
  return d;
}
function str(v: unknown, d: string, maxLen = 500): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : d;
}
/** An https:// URL, or '' when absent/invalid — never allow http/js: schemes. */
function httpsUrl(v: unknown): string {
  const s = str(v, '').trim();
  if (!s) return '';
  try {
    return new URL(s).protocol === 'https:' ? s : '';
  } catch {
    return '';
  }
}
function networks(v: unknown): ShareNetwork[] {
  const arr = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(/[\s,]+/)
      : typeof v === 'object' && v
        ? Object.keys(v) // checkbox map { x:'on', ... }
        : [];
  const out: ShareNetwork[] = [];
  for (const item of arr) {
    const s = String(item).trim().toLowerCase();
    if ((KNOWN_NETWORKS as readonly string[]).includes(s) && !out.includes(s as ShareNetwork)) {
      out.push(s as ShareNetwork);
    }
  }
  return out;
}

export function normalizeSite(input: unknown): SiteSettings {
  const d = DEFAULT_SITE;
  const o = rec(input);
  const a = rec(o['analytics']);
  const c = rec(o['cookieBanner']);
  const sh = rec(o['socialShare']);
  return {
    analytics: {
      enabled: bool(a['enabled'], d.analytics.enabled),
      provider: str(a['provider'], d.analytics.provider, 60).trim(),
      scriptUrl: httpsUrl(a['scriptUrl']),
    },
    cookieBanner: {
      enabled: bool(c['enabled'], d.cookieBanner.enabled),
      policyUrl: httpsUrl(c['policyUrl']),
    },
    socialShare: {
      enabled: bool(sh['enabled'], d.socialShare.enabled),
      networks: 'networks' in sh ? networks(sh['networks']) : [...d.socialShare.networks],
    },
    demoUrl: str(o['demoUrl'], d.demoUrl, 200).trim(),
  };
}

/**
 * The consent invariant, in one place: analytics may load ONLY when it is enabled,
 * has a script URL, AND the cookie banner is enabled to gather consent. With the
 * banner off there is no consent mechanism, so no tracking — even if analytics is
 * toggled on. The renderer defers the actual load until the visitor accepts.
 */
export function shouldLoadAnalytics(s: SiteSettings): boolean {
  return s.analytics.enabled && s.analytics.scriptUrl !== '' && s.cookieBanner.enabled;
}

/**
 * The website's settings, read from the ENVIRONMENT rather than the database
 * (CCB-S3-041).
 *
 * They used to live under the `site` key of the product's `settings` table and be
 * edited on the admin console's `/website` page. That was the only thing tying the
 * marketing site to the product's PostgreSQL, and it was the dependency that would
 * have made the repository split cosmetic: a site with a connection to the
 * product's database has not really been separated from it.
 *
 * These are four values that change perhaps twice a year. They do not justify a
 * database, and the site now has no product dependency beyond two URLs (the
 * archive iframe and the operator login link).
 *
 * Every variable is optional and every default is OFF, which is exactly what
 * production was already running: no `site` row existed, so the live site had been
 * serving `DEFAULT_SITE` all along. Carrying the values across therefore changes
 * nothing a visitor sees.
 */
export function siteSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): SiteSettings {
  const bool = (v: string | undefined): boolean => (v ?? '').trim().toLowerCase() === 'true';
  const str = (v: string | undefined): string => (v ?? '').trim();
  const list = (v: string | undefined): string[] =>
    str(v)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  return normalizeSite({
    analytics: {
      enabled: bool(env['SITE_ANALYTICS_ENABLED']),
      provider: str(env['SITE_ANALYTICS_PROVIDER']),
      scriptUrl: str(env['SITE_ANALYTICS_SCRIPT_URL']),
    },
    cookieBanner: {
      enabled: bool(env['SITE_COOKIE_BANNER_ENABLED']),
      policyUrl: str(env['SITE_COOKIE_POLICY_URL']),
    },
    socialShare: {
      enabled: bool(env['SITE_SHARE_ENABLED']),
      ...(env['SITE_SHARE_NETWORKS'] ? { networks: list(env['SITE_SHARE_NETWORKS']) } : {}),
    },
    demoUrl: str(env['SITE_DEMO_URL']),
  });
}

/**
 * Read-only holder for the settings.
 *
 * No `save`: there is nowhere to save to, and the admin page that used to call it
 * is gone. Changing a value means changing the environment and restarting, which
 * for four values that change twice a year is the right trade.
 */
export class SiteService {
  private constructor(private readonly current: SiteSettings) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SiteService {
    return new SiteService(siteSettingsFromEnv(env));
  }

  /**
   * Build from explicit settings.
   *
   * The settings are read-only at runtime now, so a harness that needs to exercise
   * the analytics or banner state constructs a service in that state and builds a
   * server around it, rather than mutating one in place.
   */
  static of(settings: Partial<SiteSettings>): SiteService {
    return new SiteService(normalizeSite(settings));
  }

  /** All-defaults, for harnesses and for `buildServer`'s fallback. */
  static withDefaults(): SiteService {
    return new SiteService(normalizeSite({}));
  }

  get(): SiteSettings {
    return this.current;
  }
}
