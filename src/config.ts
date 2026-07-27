/**
 * Env-driven configuration. Every setting comes from the environment (via a
 * git-ignored `.env` in development, or systemd `Environment=`/`EnvironmentFile=`
 * in production). Secrets are NEVER hardcoded — see `.env.example`.
 *
 * Integration model: the `simplex-chat` SDK (6.x) embeds the SimpleX chat core
 * in-process (native addon). There is no separate daemon and no WebSocket port —
 * the bot owns a local SimpleX DB (SQLite) and a files folder on the same host.
 */

import { dirname, resolve, sep } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { parseLogLevel, type LogLevel } from './log.js';

loadDotenv();

export interface Config {
  /** Display name for the bot's own SimpleX profile. */
  botDisplayName: string;
  /**
   * File prefix for the embedded SimpleX core DB (SQLite). The core creates
   * `<prefix>_chat.db` and `<prefix>_agent.db`. This DB holds the bot's SimpleX
   * identity and state — protect it with filesystem permissions.
   */
  simplexDbPrefix: string;
  /**
   * Absolute path to the SimpleX core's files folder — where received (XFTP)
   * files are written before Cinderella moves them into its media store.
   */
  simplexFilesFolder: string;
  /** Optional group name to scope capture. Empty string => capture all groups. */
  groupName: string;
  /** Absolute path to Cinderella's own media store. */
  mediaRoot: string;
  /**
   * Absolute path to the quarantine store (CCB-S3-013 §4).
   *
   * Quarantined bytes are MOVED here, physically out of `mediaRoot`, because the
   * admin console serves that tree by path. Segregation that exists only as a
   * database state is not segregation: the files stay readable to anything that
   * can read the directory. It MUST NOT be inside `mediaRoot`, and the loader
   * refuses to start if it is.
   */
  quarantineRoot: string;
  /**
   * Path to the bot's avatar image (jpg/png/webp). Re-applied to the SimpleX
   * profile on every startup (bot.run blanks it otherwise). Optional — if the
   * file is absent the profile image is left as-is.
   */
  avatarPath: string;
  /** PostgreSQL connection string (the archive DB — separate from the SimpleX DB). */
  databaseUrl: string;
  /** Log verbosity. */
  logLevel: LogLevel;
}

/**
 * Admin console settings. Required only when the admin web server starts —
 * loaded separately so the capture-only paths (`--check`, `connect`) don't
 * demand them.
 */
export interface AdminConfig {
  /** Port the admin server listens on. Bound to 127.0.0.1 ONLY — nginx proxies. */
  adminPort: number;
  /** Operator account name. */
  adminUsername: string;
  /** Argon2id hash of the operator password (generate: npm run hash-password). */
  adminPasswordHash: string;
  /** Secret for signing session cookies (>= 32 chars, random). */
  sessionSecret: string;
  /** Public origin of the admin/embed host, used by the embed snippet generator. */
  publicOrigin: string;
  /**
   * Public origin of the MARKETING SITE, for canonical URLs, hreflang, the site
   * sitemap, Open Graph and JSON-LD.
   *
   * Separate from `publicOrigin` on purpose, and the reason is load-bearing:
   * `publicOrigin` derives the WebAuthn RP ID, and a passkey is bound by the
   * authenticator to the RP ID it was created under. Moving `publicOrigin` to a
   * new marketing domain would invalidate every registered passkey and leave the
   * operator on break-glass. So the console keeps its hostname and the marketing
   * site gets its own, and a page on the new domain stops emitting the old one as
   * its canonical (which would hand the new domain's search value to the old).
   *
   * Defaults to `publicOrigin`, so an instance that never sets it behaves exactly
   * as before.
   */
  siteOrigin?: string;
  /** WebAuthn Relying Party ID — the console's registrable domain (A4.3). */
  rpId: string;
  /** WebAuthn expected origin (scheme + host), i.e. the public origin. */
  webauthnOrigin: string;
  /** Human-friendly RP name shown by authenticators. */
  rpName: string;
}


/**
 * Optional private local-AI resolver. The endpoint is restricted to loopback or
 * private IP space so archived member text cannot be sent to a public service by
 * a configuration typo.
 */
export interface LocalAiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

class ConfigError extends Error {
  override name = 'ConfigError';
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  return value.trim();
}


function optionalBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      throw new ConfigError(`${name} must be true or false.`);
  }
}

function optionalInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = optional(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer from ${min} to ${max} (got "${raw}").`);
  }
  return value;
}

function isPrivateAiHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const octets = host.split('.').map((part) => Number.parseInt(part, 10));
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const first = octets[0] as number;
    const second = octets[1] as number;
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (host === '::1') return true;
  const firstGroup = host.split(':')[0] ?? '';
  return /^(?:fc|fd)/.test(firstGroup) || /^fe[89ab]/.test(firstGroup);
}

function normalizeLocalAiBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`LOCAL_AI_BASE_URL must be a valid URL (got "${raw}").`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('LOCAL_AI_BASE_URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new ConfigError('LOCAL_AI_BASE_URL must not contain credentials.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError('LOCAL_AI_BASE_URL must contain only scheme, host, and optional port.');
  }
  if (!isPrivateAiHost(url.hostname)) {
    throw new ConfigError(
      'LOCAL_AI_BASE_URL must use localhost or a private IP address. Public AI endpoints are disabled.',
    );
  }

  return url.origin;
}

let cached: Config | undefined;

/**
 * Loads and validates configuration. Throws ConfigError with an actionable
 * message if a required variable is missing. Result is memoized.
 */
export function loadConfig(): Config {
  if (cached) return cached;

  const filesFolder = resolve(optional('SIMPLEX_FILES_FOLDER', './state/files'));
  const cfg: Config = {
    botDisplayName: optional('BOT_DISPLAY_NAME', 'CIND3R3LLA'),
    simplexDbPrefix: resolve(optional('SIMPLEX_DB_PREFIX', './state/simplex/cinderella')),
    simplexFilesFolder: filesFolder,
    groupName: optional('GROUP_NAME', ''),
    mediaRoot: resolve(optional('MEDIA_ROOT', './media')),
    quarantineRoot: resolveQuarantineRoot(),
    avatarPath: resolveAvatarPath(),
    databaseUrl: required('DATABASE_URL'),
    logLevel: parseLogLevel(process.env['LOG_LEVEL']),
  };

  cached = cfg;
  return cfg;
}

/**
 * Resolves the avatar path (env `AVATAR_PATH`, else next to the runtime data,
 * e.g. `/var/lib/cinderella/avatar.jpg`). Standalone so the `set-avatar` helper
 * can stage an image WITHOUT the DB/admin env that full `loadConfig` requires.
 */
/**
 * Where quarantined media lives (CCB-S3-013 §4).
 *
 * Defaults to a SIBLING of the media store rather than a directory inside it,
 * because the whole point is to be outside the tree the admin console serves. The
 * containment check below is not paranoia: putting it under `MEDIA_ROOT` would
 * silently reduce quarantine to a rename, leaving the bytes fetchable by path.
 */
/** Validates SITE_ORIGIN the same way PUBLIC_ORIGIN is validated. */
function normalizeSiteOrigin(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new ConfigError(`SITE_ORIGIN must use http or https (got "${raw}").`);
    }
    return `${u.protocol}//${u.host}`;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`SITE_ORIGIN must be a valid URL (got "${raw}").`);
  }
}

export function resolveQuarantineRoot(): string {
  const media = resolve(process.env['MEDIA_ROOT'] ?? './media');
  const configured = process.env['QUARANTINE_ROOT'];
  const root = configured ? resolve(configured) : resolve(dirname(media), 'quarantine');
  if (root === media || root.startsWith(media + sep)) {
    throw new Error(
      `QUARANTINE_ROOT (${root}) must not be inside MEDIA_ROOT (${media}). Quarantined media is ` +
        'moved out of the served tree on purpose; nesting it there would leave it readable by path.',
    );
  }
  return root;
}

export function resolveAvatarPath(): string {
  const filesFolder = resolve(optional('SIMPLEX_FILES_FOLDER', './state/files'));
  return resolve(optional('AVATAR_PATH', resolve(filesFolder, '..', 'avatar.jpg')));
}

let cachedLocalAi: LocalAiConfig | undefined;

/**
 * Loads the optional private Ollama classifier configuration. No network request
 * is made here, so config checks stay deterministic.
 */
export function loadLocalAiConfig(): LocalAiConfig {
  if (cachedLocalAi) return cachedLocalAi;

  const enabled = optionalBoolean('LOCAL_AI_ENABLED', false);
  const baseUrl = normalizeLocalAiBaseUrl(optional('LOCAL_AI_BASE_URL', 'http://127.0.0.1:11434'));

  cachedLocalAi = {
    enabled,
    baseUrl,
    model: optional('LOCAL_AI_MODEL', 'qwen3.5:9b'),
    timeoutMs: optionalInteger('LOCAL_AI_TIMEOUT_MS', 15000, 250, 60000),
  };

  return cachedLocalAi;
}

/** A log-safe view of the local-AI configuration. */
export function redactLocalAiConfig(config: LocalAiConfig): Record<string, string> {
  return {
    enabled: config.enabled ? 'yes' : 'no',
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: String(config.timeoutMs),
  };
}

let cachedAdmin: AdminConfig | undefined;

/**
 * Loads and validates the admin console configuration. Throws ConfigError with
 * an actionable message when something is missing or unsafe.
 */
export function loadAdminConfig(): AdminConfig {
  if (cachedAdmin) return cachedAdmin;

  const portRaw = optional('ADMIN_PORT', '8787');
  const adminPort = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(adminPort) || adminPort < 1 || adminPort > 65535) {
    throw new ConfigError(`ADMIN_PORT must be a valid port number (got "${portRaw}").`);
  }

  const adminPasswordHash = required('ADMIN_PASSWORD_HASH');
  if (!adminPasswordHash.startsWith('$argon2id$')) {
    throw new ConfigError(
      'ADMIN_PASSWORD_HASH must be an Argon2id hash. Generate one with: npm run hash-password',
    );
  }

  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32) {
    throw new ConfigError(
      'SESSION_SECRET must be at least 32 characters of random data (e.g. openssl rand -hex 32).',
    );
  }

  const publicOrigin = optional('PUBLIC_ORIGIN', 'https://cinderella.example.org');
  // WebAuthn RP ID is the host of the public origin (no scheme/port). The
  // public-hostname + real-TLS design (A4.2) is what makes WebAuthn work — it
  // requires a secure context and a domain-based RP ID, not a bare IP.
  let rpId: string;
  let webauthnOrigin: string;
  try {
    const u = new URL(publicOrigin);
    rpId = u.hostname;
    webauthnOrigin = u.origin;
  } catch {
    throw new ConfigError(`PUBLIC_ORIGIN must be a valid URL (got "${publicOrigin}").`);
  }

  const finalRpId = optional('WEBAUTHN_RP_ID', rpId);
  const finalOrigin = optional('WEBAUTHN_ORIGIN', webauthnOrigin);
  // Fail fast on an RP-ID/origin mismatch — the classic silent passkey lockout
  // (CCB-S2-011): if the RP ID isn't the origin's registrable host, every existing
  // passkey stops working with a client-side NotAllowedError after the deploy.
  validateRpConfig(finalRpId, finalOrigin);

  const cfg: AdminConfig = {
    adminPort,
    adminUsername: required('ADMIN_USERNAME'),
    adminPasswordHash,
    sessionSecret,
    publicOrigin,
    siteOrigin: normalizeSiteOrigin(optional('SITE_ORIGIN', publicOrigin)),
    rpId: finalRpId,
    webauthnOrigin: finalOrigin,
    rpName: optional('WEBAUTHN_RP_NAME', 'CIND3R3LLA Admin'),
  };
  cachedAdmin = cfg;
  return cfg;
}

/**
 * Guards the WebAuthn RP ID / origin relationship at startup (CCB-S2-011). A passkey
 * is bound by the authenticator to the RP ID it was created under; if the RP ID is not
 * the WebAuthn origin's host (or a registrable parent of it), `navigator.credentials.get()`
 * rejects every registered credential with a client-side `NotAllowedError` — the exact
 * "operator locked out after a deploy" failure. Refusing to boot on a mismatch turns a
 * silent lockout into a loud, actionable config error. Exported for the test harness.
 */
export function validateRpConfig(rpId: string, webauthnOrigin: string): void {
  let host: string;
  try {
    host = new URL(webauthnOrigin).hostname;
  } catch {
    throw new ConfigError(`WEBAUTHN_ORIGIN must be a valid URL (got "${webauthnOrigin}").`);
  }
  const ok = rpId === host || host.endsWith(`.${rpId}`);
  if (!ok) {
    throw new ConfigError(
      `WEBAUTHN_RP_ID "${rpId}" must equal the WebAuthn origin host "${host}" or a registrable ` +
        `parent of it — a mismatch silently invalidates every registered passkey. ` +
        `Check WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN / PUBLIC_ORIGIN.`,
    );
  }
}

/**
 * Returns a copy of the config safe to log — the database password is redacted.
 */
export function redactConfig(cfg: Config): Record<string, string> {
  let safeDbUrl = cfg.databaseUrl;
  try {
    const url = new URL(cfg.databaseUrl);
    if (url.password) url.password = '***';
    // Also scrub credential-bearing query parameters — some drivers accept the
    // password (and other secrets) as ?password=… rather than in the userinfo.
    for (const key of ['password', 'pgpassword', 'sslpassword', 'sslcert', 'sslkey']) {
      for (const actual of [...url.searchParams.keys()]) {
        if (actual.toLowerCase() === key) url.searchParams.set(actual, '***');
      }
    }
    safeDbUrl = url.toString();
  } catch {
    // Non-URL connection string; redact defensively rather than leak it.
    safeDbUrl = '[unparseable connection string — redacted]';
  }
  return {
    botDisplayName: cfg.botDisplayName,
    simplexDbPrefix: cfg.simplexDbPrefix,
    simplexFilesFolder: cfg.simplexFilesFolder,
    groupName: cfg.groupName || '(all groups)',
    mediaRoot: cfg.mediaRoot,
    quarantineRoot: cfg.quarantineRoot,
    databaseUrl: safeDbUrl,
    logLevel: cfg.logLevel,
  };
}
