import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { child } from "./logger";
const log = child({ module: "settings" });



const DEFAULT_CONTENT_ROOT = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content");

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

export interface ConversionEventEntry {
  name: string;
  description?: string;
  automations?: string;
  tags?: string[];
  consent?: ConsentDefaults;
  webhook?: WebhookConfig;
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

interface SiteSettings {
  i18n: I18nSettings;
  home_page: HomePageSettings;
  optimization: OptimizationSettings;
  tracking: TrackingSettings;
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
        sgtm_enabled: false,
        sgtm_server_url: "",
        sgtm_proxy_path: "/sgtm/",
      },
    },
    tracking: {
      conversion_events: [],
    },
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
              };
              return entry;
            })
        : defaults.tracking.conversion_events,
      webhook: parseWebhook(trackingRaw?.webhook),
    };

    const result: SiteSettings = { ...defaults, i18n, home_page, optimization, tracking };
    settingsCache.set(key, result);
    log.info(
      `[Settings] Loaded: ${i18n.supported_locales.length} locale(s), default="${i18n.default_locale}", home_page="${home_page.slug}", conversion_events=${tracking.conversion_events.length}`
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
    sgtm_enabled: typeof tm.sgtm_enabled === "boolean" ? tm.sgtm_enabled : current.sgtm_enabled,
    sgtm_server_url: typeof tm.sgtm_server_url === "string" ? tm.sgtm_server_url : current.sgtm_server_url,
    sgtm_proxy_path: typeof tm.sgtm_proxy_path === "string" ? tm.sgtm_proxy_path : current.sgtm_proxy_path,
  };

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
      sgtm_enabled: updated.sgtm_enabled,
      sgtm_server_url: updated.sgtm_server_url,
      sgtm_proxy_path: updated.sgtm_proxy_path,
    },
  };

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(settingsPath, output, "utf-8");
  resetSettings(resolveSettingsRoot(contentRoot));
  log.info(`[Settings] Updated optimization.tagmanager: enabled=${updated.sgtm_enabled}, url="${updated.sgtm_server_url}", path="${updated.sgtm_proxy_path}"`);
}
