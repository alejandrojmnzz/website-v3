import { z } from "zod";

export const RUNTIME_ISSUE_KINDS = ["http.not_found"] as const;
export type RuntimeIssueKind = (typeof RUNTIME_ISSUE_KINDS)[number];

export const runtimeIssueKindSchema = z.enum(RUNTIME_ISSUE_KINDS);

/** Hard-drop probe paths (prefix or exact). */
const HARD_DROP_PATH_PREFIXES = [
  "/.env",
  "/.git",
  "/wp-admin",
  "/wp-login",
  "/wp-content",
  "/xmlrpc.php",
  "/phpmyadmin",
  "/.aws",
  "/vendor/phpunit",
  "/actuator",
  "/cgi-bin",
];

const HARD_DROP_PATH_EXACT = new Set([
  "/favicon.ico",
  "/robots.txt", // often probed; skip noise (real robots is usually 200)
]);

const HARD_BOT_UA_RE =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|bytespider|semrush|ahrefs|mj12bot|dotbot|petalbot|gptbot|claudebot|scrapy|curl\/|wget\/|python-requests|go-http-client|java\/|libwww|httpclient|headlesschrome/i;

/** Soft-flag only (still recorded; UI can hide). */
const SOFT_BOT_UA_RE = /preview|monitor|uptime|pingdom|statuscake|synthetic/i;

export function stripQueryAndHash(urlOrPath: string): string {
  const noHash = urlOrPath.split("#")[0] ?? urlOrPath;
  return noHash.split("?")[0] ?? noHash;
}

/** Pathname only: strip query/hash, ensure leading slash, collapse trailing slash (except `/`). */
export function normalizeRuntimePath(urlOrPath: string): string {
  let raw = stripQueryAndHash(urlOrPath).trim();
  if (!raw) return "/";
  try {
    if (/^https?:\/\//i.test(raw)) {
      raw = new URL(raw).pathname || "/";
    }
  } catch {
    // keep raw
  }
  if (!raw.startsWith("/")) raw = `/${raw}`;
  // decode once for fingerprint stability
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep encoded
  }
  if (raw.length > 1 && raw.endsWith("/")) {
    raw = raw.slice(0, -1);
  }
  return raw || "/";
}

/** Best-effort locale from path (`/es/...`, `/en/...`); default `en`. */
export function localeFromPath(pathname: string): string {
  const path = normalizeRuntimePath(pathname);
  const m = path.match(/^\/([a-z]{2})(?:\/|$)/i);
  if (m?.[1]) return m[1].toLowerCase();
  return "en";
}

export function stripReferrerQuery(referrer: string | undefined | null): string | undefined {
  if (!referrer || !referrer.trim()) return undefined;
  try {
    if (/^https?:\/\//i.test(referrer)) {
      const u = new URL(referrer);
      return `${u.origin}${u.pathname}`;
    }
  } catch {
    // fall through
  }
  return stripQueryAndHash(referrer.trim()) || undefined;
}

export type UaBucket =
  | "bot"
  | "likely_bot"
  | "mobile"
  | "desktop"
  | "unknown";

export function bucketUserAgent(ua: string | undefined | null): UaBucket {
  if (!ua || !ua.trim()) return "unknown";
  if (HARD_BOT_UA_RE.test(ua)) return "bot";
  if (SOFT_BOT_UA_RE.test(ua)) return "likely_bot";
  if (/mobile|android|iphone|ipad/i.test(ua)) return "mobile";
  if (/mozilla|chrome|safari|firefox|edg\//i.test(ua)) return "desktop";
  return "unknown";
}

export function shouldHardDropNotFound(path: string, ua: string | undefined | null): boolean {
  const p = normalizeRuntimePath(path).toLowerCase();
  if (HARD_DROP_PATH_EXACT.has(p)) return true;
  for (const prefix of HARD_DROP_PATH_PREFIXES) {
    if (p === prefix || p.startsWith(prefix + "/") || p.startsWith(prefix)) return true;
  }
  if (ua && HARD_BOT_UA_RE.test(ua)) return true;
  return false;
}

export function isLikelyBotUa(ua: string | undefined | null): boolean {
  if (!ua) return false;
  return HARD_BOT_UA_RE.test(ua) || SOFT_BOT_UA_RE.test(ua);
}

export function fingerprintNotFound(site: string, locale: string, path: string): string {
  const normalized = normalizeRuntimePath(path);
  const loc = (locale || localeFromPath(normalized)).toLowerCase();
  return `http.not_found|${site}|${loc}|${normalized}`;
}

export const runtimeIssueRecordSchema = z.object({
  fingerprint: z.string(),
  kind: runtimeIssueKindSchema,
  path: z.string(),
  locale: z.string(),
  count: z.number().int().nonnegative(),
  firstSeen: z.number(),
  lastSeen: z.number(),
  sampleReferrer: z.string().optional(),
  uaBucket: z.string().optional(),
  hostname: z.string().optional(),
  likelyBot: z.boolean().optional(),
});

export type RuntimeIssueRecord = z.infer<typeof runtimeIssueRecordSchema>;

export const runtimeIssuesStateSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number(),
  issues: z.record(z.string(), runtimeIssueRecordSchema),
  recent: z
    .array(
      z.object({
        fingerprint: z.string(),
        ts: z.number(),
        referrer: z.string().optional(),
      }),
    )
    .optional(),
});

export type RuntimeIssuesState = z.infer<typeof runtimeIssuesStateSchema>;

export const MAX_ISSUES_PER_SITE = 2000;
export const ISSUE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_RECENT = 100;

export function emptyRuntimeIssuesState(): RuntimeIssuesState {
  return { version: 1, updatedAt: Date.now(), issues: {}, recent: [] };
}

export function pruneRuntimeIssuesState(
  state: RuntimeIssuesState,
  now = Date.now(),
): RuntimeIssuesState {
  const cutoff = now - ISSUE_TTL_MS;
  const entries = Object.values(state.issues).filter((i) => i.lastSeen >= cutoff);
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeen - a.lastSeen;
  });
  const kept = entries.slice(0, MAX_ISSUES_PER_SITE);
  const issues: Record<string, RuntimeIssueRecord> = {};
  for (const e of kept) issues[e.fingerprint] = e;
  const recent = (state.recent ?? []).filter((r) => r.ts >= cutoff).slice(-MAX_RECENT);
  return {
    version: 1,
    updatedAt: now,
    issues,
    recent,
  };
}
