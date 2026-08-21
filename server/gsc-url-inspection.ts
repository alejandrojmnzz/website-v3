import fs from "fs";
import path from "path";
import { GoogleAuth, type JWTInput } from "google-auth-library";
import { gscUrlInspectionReadKeys, siteSyncGcsKey, SYNC_FILENAMES } from "@shared/gcsKeys";
import { CACHE_DIR } from "./db-cache";
import { gcs } from "./gcs";
import { child } from "./logger";
import type { DebugSitemapUrl } from "./sitemap";
import { getSearchConsoleSettings } from "./settings";

const log = child({ module: "gsc-url-inspection" });

export const FRESH_MS = 60 * 60 * 1000;
export const STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const GSC_GCS_DEBOUNCE_MS = 30_000;
export const MAX_INSPECT_URLS = 10;
export const EXCEPTION_CAP = 25;
const FILENAME = SYNC_FILENAMES.gscUrlInspection;
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const INSPECT_ENDPOINT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const SITES_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";

export interface GscInspectionRecord {
  inspectedAt: string;
  coverageState?: string;
  indexingState?: string;
  verdict?: string;
  lastCrawlTime?: string;
  robotsTxtState?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  error?: string;
}

export interface GscCoverageBucket {
  inSitemap: number;
  inspected: number;
  indexed: number;
  notIndexed: number;
  neverChecked: number;
}

export interface GscExceptionRow {
  loc: string;
  content_type?: string;
  coverageState?: string;
  googleCanonical?: string;
  userCanonical?: string;
}

export interface GscInspectionSummary {
  sitemapCount: number;
  inspected: number;
  indexed: number;
  notIndexed: number;
  errors: number;
  neverChecked: number;
  stale: number;
  notOnSitemap: number;
  newestInspectedAt: string | null;
  byContentType: Record<string, GscCoverageBucket>;
  exceptions: {
    notIndexed: GscExceptionRow[];
    canonicalMismatch: GscExceptionRow[];
  };
}

export type GscCredentialsSource = "gsc" | "gcs" | null;
export type GscCredentialsEnvVar =
  | "GCS_CREDENTIALS_JSON"
  | "GCS_KEY_FILENAME"
  | "GSC_CREDENTIALS_JSON"
  | "GSC_KEY_FILENAME";
export type GscPropertyAccess = "ok" | "denied" | "unknown";

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscEnvConfig {
  configured: boolean;
  siteUrl: string | null;
  credentialsConfigured: boolean;
  credentialsSource: GscCredentialsSource;
  /** Env var that supplied credentials, or the primary var we look for when missing. */
  credentialsEnvVar: GscCredentialsEnvVar;
  serviceAccountEmail: string | null;
}

export interface ResolveInspectLoc {
  loc: string | null;
  inSitemap: boolean;
  isDraft: boolean;
  matched: DebugSitemapUrl | null;
}

type StoreFile = { records: Record<string, GscInspectionRecord> };

const memory = new Map<string, StoreFile>();
let cacheRoot = CACHE_DIR;
let productionOverride: boolean | null = null;

type GscGcsClient = {
  available: boolean;
  initBootstrapFromEnv: () => void;
  downloadFirstExisting: (keys: string[]) => Promise<{ data: Buffer; key: string } | null>;
  debouncedUpload: (key: string, data: Buffer, contentType?: string, delayMs?: number) => void;
  upload: (key: string, data: Buffer, contentType?: string) => Promise<unknown>;
};

let gcsOverride: GscGcsClient | null = null;

function isGscGcsProduction(): boolean {
  return productionOverride ?? process.env.NODE_ENV === "production";
}

function gcsClient(): GscGcsClient {
  return gcsOverride ?? gcs;
}

export function setGscCacheRootForTests(dir: string | null): void {
  cacheRoot = dir ?? CACHE_DIR;
  memory.clear();
}

export function setGscGcsSyncForTests(opts: {
  production?: boolean | null;
  gcs?: GscGcsClient | null;
} | null): void {
  if (!opts) {
    productionOverride = null;
    gcsOverride = null;
    return;
  }
  if (opts.production !== undefined) productionOverride = opts.production;
  if (opts.gcs !== undefined) gcsOverride = opts.gcs;
}

export function resetGscInspectionMemory(): void {
  memory.clear();
}

export function sidecarPath(contentRootName: string): string {
  return path.join(cacheRoot, contentRootName, FILENAME);
}

function emptyStore(): StoreFile {
  return { records: {} };
}

export function loadStore(contentRootName: string): StoreFile {
  const cached = memory.get(contentRootName);
  if (cached) return cached;
  const filePath = sidecarPath(contentRootName);
  if (!fs.existsSync(filePath)) {
    const empty = emptyStore();
    memory.set(contentRootName, empty);
    return empty;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as StoreFile;
    const store: StoreFile = {
      records: parsed?.records && typeof parsed.records === "object" ? parsed.records : {},
    };
    memory.set(contentRootName, store);
    return store;
  } catch (err) {
    log.warn({ err }, "[GSC] Failed to read sidecar — starting empty");
    const empty = emptyStore();
    memory.set(contentRootName, empty);
    return empty;
  }
}

export function saveStore(
  contentRootName: string,
  store: StoreFile,
  opts?: { skipGcs?: boolean },
): void {
  const filePath = sidecarPath(contentRootName);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(store, null, 2) + "\n";
  const tmpPath = path.join(dir, `._gsc_${process.pid}_${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, json, "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
  memory.set(contentRootName, store);
  if (opts?.skipGcs) return;
  queueGscInspectionUpload(contentRootName, json);
}

function gscInspectionGcsKey(contentRootName: string): string {
  return siteSyncGcsKey(contentRootName, FILENAME);
}

function queueGscInspectionUpload(contentRootName: string, json: string): void {
  if (!isGscGcsProduction()) return;
  const client = gcsClient();
  if (!client.available) return;
  try {
    client.debouncedUpload(
      gscInspectionGcsKey(contentRootName),
      Buffer.from(json, "utf-8"),
      "application/json",
      GSC_GCS_DEBOUNCE_MS,
    );
  } catch (err) {
    log.error({ err, contentRootName }, "[GSC] Error queueing inspection sidecar upload");
  }
}

export async function loadGscInspectionStoreFromBucket(
  contentRootName: string,
  opts?: { forceFromGcs?: boolean },
): Promise<"gcs" | "local" | "empty"> {
  const hasLocal = fs.existsSync(sidecarPath(contentRootName));
  const forceFromGcs = Boolean(opts?.forceFromGcs);
  // Boot / normal reload: production only. Dev can opt in via forceFromGcs (pull prod cache).
  if (!isGscGcsProduction() && !forceFromGcs) {
    log.info({ contentRootName }, "[GSC] Development mode, using local sidecar only");
    return hasLocal ? "local" : "empty";
  }

  const client = gcsClient();
  if (!client.available) {
    client.initBootstrapFromEnv();
  }
  if (!client.available) {
    log.info({ contentRootName, forceFromGcs }, "[GSC] GCS unavailable, using local sidecar");
    return hasLocal ? "local" : "empty";
  }

  try {
    const result = await client.downloadFirstExisting(gscUrlInspectionReadKeys(contentRootName));
    if (!result) {
      log.info({ contentRootName, forceFromGcs }, "[GSC] No inspection sidecar in bucket");
      return hasLocal ? "local" : "empty";
    }

    let parsed: StoreFile;
    try {
      parsed = JSON.parse(result.data.toString("utf-8")) as StoreFile;
    } catch (err) {
      log.warn({ err, contentRootName }, "[GSC] Invalid inspection sidecar in bucket — starting empty");
      memory.set(contentRootName, emptyStore());
      return "empty";
    }
    if (!parsed || typeof parsed !== "object") {
      log.warn({ contentRootName }, "[GSC] Invalid inspection sidecar in bucket — starting empty");
      memory.set(contentRootName, emptyStore());
      return "empty";
    }

    const store: StoreFile = {
      records: parsed.records && typeof parsed.records === "object" ? parsed.records : {},
    };
    saveStore(contentRootName, store, { skipGcs: true });
    log.info(
      { contentRootName, count: Object.keys(store.records).length, forceFromGcs },
      "[GSC] Loaded inspection sidecar from GCS",
    );
    return "gcs";
  } catch (err) {
    log.error({ err, contentRootName, forceFromGcs }, "[GSC] Error loading inspection sidecar from bucket");
    return hasLocal ? "local" : "empty";
  }
}

export async function loadGscInspectionStoresFromBucket(contentRootNames: string[]): Promise<void> {
  await Promise.all(contentRootNames.map((name) => loadGscInspectionStoreFromBucket(name)));
}

export async function reloadGscInspectionStoreFromBucket(
  contentRootName: string,
  opts?: { forceFromGcs?: boolean },
): Promise<"gcs" | "local" | "empty"> {
  memory.delete(contentRootName);
  const source = await loadGscInspectionStoreFromBucket(contentRootName, opts);
  if (source !== "gcs") loadStore(contentRootName);
  return source;
}

/** Dev-only helper: pull production sidecar into local .cache (never uploads). */
export async function pullGscInspectionStoreFromBucket(
  contentRootName: string,
): Promise<{ source: "gcs" | "local" | "empty"; recordCount: number; gcsKey: string }> {
  const gcsKey = gscInspectionGcsKey(contentRootName);
  const source = await reloadGscInspectionStoreFromBucket(contentRootName, { forceFromGcs: true });
  const store = loadStore(contentRootName);
  return {
    source,
    recordCount: Object.keys(store.records).length,
    gcsKey,
  };
}

export interface ReuploadGscInspectionResult {
  success: boolean;
  uploaded: boolean;
  gcsKey: string;
  reason?: string;
}

export async function forceUploadGscInspectionToBucket(
  contentRootName: string,
): Promise<ReuploadGscInspectionResult> {
  const gcsKey = gscInspectionGcsKey(contentRootName);
  if (!isGscGcsProduction()) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "GCS sync only runs in production (NODE_ENV=production).",
    };
  }
  const client = gcsClient();
  if (!client.available) {
    client.initBootstrapFromEnv();
  }
  if (!client.available) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
    };
  }
  const store = loadStore(contentRootName);
  const filePath = sidecarPath(contentRootName);
  if (!fs.existsSync(filePath) && Object.keys(store.records).length === 0) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "No local Search Console inspection cache found to upload.",
    };
  }
  saveStore(contentRootName, store, { skipGcs: true });
  const json = JSON.stringify(store, null, 2) + "\n";
  await client.upload(gcsKey, Buffer.from(json, "utf-8"), "application/json");
  log.info({ contentRootName, gcsKey }, "[GSC] Re-uploaded inspection sidecar to GCS via admin action");
  return { success: true, uploaded: true, gcsKey };
}

export function getRecord(contentRootName: string, loc: string): GscInspectionRecord | undefined {
  return loadStore(contentRootName).records[loc];
}

export function upsertRecord(
  contentRootName: string,
  loc: string,
  record: GscInspectionRecord,
): GscInspectionRecord {
  const store = loadStore(contentRootName);
  store.records[loc] = record;
  saveStore(contentRootName, store);
  return record;
}

function parseServiceAccountEmail(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { client_email?: unknown };
    return typeof parsed.client_email === "string" ? parsed.client_email : null;
  } catch {
    return null;
  }
}

function readKeyFileEmail(filePath: string): string | null {
  try {
    return parseServiceAccountEmail(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** GSC_* overrides GCS_* (media). Same service account is assumed. */
export function resolveGscCredentials(): {
  json: string | null;
  keyFile: string | null;
  source: GscCredentialsSource;
  envVar: GscCredentialsEnvVar;
} {
  const gscJson = (process.env.GSC_CREDENTIALS_JSON || "").trim();
  const gcsJson = (process.env.GCS_CREDENTIALS_JSON || "").trim();
  const gscKey = (process.env.GSC_KEY_FILENAME || "").trim();
  const gcsKey = (process.env.GCS_KEY_FILENAME || "").trim();
  if (gscJson) return { json: gscJson, keyFile: null, source: "gsc", envVar: "GSC_CREDENTIALS_JSON" };
  if (gcsJson) return { json: gcsJson, keyFile: null, source: "gcs", envVar: "GCS_CREDENTIALS_JSON" };
  if (gscKey) return { json: null, keyFile: gscKey, source: "gsc", envVar: "GSC_KEY_FILENAME" };
  if (gcsKey) return { json: null, keyFile: gcsKey, source: "gcs", envVar: "GCS_KEY_FILENAME" };
  return { json: null, keyFile: null, source: null, envVar: "GCS_CREDENTIALS_JSON" };
}

export function isGscPropertyAccessDenied(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (m.includes("permission_denied")) return true;
  if (m.includes("does not have sufficient permission")) return true;
  if (m.includes("user does not have")) return true;
  if (m.includes("caller does not have permission")) return true;
  if (/\b403\b/.test(m) && (m.includes("permission") || m.includes("forbidden") || m.includes("access"))) {
    return true;
  }
  return false;
}

export function gscPropertyAccessFromRecords(
  records: Record<string, GscInspectionRecord>,
): GscPropertyAccess {
  let sawSuccess = false;
  let sawDenied = false;
  for (const rec of Object.values(records)) {
    if (isGscPropertyAccessDenied(rec.error)) sawDenied = true;
    else if (rec.verdict || rec.coverageState) sawSuccess = true;
  }
  if (sawDenied && !sawSuccess) return "denied";
  if (sawSuccess) return "ok";
  return "unknown";
}

export function getGscConfig(contentRoot?: string): GscEnvConfig {
  const siteUrl = getSearchConsoleSettings(contentRoot).site_url;
  const creds = resolveGscCredentials();
  const credentialsConfigured = Boolean(creds.json || creds.keyFile);
  let serviceAccountEmail: string | null = null;
  if (creds.json) serviceAccountEmail = parseServiceAccountEmail(creds.json);
  else if (creds.keyFile) serviceAccountEmail = readKeyFileEmail(creds.keyFile);
  return {
    siteUrl,
    credentialsConfigured,
    credentialsSource: creds.source,
    credentialsEnvVar: creds.envVar,
    serviceAccountEmail,
    configured: Boolean(siteUrl && credentialsConfigured),
  };
}

/** Prefill-only suggestion from the sites.yml domain. Never used as an inspect fallback. */
export function suggestedGscSiteUrl(domain: string | undefined | null): string | null {
  const raw = (domain || "").trim();
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") {
    return null;
  }
  return `https://${host}/`;
}

export function gscPropertyHost(siteUrl: string): string | null {
  const trimmed = siteUrl.trim();
  if (trimmed.toLowerCase().startsWith("sc-domain:")) {
    return trimmed.slice("sc-domain:".length).replace(/^www\./i, "").toLowerCase() || null;
  }
  try {
    return new URL(trimmed).hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export function sitemapHostMatchesGsc(sitemapLoc: string | undefined, gscSiteUrl: string | null): boolean | null {
  if (!gscSiteUrl || !sitemapLoc) return null;
  const gscHost = gscPropertyHost(gscSiteUrl);
  let sitemapHost: string | null = null;
  try {
    sitemapHost = new URL(sitemapLoc).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
  if (!gscHost || !sitemapHost) return null;
  return gscHost === sitemapHost || sitemapHost.endsWith(`.${gscHost}`) || gscHost.endsWith(`.${sitemapHost}`);
}

export function isIndexed(record: GscInspectionRecord | undefined): boolean {
  if (!record) return false;
  const verdict = (record.verdict || "").toUpperCase();
  if (verdict === "PASS") return true;
  const coverage = (record.coverageState || "").toLowerCase();
  return coverage.includes("submitted and indexed") || coverage === "indexed";
}

export function isFresh(record: GscInspectionRecord | undefined, now = Date.now()): boolean {
  if (!record?.inspectedAt) return false;
  const at = new Date(record.inspectedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at < FRESH_MS;
}

/** Missing, unreadable, or older than 7 days — eligible for bulk Stale inspect. */
export function isStale(record: GscInspectionRecord | undefined, now = Date.now()): boolean {
  if (!record?.inspectedAt) return true;
  const at = new Date(record.inspectedAt).getTime();
  if (Number.isNaN(at)) return true;
  return now - at >= STALE_MS;
}

export function toUrlPath(raw: string): string {
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      return u.pathname + u.search;
    }
  } catch {
    /* fall through */
  }
  const q = raw.indexOf("?");
  const pathOnly = q >= 0 ? raw.slice(0, q) : raw;
  return pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
}

export function isPreviewLoc(loc: string): boolean {
  return /\/private\/preview\//i.test(toUrlPath(loc));
}

export function resolvePublicInspectLoc(requested: string, debugUrls: DebugSitemapUrl[]): ResolveInspectLoc {
  const requestedPath = toUrlPath(requested);
  const exact = debugUrls.find(
    (u) => u.loc === requested || toUrlPath(u.loc) === requestedPath,
  );

  if (exact && !isPreviewLoc(exact.loc) && !exact.isDraft) {
    return { loc: exact.loc, inSitemap: exact.inSitemap, isDraft: false, matched: exact };
  }

  const type = exact?.content_type;
  const slug = exact?.slug;
  const locale = exact?.locale;
  if (type && slug) {
    const publicMatch = debugUrls.find(
      (u) =>
        u.content_type === type &&
        u.slug === slug &&
        (!locale || u.locale === locale) &&
        !isPreviewLoc(u.loc) &&
        !u.isDraft,
    );
    if (publicMatch) {
      return {
        loc: publicMatch.loc,
        inSitemap: publicMatch.inSitemap,
        isDraft: false,
        matched: publicMatch,
      };
    }
  }

  if (exact?.isDraft || (exact && isPreviewLoc(exact.loc))) {
    return { loc: null, inSitemap: false, isDraft: true, matched: exact };
  }

  if (/^https?:\/\//i.test(requested) && !isPreviewLoc(requested)) {
    return { loc: requested, inSitemap: false, isDraft: false, matched: null };
  }

  return { loc: null, inSitemap: false, isDraft: false, matched: exact ?? null };
}

export function assertInspectBatch(urls: unknown): string | null {
  if (!Array.isArray(urls) || urls.length === 0) return "urls must be a non-empty array";
  if (urls.length > MAX_INSPECT_URLS) {
    return `At most ${MAX_INSPECT_URLS} URLs per request`;
  }
  if (urls.some((u) => typeof u !== "string" || !u.trim())) {
    return "each url must be a non-empty string";
  }
  return null;
}

type InspectApiSuccess = {
  inspectionResult?: {
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      robotsTxtState?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
    };
  };
};

export function mapInspectPayload(json: InspectApiSuccess): Omit<GscInspectionRecord, "inspectedAt" | "error"> {
  const status = json?.inspectionResult?.indexStatusResult ?? {};
  const pick = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v : undefined;
  return {
    coverageState: pick(status.coverageState),
    indexingState: pick(status.indexingState),
    verdict: pick(status.verdict),
    lastCrawlTime: pick(status.lastCrawlTime),
    robotsTxtState: pick(status.robotsTxtState),
    pageFetchState: pick(status.pageFetchState),
    googleCanonical: pick(status.googleCanonical),
    userCanonical: pick(status.userCanonical),
  };
}

export function mergeInspectSuccess(
  prev: GscInspectionRecord | undefined,
  mapped: Omit<GscInspectionRecord, "inspectedAt" | "error">,
  inspectedAt: string,
): GscInspectionRecord {
  const next: GscInspectionRecord = {
    ...prev,
    ...mapped,
    inspectedAt,
  };
  delete next.error;
  return next;
}

export function mergeInspectError(
  prev: GscInspectionRecord | undefined,
  error: string,
  inspectedAt: string,
): GscInspectionRecord {
  return {
    ...prev,
    inspectedAt: prev?.inspectedAt ?? inspectedAt,
    error,
  };
}

function emptyBucket(): GscCoverageBucket {
  return { inSitemap: 0, inspected: 0, indexed: 0, notIndexed: 0, neverChecked: 0 };
}

export function buildSummary(
  records: Record<string, GscInspectionRecord>,
  debugUrls: DebugSitemapUrl[],
  now = Date.now(),
): GscInspectionSummary {
  const byContentType: Record<string, GscCoverageBucket> = {};
  const notIndexedRows: GscExceptionRow[] = [];
  const canonicalRows: GscExceptionRow[] = [];
  let sitemapCount = 0;
  let inspected = 0;
  let indexed = 0;
  let notIndexed = 0;
  let errors = 0;
  let neverChecked = 0;
  let stale = 0;
  let notOnSitemap = 0;
  let newest = 0;
  let newestInspectedAt: string | null = null;

  for (const rec of Object.values(records)) {
    if (rec.error) errors += 1;
    const t = rec.inspectedAt ? new Date(rec.inspectedAt).getTime() : 0;
    if (t > newest) {
      newest = t;
      newestInspectedAt = rec.inspectedAt;
    }
  }

  for (const url of debugUrls) {
    if (url.isDraft || isPreviewLoc(url.loc)) {
      notOnSitemap += 1;
      continue;
    }
    const typeKey = url.content_type || "other";
    if (!byContentType[typeKey]) byContentType[typeKey] = emptyBucket();
    const bucket = byContentType[typeKey];

    if (!url.inSitemap) {
      notOnSitemap += 1;
      continue;
    }

    sitemapCount += 1;
    bucket.inSitemap += 1;
    const rec = records[url.loc];
    if (isStale(rec, now)) stale += 1;
    if (!rec) {
      neverChecked += 1;
      bucket.neverChecked += 1;
      continue;
    }
    inspected += 1;
    bucket.inspected += 1;
    if (isIndexed(rec)) {
      indexed += 1;
      bucket.indexed += 1;
    } else {
      notIndexed += 1;
      bucket.notIndexed += 1;
      if (notIndexedRows.length < EXCEPTION_CAP) {
        notIndexedRows.push({
          loc: url.loc,
          content_type: url.content_type,
          coverageState: rec.coverageState,
        });
      }
    }
    const gCan = rec.googleCanonical;
    if (gCan && gCan !== url.loc && canonicalRows.length < EXCEPTION_CAP) {
      canonicalRows.push({
        loc: url.loc,
        content_type: url.content_type,
        googleCanonical: gCan,
        userCanonical: rec.userCanonical,
      });
    }
  }

  return {
    sitemapCount,
    inspected,
    indexed,
    notIndexed,
    errors,
    neverChecked,
    stale,
    notOnSitemap,
    newestInspectedAt,
    byContentType,
    exceptions: {
      notIndexed: notIndexedRows,
      canonicalMismatch: canonicalRows,
    },
  };
}

export type GoogleInspectFn = (inspectionUrl: string, siteUrl: string) => Promise<InspectApiSuccess>;
export type GoogleListSitesFn = () => Promise<unknown>;

export function mapGscSitesListPayload(json: unknown): GscSiteEntry[] {
  if (!json || typeof json !== "object") return [];
  const entry = (json as { siteEntry?: unknown }).siteEntry;
  if (!Array.isArray(entry)) return [];
  const out: GscSiteEntry[] = [];
  for (const row of entry) {
    if (!row || typeof row !== "object") continue;
    const siteUrl = (row as { siteUrl?: unknown }).siteUrl;
    if (typeof siteUrl !== "string" || !siteUrl.trim()) continue;
    const rawLevel = (row as { permissionLevel?: unknown }).permissionLevel;
    out.push({
      siteUrl: siteUrl.trim(),
      permissionLevel: typeof rawLevel === "string" ? rawLevel : "",
    });
  }
  return out;
}

export function gscPermissionLabel(level: string): string {
  switch (level) {
    case "siteOwner":
      return "Owner";
    case "siteFullUser":
      return "Full user";
    case "siteRestrictedUser":
      return "Restricted user";
    case "siteUnverifiedUser":
      return "Unverified";
    default:
      return level || "Unknown";
  }
}

async function getGscAccessToken(): Promise<string> {
  const creds = resolveGscCredentials();
  const jsonEnv = creds.json;
  const keyFile = creds.keyFile || "";
  if (!jsonEnv && !keyFile) {
    throw new Error("Search Console credentials are not configured");
  }
  const auth = jsonEnv
    ? new GoogleAuth({
        credentials: JSON.parse(jsonEnv) as JWTInput,
        scopes: [GSC_SCOPE],
      })
    : new GoogleAuth({
        keyFilename: keyFile,
        scopes: [GSC_SCOPE],
      });
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  const token = typeof tokenRes === "string" ? tokenRes : tokenRes?.token;
  if (!token) throw new Error("Failed to obtain Google access token");
  return token;
}

async function defaultGoogleListSites(): Promise<unknown> {
  const token = await getGscAccessToken();
  const res = await fetch(SITES_ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Search Console sites.list failed (${res.status}): ${bodyText.slice(0, 400)}`);
  }
  return JSON.parse(bodyText) as unknown;
}

export async function listGscSites(opts?: { listFn?: GoogleListSitesFn }): Promise<GscSiteEntry[]> {
  const json = opts?.listFn ? await opts.listFn() : await defaultGoogleListSites();
  return mapGscSitesListPayload(json);
}

async function defaultGoogleInspect(inspectionUrl: string, siteUrl: string): Promise<InspectApiSuccess> {
  const token = await getGscAccessToken();
  const res = await fetch(INSPECT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inspectionUrl, siteUrl }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Search Console inspect failed (${res.status}): ${bodyText.slice(0, 400)}`);
  }
  return JSON.parse(bodyText) as InspectApiSuccess;
}

export interface InspectUrlResult {
  requested: string;
  loc: string | null;
  skipped?: boolean;
  isDraft?: boolean;
  inSitemap?: boolean;
  record?: GscInspectionRecord;
  error?: string;
}

export async function inspectAndStore(opts: {
  contentRootName: string;
  contentRoot?: string;
  urls: string[];
  force?: boolean;
  debugUrls: DebugSitemapUrl[];
  now?: number;
  inspectFn?: GoogleInspectFn;
}): Promise<InspectUrlResult[]> {
  const cfg = getGscConfig(opts.contentRoot);
  if (!cfg.configured || !cfg.siteUrl) {
    throw new Error(
      "Search Console is not configured. Save search_console.site_url in settings.yml and set GCS_CREDENTIALS_JSON or GCS_KEY_FILENAME.",
    );
  }
  const now = opts.now ?? Date.now();
  const inspectFn = opts.inspectFn ?? defaultGoogleInspect;
  const results: InspectUrlResult[] = [];

  for (const requested of opts.urls) {
    const resolved = resolvePublicInspectLoc(requested.trim(), opts.debugUrls);
    if (resolved.isDraft || !resolved.loc) {
      results.push({
        requested,
        loc: resolved.loc,
        isDraft: true,
        inSitemap: false,
        error: "Draft or preview URLs are not sent to Google Search Console",
      });
      continue;
    }
    const loc = resolved.loc;
    const prev = getRecord(opts.contentRootName, loc);
    if (!opts.force && isFresh(prev, now)) {
      results.push({
        requested,
        loc,
        skipped: true,
        inSitemap: resolved.inSitemap,
        record: prev,
      });
      continue;
    }
    const inspectedAt = new Date(now).toISOString();
    try {
      const payload = await inspectFn(loc, cfg.siteUrl);
      const mapped = mapInspectPayload(payload);
      const record = mergeInspectSuccess(prev, mapped, inspectedAt);
      upsertRecord(opts.contentRootName, loc, record);
      results.push({ requested, loc, inSitemap: resolved.inSitemap, record });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const record = mergeInspectError(prev, message, inspectedAt);
      upsertRecord(opts.contentRootName, loc, record);
      results.push({ requested, loc, inSitemap: resolved.inSitemap, record, error: message });
    }
  }
  return results;
}

export function homepageLocFromDebug(debugUrls: DebugSitemapUrl[]): string | null {
  const home = debugUrls.find((u) => {
    if (u.isDraft || isPreviewLoc(u.loc) || !u.inSitemap) return false;
    try {
      const p = new URL(u.loc).pathname;
      return p === "/" || p === "";
    } catch {
      return false;
    }
  });
  return home?.loc ?? debugUrls.find((u) => u.inSitemap && !u.isDraft)?.loc ?? null;
}

export function hasMainSeoKeyword(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const top = data.main_seo_keyword;
  if (typeof top === "string" && top.trim()) return true;
  const seo = data.seo;
  if (seo && typeof seo === "object" && !Array.isArray(seo)) {
    const nested = (seo as Record<string, unknown>).main_seo_keyword;
    if (typeof nested === "string" && nested.trim()) return true;
  }
  return false;
}
