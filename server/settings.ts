import fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import { child } from "./logger";
const log = child({ module: "settings" });



const DEFAULT_CONTENT_ROOT = getDefaultContentRoot();

function resolveSettingsRoot(contentRoot?: string): string {
  return contentRoot ?? DEFAULT_CONTENT_ROOT;
}
function getSettingsPath(contentRoot?: string): string {
  return path.join(resolveSettingsRoot(contentRoot), "settings.yml");
}

interface LocaleEntry {
  code: string;
  label: string;
}

interface I18nSettings {
  default_locale: string;
  supported_locales: LocaleEntry[];
}

interface HomePageSettings {
  type: string;
  slug: string;
}

export interface TagManagerSettings {
  /** Web GTM container ID (e.g. GTM-XXXX). Injected into the HTML shell; empty disables web GTM. */
  web_container_id: string;
  sgtm_enabled: boolean;
  sgtm_server_url: string;
  sgtm_proxy_path: string;
}

export interface OptimizationSettings {
  tagmanager: TagManagerSettings;
}

export interface WebhookConfig {
  url: string;
  method: "POST" | "GET";
  auth_header?: string;
}

export interface ConsentDefaults {
  marketing?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
  sms_usa_only?: boolean;
  marketing_text?: string;
  sms_text?: string;
  show_terms?: boolean;
  terms_url?: string;
  privacy_url?: string;
}

export interface SuccessDefaults {
  message?: string;
  url?: string;
}

export interface ConversionEventEntry {
  name: string;
  description?: string;
  automations?: string;
  tags?: string[];
  consent?: ConsentDefaults;
  webhook?: WebhookConfig;
  success?: SuccessDefaults;
}

export interface TrackingWebhook {
  url: string;
  method?: string;
  auth_header?: string;
}

export interface TrackingSettings {
  conversion_events: ConversionEventEntry[];
  webhook?: TrackingWebhook;
}

/** GET | POST | PUT for auth API endpoints */
export type AuthHttpMethod = "GET" | "POST" | "PUT";

export interface AuthEndpoint {
  /** Path relative to auth.host, or absolute URL */
  path?: string;
  /** HTTP method (login/signup default POST; profile default GET) */
  method?: AuthHttpMethod;
}

/**
 * Consumer auth (lead forms with is_signup, login redirect, profile prefill).
 * Nested login / signup / profile each own path + method.
 */
export interface AuthSettings {
  /** API base host, e.g. https://breathecode.herokuapp.com */
  host?: string;
  /**
   * Optional Breathecode academy id sent as the `Academy` header on profile
   * (and auth test profile) requests when set.
   */
  academy?: string;
  login?: AuthEndpoint & {
    /** Hosted login page; redirects back with ?token= */
    url?: string;
    /** Example credentials / body for login Test */
    payload?: Record<string, unknown>;
  };
  signup?: AuthEndpoint & {
    /** Template merged with live form values on is_signup submit */
    payload?: Record<string, unknown>;
  };
  profile?: AuthEndpoint;
}

export const DEFAULT_LOGIN_PAYLOAD: Record<string, unknown> = {
  email: "bob@gmail.com",
  password: "********",
};

export const DEFAULT_SIGNUP_PAYLOAD: Record<string, unknown> = {
  first_name: "bob",
  last_name: "dylan",
  email: "bob@gmail.com",
  phone: "+574589459854",
  course: "",
  country: "Colombia",
  city: "Bogotá",
  plan: "ai-fluency",
  language: "en",
  has_marketing_consent: true,
  conversion_info: {
    user_agent: "Mozilla/5.0 …",
    landing_url: "/login",
    conversion_url: "/interactive-exercise/python-beginner-exercises",
    internal_cta_placement: "navbar-bootcamp-options-start-practicing-with-challenges",
  },
};

/** Re-injected above `auth:` on save (yaml.dump strips comments). */
export const AUTH_YAML_COMMENT_HEADER = `# Consumer auth (lead forms with is_signup, login redirect, profile prefill).
# Paths are relative to host, or absolute URLs. method: GET | POST | PUT.
# Optional academy: Breathecode academy id sent as Academy header on profile fetch.
`;

function parseAuthMethod(v: unknown): AuthHttpMethod | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().toUpperCase();
  return m === "GET" || m === "POST" || m === "PUT" ? m : undefined;
}

function parsePayload(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function authStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Normalize nested or legacy-flat auth YAML into AuthSettings. */
export function normalizeAuthSettings(authRaw: Record<string, unknown> | undefined | null): AuthSettings {
  if (!authRaw || typeof authRaw !== "object") return {};

  const host = authStr(authRaw.host);
  const academy =
    authStr(authRaw.academy) ||
    (typeof authRaw.academy === "number" && Number.isFinite(authRaw.academy)
      ? String(authRaw.academy)
      : undefined);

  // Nested preferred
  const loginRaw = authRaw.login && typeof authRaw.login === "object" && !Array.isArray(authRaw.login)
    ? (authRaw.login as Record<string, unknown>)
    : undefined;
  const signupRaw = authRaw.signup && typeof authRaw.signup === "object" && !Array.isArray(authRaw.signup)
    ? (authRaw.signup as Record<string, unknown>)
    : undefined;
  const profileRaw = authRaw.profile && typeof authRaw.profile === "object" && !Array.isArray(authRaw.profile)
    ? (authRaw.profile as Record<string, unknown>)
    : undefined;

  // Legacy flat keys (migrate on read)
  const legacyLoginUrl = authStr(authRaw.login_url);
  const legacyLoginPath = authStr(authRaw.login_path);
  const legacyLoginMethod = parseAuthMethod(authRaw.login_method);
  const legacySignupPath = authStr(authRaw.signup_path);
  const legacyMePath = authStr(authRaw.me_path);
  const legacySignupPayload = parsePayload(authRaw.signup_payload);

  const loginUrl = authStr(loginRaw?.url) || legacyLoginUrl;
  const loginPath = authStr(loginRaw?.path) || legacyLoginPath;
  const loginMethod = parseAuthMethod(loginRaw?.method) || legacyLoginMethod;
  const loginPayload = parsePayload(loginRaw?.payload);

  const signupPath = authStr(signupRaw?.path) || legacySignupPath;
  const signupMethod = parseAuthMethod(signupRaw?.method);
  const signupPayload = parsePayload(signupRaw?.payload) || legacySignupPayload;

  const profilePath = authStr(profileRaw?.path) || legacyMePath;
  const profileMethod = parseAuthMethod(profileRaw?.method);

  const login =
    loginUrl || loginPath || loginMethod || loginPayload
      ? {
          ...(loginUrl ? { url: loginUrl } : {}),
          ...(loginPath ? { path: loginPath } : {}),
          ...(loginMethod ? { method: loginMethod } : {}),
          ...(loginPayload ? { payload: loginPayload } : {}),
        }
      : undefined;

  const signup =
    signupPath || signupMethod || signupPayload
      ? {
          ...(signupPath ? { path: signupPath } : {}),
          ...(signupMethod ? { method: signupMethod } : {}),
          ...(signupPayload ? { payload: signupPayload } : {}),
        }
      : undefined;

  const profile =
    profilePath || profileMethod
      ? {
          ...(profilePath ? { path: profilePath } : {}),
          ...(profileMethod ? { method: profileMethod } : {}),
        }
      : undefined;

  return {
    ...(host ? { host } : {}),
    ...(academy ? { academy } : {}),
    ...(login ? { login } : {}),
    ...(signup ? { signup } : {}),
    ...(profile ? { profile } : {}),
  };
}

function injectAuthYamlComments(dumped: string): string {
  // Strip a previously injected header, then insert a fresh one above `auth:`.
  const stripped = dumped.replace(
    /(?:^|\n)# Consumer auth \(lead forms with is_signup[\s\S]*?(?=\nauth:)/m,
    (m) => (m.startsWith("\n") ? "\n" : ""),
  );
  return stripped.replace(/(^|\n)(auth:)/, `$1${AUTH_YAML_COMMENT_HEADER}$2`);
}

export interface RobotsSettings {
  block_indexing: boolean;
  include_sitemap: boolean;
  disallow_paths: string[];
  ai_bots: string[];
}

export const DEFAULT_ROBOTS_SETTINGS: RobotsSettings = {
  block_indexing: false,
  include_sitemap: true,
  disallow_paths: ["/api/", "/private/", "/preview-frame", "/health"],
  ai_bots: [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "Google-Extended",
    "anthropic-ai",
    "ClaudeBot",
    "Claude-Web",
    "PerplexityBot",
    "Meta-ExternalAgent",
    "Applebot",
    "Applebot-Extended",
  ],
};

interface SiteSettings {
  i18n: I18nSettings;
  home_page: HomePageSettings;
  optimization: OptimizationSettings;
  tracking: TrackingSettings;
  robots: RobotsSettings;
  auth: AuthSettings;
}

/** Build robots.txt body from settings. `baseUrl` is used for the Sitemap line when included. */
export function buildRobotsTxtContent(robots: RobotsSettings, baseUrl: string): string {
  if (robots.block_indexing) {
    return `# Site indexing blocked
User-agent: *
Disallow: /
`;
  }

  const lines: string[] = [
    "# Allow all crawlers",
    "User-agent: *",
    "Allow: /",
  ];
  for (const p of robots.disallow_paths) {
    const path = p.trim();
    if (path) lines.push(`Disallow: ${path}`);
  }
  lines.push("");

  if (robots.ai_bots.length > 0) {
    lines.push("# Allow AI/LLM crawlers explicitly");
    for (const bot of robots.ai_bots) {
      const name = bot.trim();
      if (!name) continue;
      lines.push(`User-agent: ${name}`);
      lines.push("Allow: /");
      lines.push("");
    }
  }

  if (robots.include_sitemap && baseUrl) {
    lines.push("# Sitemap location");
    lines.push(`Sitemap: ${baseUrl.replace(/\/$/, "")}/sitemap.xml`);
    lines.push("");
  }

  return lines.join("\n");
}

const settingsCache = new Map<string, SiteSettings>();

function loadSettings(contentRoot?: string): SiteSettings {
  const key = resolveSettingsRoot(contentRoot);
  if (settingsCache.has(key)) return settingsCache.get(key)!;

  const settingsPath = getSettingsPath(key);

  const defaults: SiteSettings = {
    i18n: {
      default_locale: "en",
      supported_locales: [
        { code: "en", label: "English" },
        { code: "es", label: "Spanish" },
      ],
    },
    home_page: {
      type: "page",
      slug: "home",
    },
    optimization: {
      tagmanager: {
        web_container_id: "GTM-PGGRR6",
        sgtm_enabled: false,
        sgtm_server_url: "",
        sgtm_proxy_path: "/sgtm/",
      },
    },
    tracking: {
      conversion_events: [],
    },
    robots: { ...DEFAULT_ROBOTS_SETTINGS },
    auth: {},
  };

  if (!fs.existsSync(settingsPath)) {
    log.warn("[Settings] settings.yml not found, using defaults");
    settingsCache.set(key, defaults);
    return defaults;
  }

  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed) {
      settingsCache.set(key, defaults);
      return defaults;
    }

    const i18nRaw = parsed.i18n as Record<string, unknown> | undefined;
    const i18n: I18nSettings = {
      default_locale: (i18nRaw?.default_locale as string) || defaults.i18n.default_locale,
      supported_locales: Array.isArray(i18nRaw?.supported_locales)
        ? (i18nRaw.supported_locales as LocaleEntry[]).filter(
            (e) => typeof e.code === "string" && typeof e.label === "string"
          )
        : defaults.i18n.supported_locales,
    };

    const homePageRaw = parsed.home_page as Record<string, unknown> | undefined;
    const home_page: HomePageSettings = {
      type: (homePageRaw?.type as string) || defaults.home_page.type,
      slug: (homePageRaw?.slug as string) || defaults.home_page.slug,
    };

    const optRaw = parsed.optimization as Record<string, unknown> | undefined;
    const tmRaw = optRaw?.tagmanager as Record<string, unknown> | undefined;
    const defTm = defaults.optimization.tagmanager;
    const optimization: OptimizationSettings = {
      tagmanager: {
        web_container_id:
          typeof tmRaw?.web_container_id === "string"
            ? tmRaw.web_container_id
            : defTm.web_container_id,
        sgtm_enabled: typeof tmRaw?.sgtm_enabled === "boolean" ? tmRaw.sgtm_enabled : defTm.sgtm_enabled,
        sgtm_server_url: (tmRaw?.sgtm_server_url as string) || defTm.sgtm_server_url,
        sgtm_proxy_path: (tmRaw?.sgtm_proxy_path as string) || defTm.sgtm_proxy_path,
      },
    };

    const trackingRaw = parsed.tracking as Record<string, unknown> | undefined;
    const conversionEventsRaw = trackingRaw?.conversion_events;

    const parseWebhookConfig = (raw: unknown): WebhookConfig | undefined => {
      if (!raw || typeof raw !== "object") return undefined;
      const w = raw as Record<string, unknown>;
      if (typeof w.url !== "string" || !w.url.trim()) return undefined;
      const method = w.method === "GET" ? "GET" : "POST";
      return {
        url: w.url.trim(),
        method,
        ...(typeof w.auth_header === "string" && w.auth_header ? { auth_header: w.auth_header } : {}),
      };
    };
    const parseWebhook = (raw: unknown): TrackingWebhook | undefined => {
      if (!raw || typeof raw !== "object") return undefined;
      const w = raw as Record<string, unknown>;
      if (typeof w.url !== "string" || !w.url.trim()) return undefined;
      const method = typeof w.method === "string" ? w.method : "POST";
      return {
        url: w.url.trim(),
        method,
        ...(typeof w.auth_header === "string" && w.auth_header ? { auth_header: w.auth_header } : {}),
      };
    };
    const parseConsent = (raw: Record<string, unknown>): ConsentDefaults => {
      const result: ConsentDefaults = {};
      if (typeof raw.marketing === "boolean") result.marketing = raw.marketing;
      if (typeof raw.sms === "boolean") result.sms = raw.sms;
      if (typeof raw.whatsapp === "boolean") result.whatsapp = raw.whatsapp;
      if (typeof raw.sms_usa_only === "boolean") result.sms_usa_only = raw.sms_usa_only;
      if (typeof raw.marketing_text === "string" && raw.marketing_text) result.marketing_text = raw.marketing_text;
      if (typeof raw.sms_text === "string" && raw.sms_text) result.sms_text = raw.sms_text;
      if (typeof raw.show_terms === "boolean") result.show_terms = raw.show_terms;
      if (typeof raw.terms_url === "string" && raw.terms_url) result.terms_url = raw.terms_url;
      if (typeof raw.privacy_url === "string" && raw.privacy_url) result.privacy_url = raw.privacy_url;
      return result;
    };
    const tracking: TrackingSettings = {
      conversion_events: Array.isArray(conversionEventsRaw)
        ? (conversionEventsRaw as Array<Record<string, unknown>>)
            .filter((e) => e && typeof e.name === "string")
            .map((e) => {
              const successRaw = e.success && typeof e.success === "object"
                ? (e.success as Record<string, unknown>)
                : null;
              const success: SuccessDefaults | undefined = successRaw
                ? {
                    ...(typeof successRaw.message === "string" && successRaw.message
                      ? { message: successRaw.message }
                      : {}),
                    ...(typeof successRaw.url === "string" && successRaw.url
                      ? { url: successRaw.url }
                      : {}),
                  }
                : undefined;
              const entry: ConversionEventEntry = {
                name: e.name as string,
                ...(typeof e.description === "string" ? { description: e.description } : {}),
                ...(typeof e.automations === "string" && e.automations ? { automations: e.automations } : {}),
                ...(Array.isArray(e.tags) && e.tags.length > 0
                  ? { tags: e.tags.filter((t) => typeof t === "string") as string[] }
                  : {}),
                ...(e.consent && typeof e.consent === "object"
                  ? { consent: parseConsent(e.consent as Record<string, unknown>) }
                  : {}),
                ...(parseWebhookConfig(e.webhook) ? { webhook: parseWebhookConfig(e.webhook) } : {}),
                ...(success && (success.message || success.url) ? { success } : {}),
              };
              return entry;
            })
        : defaults.tracking.conversion_events,
      webhook: parseWebhook(trackingRaw?.webhook),
    };

    const robotsRaw = parsed.robots as Record<string, unknown> | undefined;
    const defRobots = defaults.robots;
    const robots: RobotsSettings = {
      block_indexing:
        typeof robotsRaw?.block_indexing === "boolean"
          ? robotsRaw.block_indexing
          : defRobots.block_indexing,
      include_sitemap:
        typeof robotsRaw?.include_sitemap === "boolean"
          ? robotsRaw.include_sitemap
          : defRobots.include_sitemap,
      disallow_paths: Array.isArray(robotsRaw?.disallow_paths)
        ? (robotsRaw.disallow_paths as unknown[]).filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        : [...defRobots.disallow_paths],
      ai_bots: Array.isArray(robotsRaw?.ai_bots)
        ? (robotsRaw.ai_bots as unknown[]).filter((b): b is string => typeof b === "string" && b.trim().length > 0)
        : [...defRobots.ai_bots],
    };

    const authRaw = parsed.auth as Record<string, unknown> | undefined;
    const auth = normalizeAuthSettings(authRaw);

    const result: SiteSettings = { ...defaults, i18n, home_page, optimization, tracking, robots, auth };
    settingsCache.set(key, result);
    log.info(
      `[Settings] Loaded: ${i18n.supported_locales.length} locale(s), default="${i18n.default_locale}", home_page="${home_page.slug}", conversion_events=${tracking.conversion_events.length}, block_indexing=${robots.block_indexing}`
    );
    return result;
  } catch (err) {
    log.error({ err: err }, "[Settings] Failed to parse settings.yml, using defaults:");
    settingsCache.set(key, defaults);
    return defaults;
  }
}

export function getSettings(contentRoot?: string): SiteSettings {
  return loadSettings(contentRoot);
}

export function getSupportedLocales(contentRoot?: string): string[] {
  return loadSettings(contentRoot).i18n.supported_locales.map((l) => l.code);
}

export function getDefaultLocale(contentRoot?: string): string {
  return loadSettings(contentRoot).i18n.default_locale;
}

export function getLocaleLabel(code: string, contentRoot?: string): string | undefined {
  const entry = loadSettings(contentRoot).i18n.supported_locales.find((l) => l.code === code);
  return entry?.label;
}

export function getLocaleEntries(contentRoot?: string): LocaleEntry[] {
  return loadSettings(contentRoot).i18n.supported_locales;
}

export function getHomePage(contentRoot?: string): HomePageSettings {
  return loadSettings(contentRoot).home_page;
}

export function normalizeLocale(locale: string | undefined | null, contentRoot?: string): string {
  const defaultLocale = getDefaultLocale(contentRoot);
  if (!locale) return defaultLocale;

  const lower = locale.toLowerCase().replace("_", "-");
  const supported = getSupportedLocales(contentRoot).map(c => c.toLowerCase());

  // Exact match first (handles both "es" and "es-mx" if explicitly in supported_locales)
  if (supported.includes(lower)) return lower;

  // If it's a regional locale (xx-xx), check if the base language is supported.
  // When the base is supported, preserve the full regional code so content loaders
  // can find es-mx.yml instead of falling back to es.yml.
  const dashIdx = lower.indexOf("-");
  if (dashIdx > 0) {
    const base = lower.slice(0, dashIdx);
    if (supported.includes(base)) return lower;
  }

  // Fall back to the base language alone
  const base = lower.split("-")[0];
  if (supported.includes(base)) return base;

  return defaultLocale;
}

export function updateLocaleSettings(input: {
  default_locale: string;
  supported_locales: LocaleEntry[];
}, contentRoot?: string): void {
  const { default_locale, supported_locales } = input;

  if (!Array.isArray(supported_locales) || supported_locales.length === 0) {
    throw new Error("At least one supported locale is required");
  }

  for (const entry of supported_locales) {
    if (typeof entry.code !== "string" || !/^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(entry.code)) {
      throw new Error(`Invalid locale code: "${entry.code}" — must be 2-3 lowercase letters, optionally followed by a region tag (e.g. es-MX)`);
    }
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new Error(`Locale "${entry.code}" must have a non-empty label`);
    }
  }

  if (!supported_locales.some((l) => l.code === default_locale)) {
    throw new Error(`Default locale "${default_locale}" must be in the supported locales list`);
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  existing.i18n = {
    default_locale,
    supported_locales: supported_locales.map((l) => ({
      code: l.code,
      label: l.label.trim(),
    })),
  };

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(
    `[Settings] Updated: ${supported_locales.length} locale(s), default="${default_locale}"`
  );
}

export function resetSettings(contentRoot?: string): void {
  if (contentRoot) {
    settingsCache.delete(contentRoot);
  } else {
    settingsCache.clear();
  }
}

export function getOptimizationSettings(contentRoot?: string): OptimizationSettings {
  return loadSettings(contentRoot).optimization;
}

export function getTrackingSettings(contentRoot?: string): TrackingSettings {
  return loadSettings(contentRoot).tracking;
}

export function getRobotsSettings(contentRoot?: string): RobotsSettings {
  return loadSettings(contentRoot).robots;
}

export function getAuthSettings(contentRoot?: string): AuthSettings {
  return loadSettings(contentRoot).auth;
}

/** Signup is available only when both a host (explicit or env fallback) and a signup path are configured. */
export function isSignupConfigured(contentRoot?: string): boolean {
  const auth = getAuthSettings(contentRoot);
  const host = auth.host || process.env.VITE_BREATHECODE_HOST;
  return !!(host && auth.signup?.path);
}

export function updateAuthSettings(
  input: Partial<AuthSettings> | null,
  contentRoot?: string,
): AuthSettings {
  const validateUrl = (value: string, field: string) => {
    try {
      new URL(value);
    } catch {
      throw new Error(`${field} must be a valid absolute URL`);
    }
  };
  const validatePathOrUrl = (value: string, field: string) => {
    if (value.startsWith("/")) return;
    validateUrl(value, field);
  };
  const validateMethod = (value: unknown, field: string) => {
    if (value === undefined || value === null || value === "") return;
    const m = parseAuthMethod(value);
    if (!m) throw new Error(`${field} must be "GET", "POST", or "PUT"`);
  };
  const validatePayload = (value: unknown, field: string) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${field} must be a plain object`);
    }
  };

  if (input) {
    if (input.host !== undefined && input.host !== "" && typeof input.host === "string") {
      validateUrl(input.host.trim(), "auth.host");
    }
    if (input.academy !== undefined && input.academy !== "" && typeof input.academy === "string") {
      const academy = input.academy.trim();
      if (!/^\d+$/.test(academy) && !/^[a-z0-9_-]+$/i.test(academy)) {
        throw new Error('auth.academy must be a numeric id or slug (e.g. "4")');
      }
    }
    if (input.login) {
      if (input.login.url !== undefined && input.login.url !== "") {
        validateUrl(String(input.login.url).trim(), "auth.login.url");
      }
      if (input.login.path !== undefined && input.login.path !== "") {
        validatePathOrUrl(String(input.login.path).trim(), "auth.login.path");
      }
      validateMethod(input.login.method, "auth.login.method");
      validatePayload(input.login.payload, "auth.login.payload");
    }
    if (input.signup) {
      if (input.signup.path !== undefined && input.signup.path !== "") {
        validatePathOrUrl(String(input.signup.path).trim(), "auth.signup.path");
      }
      validateMethod(input.signup.method, "auth.signup.method");
      validatePayload(input.signup.payload, "auth.signup.payload");
    }
    if (input.profile) {
      if (input.profile.path !== undefined && input.profile.path !== "") {
        validatePathOrUrl(String(input.profile.path).trim(), "auth.profile.path");
      }
      validateMethod(input.profile.method, "auth.profile.method");
    }
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  if (input === null) {
    delete existing.auth;
  } else {
    // Full replace with normalized nested shape from the request (merged with current for undefined sections).
    const current = loadSettings(contentRoot).auth;
    const mergeEndpoint = <T extends AuthEndpoint & { url?: string; payload?: Record<string, unknown> }>(
      incoming: T | undefined,
      prev: T | undefined,
      opts: { includeUrl?: boolean; includePayload?: boolean },
    ): T | undefined => {
      if (incoming === undefined) return prev;
      if (incoming === null) return undefined;

      const nextPath =
        incoming.path !== undefined
          ? (String(incoming.path ?? "").trim() || undefined)
          : prev?.path;
      const nextMethod =
        incoming.method !== undefined
          ? parseAuthMethod(incoming.method) ?? undefined
          : prev?.method;
      const nextUrl = opts.includeUrl
        ? incoming.url !== undefined
          ? (String(incoming.url ?? "").trim() || undefined)
          : prev?.url
        : undefined;
      const nextPayload = opts.includePayload
        ? incoming.payload !== undefined
          ? (incoming.payload ?? undefined)
          : prev?.payload
        : undefined;

      const next = {
        ...(nextPath ? { path: nextPath } : {}),
        ...(nextMethod ? { method: nextMethod } : {}),
        ...(opts.includeUrl && nextUrl ? { url: nextUrl } : {}),
        ...(opts.includePayload && nextPayload ? { payload: nextPayload } : {}),
      } as T;
      return Object.keys(next).length > 0 ? next : undefined;
    };

    const nextHost =
      input.host !== undefined
        ? (String(input.host ?? "").trim() || undefined)
        : current.host;

    const nextAcademy =
      input.academy !== undefined
        ? (String(input.academy ?? "").trim() || undefined)
        : current.academy;

    const nextLogin = mergeEndpoint(input.login, current.login, { includeUrl: true, includePayload: true });
    const nextSignup = mergeEndpoint(input.signup, current.signup, { includePayload: true });
    const nextProfile = mergeEndpoint(input.profile, current.profile, {});

    const next: AuthSettings = {
      ...(nextHost ? { host: nextHost } : {}),
      ...(nextAcademy ? { academy: nextAcademy } : {}),
      ...(nextLogin ? { login: nextLogin } : {}),
      ...(nextSignup ? { signup: nextSignup } : {}),
      ...(nextProfile ? { profile: nextProfile } : {}),
    };

    if (Object.keys(next).length === 0) {
      delete existing.auth;
    } else {
      existing.auth = next;
    }
  }

  const dumped = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  const output = injectAuthYamlComments(dumped);
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  const updated = loadSettings(contentRoot).auth;
  log.info(
    `[Settings] Updated auth: host="${updated.host ?? ""}", academy="${updated.academy ?? ""}", login.path="${updated.login?.path ?? ""}", signup.path="${updated.signup?.path ?? ""}", profile.path="${updated.profile?.path ?? ""}"`,
  );
  return updated;
}

export function isIndexingBlocked(contentRoot?: string): boolean {
  return loadSettings(contentRoot).robots.block_indexing;
}

/** When sitewide indexing is blocked, always return noindex; otherwise use pageRobots or default. */
export function resolveEffectiveRobots(
  pageRobots: string | undefined | null,
  contentRoot?: string,
): string {
  if (isIndexingBlocked(contentRoot)) return "noindex, nofollow";
  return typeof pageRobots === "string" && pageRobots.trim()
    ? pageRobots
    : "index, follow";
}

export function updateRobotsSettings(input: Partial<RobotsSettings>, contentRoot?: string): RobotsSettings {
  if (input.block_indexing !== undefined && typeof input.block_indexing !== "boolean") {
    throw new Error("block_indexing must be a boolean");
  }
  if (input.include_sitemap !== undefined && typeof input.include_sitemap !== "boolean") {
    throw new Error("include_sitemap must be a boolean");
  }
  if (input.disallow_paths !== undefined) {
    if (!Array.isArray(input.disallow_paths)) {
      throw new Error("disallow_paths must be an array of strings");
    }
    for (const p of input.disallow_paths) {
      if (typeof p !== "string" || !p.trim()) {
        throw new Error("Each disallow path must be a non-empty string");
      }
      if (!p.trim().startsWith("/")) {
        throw new Error(`Disallow path must start with /: "${p}"`);
      }
    }
  }
  if (input.ai_bots !== undefined) {
    if (!Array.isArray(input.ai_bots)) {
      throw new Error("ai_bots must be an array of strings");
    }
    for (const b of input.ai_bots) {
      if (typeof b !== "string" || !b.trim()) {
        throw new Error("Each AI bot name must be a non-empty string");
      }
    }
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const current = loadSettings(contentRoot).robots;
  const updated: RobotsSettings = {
    block_indexing: typeof input.block_indexing === "boolean" ? input.block_indexing : current.block_indexing,
    include_sitemap: typeof input.include_sitemap === "boolean" ? input.include_sitemap : current.include_sitemap,
    disallow_paths: Array.isArray(input.disallow_paths)
      ? input.disallow_paths.map((p) => p.trim()).filter(Boolean)
      : [...current.disallow_paths],
    ai_bots: Array.isArray(input.ai_bots)
      ? input.ai_bots.map((b) => b.trim()).filter(Boolean)
      : [...current.ai_bots],
  };

  existing.robots = {
    block_indexing: updated.block_indexing,
    include_sitemap: updated.include_sitemap,
    disallow_paths: updated.disallow_paths,
    ai_bots: updated.ai_bots,
  };

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(
    `[Settings] Updated robots: block_indexing=${updated.block_indexing}, include_sitemap=${updated.include_sitemap}, disallow_paths=${updated.disallow_paths.length}, ai_bots=${updated.ai_bots.length}`
  );
  return updated;
}

export function updateTrackingSettings(input: {
  conversion_events?: ConversionEventEntry[];
  webhook?: { url: string; method?: string; auth_header?: string } | null;
}, contentRoot?: string): void {
  if (input.conversion_events !== undefined && !Array.isArray(input.conversion_events)) {
    throw new Error("conversion_events must be an array");
  }

  if (input.conversion_events !== undefined) {
    for (const entry of input.conversion_events) {
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        throw new Error("Each conversion event must have a non-empty name");
      }
      if (!/^[a-z][a-z0-9_]*$/.test(entry.name.trim())) {
        throw new Error(`Invalid conversion event name: "${entry.name}" — use lowercase letters, digits, and underscores only`);
      }
    }
  }

  if (input.webhook !== undefined && input.webhook !== null) {
    if (typeof input.webhook.url !== "string" || !input.webhook.url.trim()) {
      throw new Error("webhook.url must be a non-empty string");
    }
    if (input.webhook.method !== undefined && !["POST", "GET"].includes(input.webhook.method)) {
      throw new Error('webhook.method must be "POST" or "GET"');
    }
  }

  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const currentTracking = (existing.tracking as Record<string, unknown>) || {};

  const nextTracking: Record<string, unknown> = { ...currentTracking };

  if (input.conversion_events !== undefined) {
    nextTracking.conversion_events = input.conversion_events.map((e) => {
      const serialized: Record<string, unknown> = { name: e.name.trim() };
      if (e.description) serialized.description = e.description;
      if (e.automations?.trim()) serialized.automations = e.automations.trim();
      if (e.tags && e.tags.length > 0) serialized.tags = e.tags;
      if (e.consent && Object.keys(e.consent).length > 0) serialized.consent = e.consent;
      if (e.webhook?.url?.trim()) {
        serialized.webhook = {
          url: e.webhook.url.trim(),
          method: e.webhook.method ?? "POST",
          ...(e.webhook.auth_header?.trim() ? { auth_header: e.webhook.auth_header.trim() } : {}),
        };
      }
      if (e.success?.message?.trim() || e.success?.url?.trim()) {
        serialized.success = {
          ...(e.success.message?.trim() ? { message: e.success.message.trim() } : {}),
          ...(e.success.url?.trim() ? { url: e.success.url.trim() } : {}),
        };
      }
      return serialized;
    });
  }

  if (input.webhook !== undefined) {
    if (input.webhook === null) {
      delete nextTracking.webhook;
    } else {
      nextTracking.webhook = {
        url: input.webhook.url.trim(),
        method: input.webhook.method ?? "POST",
        ...(input.webhook.auth_header ? { auth_header: input.webhook.auth_header.trim() } : {}),
      };
    }
  }

  existing.tracking = nextTracking;

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  if (input.conversion_events !== undefined) {
    log.info(`[Settings] Updated tracking.conversion_events: ${input.conversion_events.length} event(s)`);
  }
  if (input.webhook !== undefined) {
    log.info(`[Settings] Updated tracking.webhook: ${input.webhook ? input.webhook.url : "(cleared)"}`);
  }
}

export function updateOptimizationSettings(input: { tagmanager: Partial<TagManagerSettings> }, contentRoot?: string): void {
  const settingsPath = getSettingsPath(contentRoot);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  const current = loadSettings(contentRoot).optimization.tagmanager;
  const tm = input.tagmanager ?? {};
  const updated: TagManagerSettings = {
    web_container_id:
      typeof tm.web_container_id === "string" ? tm.web_container_id.trim() : current.web_container_id,
    sgtm_enabled: typeof tm.sgtm_enabled === "boolean" ? tm.sgtm_enabled : current.sgtm_enabled,
    sgtm_server_url: typeof tm.sgtm_server_url === "string" ? tm.sgtm_server_url : current.sgtm_server_url,
    sgtm_proxy_path: typeof tm.sgtm_proxy_path === "string" ? tm.sgtm_proxy_path : current.sgtm_proxy_path,
  };

  if (updated.web_container_id && !/^GTM-[A-Z0-9]+$/.test(updated.web_container_id)) {
    throw new Error("Web container ID must match GTM-XXXXX (uppercase letters and digits)");
  }

  // Validate proxy path — must start with /, be more than just /, and contain a meaningful segment
  const pPath = updated.sgtm_proxy_path;
  if (!pPath.startsWith("/")) {
    throw new Error("Proxy path must start with /");
  }
  // Reject bare root path which would claim all routes
  const normalizedForValidation = pPath.replace(/\/$/, "") || "/";
  if (normalizedForValidation === "/" || normalizedForValidation === "") {
    throw new Error("Proxy path must not be / — use a specific path like /sgtm/");
  }
  // Ensure no path traversal or unsafe characters
  if (/[?#\s]/.test(pPath)) {
    throw new Error("Proxy path must not contain ?, #, or whitespace");
  }

  existing.optimization = {
    tagmanager: {
      web_container_id: updated.web_container_id,
      sgtm_enabled: updated.sgtm_enabled,
      sgtm_server_url: updated.sgtm_server_url,
      sgtm_proxy_path: updated.sgtm_proxy_path,
    },
  };

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(
    `[Settings] Updated optimization.tagmanager: web="${updated.web_container_id}", enabled=${updated.sgtm_enabled}, url="${updated.sgtm_server_url}", path="${updated.sgtm_proxy_path}"`,
  );
}
