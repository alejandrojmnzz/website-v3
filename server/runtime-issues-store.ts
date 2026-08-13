/**
 * Per-site runtime issues store — in-memory aggregates flushed to local + GCS.
 * Last-write-wins on GCS (v1). Never await GCS on the request hot path.
 */

import * as fs from "fs";
import * as path from "path";
import {
  SYNC_FILENAMES,
  runtimeIssuesStateReadKeys,
  siteSyncGcsKey,
} from "@shared/gcsKeys";
import {
  emptyRuntimeIssuesState,
  fingerprintNotFound,
  localeFromPath,
  normalizeRuntimePath,
  pruneRuntimeIssuesState,
  shouldHardDropNotFound,
  stripReferrerQuery,
  bucketUserAgent,
  isLikelyBotUa,
  MAX_RECENT,
  type RuntimeIssuesState,
  type RuntimeIssueRecord,
} from "@shared/runtime-issues";
import { gcs } from "./gcs";
import { child } from "./logger";

const log = child({ module: "runtime-issues" });
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEBOUNCE_MS = 5_000;

type SiteBucket = {
  state: RuntimeIssuesState;
  loaded: boolean;
  contentRoot?: string;
};

const bySite = new Map<string, SiteBucket>();

function localPathForSite(site: string, contentRoot?: string): string {
  if (contentRoot) {
    return path.join(contentRoot, `.${SYNC_FILENAMES.runtimeIssuesState}`);
  }
  return path.join(process.cwd(), "data", "runtime-issues", `${site}.json`);
}

function gcsKey(site: string): string {
  return siteSyncGcsKey(site, SYNC_FILENAMES.runtimeIssuesState);
}

function ensureBucket(site: string, contentRoot?: string): SiteBucket {
  let b = bySite.get(site);
  if (!b) {
    b = { state: emptyRuntimeIssuesState(), loaded: false, contentRoot };
    bySite.set(site, b);
  } else if (contentRoot && !b.contentRoot) {
    b.contentRoot = contentRoot;
  }
  return b;
}

function saveLocal(site: string): void {
  const b = bySite.get(site);
  if (!b) return;
  try {
    const file = localPathForSite(site, b.contentRoot);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(b.state, null, 2), "utf-8");
  } catch (err) {
    log.error({ err, site }, "failed to save local runtime-issues");
  }
}

function saveToBucket(site: string): void {
  if (!IS_PRODUCTION || !gcs.available) return;
  const b = bySite.get(site);
  if (!b) return;
  try {
    const content = JSON.stringify(b.state, null, 2);
    gcs.debouncedUpload(gcsKey(site), Buffer.from(content, "utf-8"), "application/json", DEBOUNCE_MS);
  } catch (err) {
    log.error({ err, site }, "failed to schedule GCS upload for runtime-issues");
  }
}

function save(site: string): void {
  const b = bySite.get(site);
  if (!b) return;
  b.state = pruneRuntimeIssuesState(b.state);
  saveLocal(site);
  saveToBucket(site);
}

function loadLocalInto(site: string, contentRoot?: string): RuntimeIssuesState {
  try {
    const file = localPathForSite(site, contentRoot);
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (raw && raw.version === 1 && raw.issues) {
        return pruneRuntimeIssuesState(raw as RuntimeIssuesState);
      }
    }
  } catch (err) {
    log.error({ err, site }, "failed to load local runtime-issues");
  }
  return emptyRuntimeIssuesState();
}

/**
 * Load one site's runtime issues from GCS (prod) or local file.
 */
export async function loadRuntimeIssuesForSite(
  site: string,
  contentRoot?: string,
): Promise<void> {
  const b = ensureBucket(site, contentRoot);

  if (!IS_PRODUCTION || !gcs.available) {
    b.state = loadLocalInto(site, contentRoot);
    b.loaded = true;
    return;
  }

  try {
    const result = await gcs.downloadFirstExisting(runtimeIssuesStateReadKeys(site));
    if (result) {
      const parsed = JSON.parse(result.data.toString("utf-8")) as RuntimeIssuesState;
      b.state = pruneRuntimeIssuesState(parsed);
      saveLocal(site);
      log.info({ site }, "loaded runtime-issues from GCS");
    } else {
      b.state = loadLocalInto(site, contentRoot);
      log.info({ site }, "no runtime-issues in GCS — using local");
    }
  } catch (err) {
    log.error({ err, site }, "GCS load failed for runtime-issues");
    b.state = loadLocalInto(site, contentRoot);
  }
  b.loaded = true;
}

export async function loadAllRuntimeIssuesFromBucket(
  sites: Array<{ site: string; contentRoot: string }>,
): Promise<void> {
  await Promise.all(sites.map((s) => loadRuntimeIssuesForSite(s.site, s.contentRoot)));
}

function ensureLoadedSync(site: string, contentRoot?: string): SiteBucket {
  const b = ensureBucket(site, contentRoot);
  if (!b.loaded) {
    b.state = loadLocalInto(site, contentRoot);
    b.loaded = true;
  }
  return b;
}

export interface RecordNotFoundInput {
  site: string;
  contentRoot?: string;
  path: string;
  locale?: string;
  hostname?: string;
  referrer?: string | null;
  userAgent?: string | null;
  ts?: number;
}

/**
 * Record a public HTML 404. Synchronous; never awaits GCS.
 * Returns false if hard-dropped.
 */
export function recordPublicNotFound(input: RecordNotFoundInput): boolean {
  const pathNorm = normalizeRuntimePath(input.path);
  if (pathNorm.startsWith("/api/") || pathNorm.startsWith("/private/")) return false;
  if (shouldHardDropNotFound(pathNorm, input.userAgent)) return false;

  const locale = (input.locale || localeFromPath(pathNorm)).toLowerCase();
  const site = input.site || "default";
  const ts = input.ts ?? Date.now();
  const fingerprint = fingerprintNotFound(site, locale, pathNorm);
  const sampleReferrer = stripReferrerQuery(input.referrer);
  const uaBucket = bucketUserAgent(input.userAgent);
  const likelyBot = isLikelyBotUa(input.userAgent) || uaBucket === "bot" || uaBucket === "likely_bot";

  const b = ensureLoadedSync(site, input.contentRoot);
  const existing = b.state.issues[fingerprint];
  const next: RuntimeIssueRecord = existing
    ? {
        ...existing,
        count: existing.count + 1,
        lastSeen: ts,
        sampleReferrer: sampleReferrer ?? existing.sampleReferrer,
        uaBucket: uaBucket || existing.uaBucket,
        hostname: input.hostname || existing.hostname,
        likelyBot: existing.likelyBot || likelyBot,
      }
    : {
        fingerprint,
        kind: "http.not_found",
        path: pathNorm,
        locale,
        count: 1,
        firstSeen: ts,
        lastSeen: ts,
        sampleReferrer,
        uaBucket,
        hostname: input.hostname,
        likelyBot,
      };

  b.state.issues[fingerprint] = next;
  const recent = b.state.recent ?? [];
  recent.push({ fingerprint, ts, referrer: sampleReferrer });
  b.state.recent = recent.slice(-MAX_RECENT);
  b.state.updatedAt = ts;
  save(site);
  return true;
}

export function listRuntimeIssues(
  site: string,
  opts?: { hideBots?: boolean; contentRoot?: string },
): {
  site: string;
  updatedAt: number;
  totalCount: number;
  issues: RuntimeIssueRecord[];
} {
  const b = ensureLoadedSync(site, opts?.contentRoot);
  let issues = Object.values(b.state.issues);
  if (opts?.hideBots !== false) {
    issues = issues.filter((i) => !i.likelyBot);
  }
  issues.sort((a, b2) => {
    if (b2.count !== a.count) return b2.count - a.count;
    return b2.lastSeen - a.lastSeen;
  });
  const totalCount = issues.reduce((sum, i) => sum + i.count, 0);
  return {
    site,
    updatedAt: b.state.updatedAt,
    totalCount,
    issues,
  };
}

export async function shutdownRuntimeIssues(): Promise<void> {
  for (const site of bySite.keys()) {
    saveLocal(site);
  }
  if (!IS_PRODUCTION || !gcs.available) return;
  await gcs.flushPending();
  for (const [site, b] of bySite.entries()) {
    try {
      const content = JSON.stringify(b.state, null, 2);
      await gcs.upload(gcsKey(site), Buffer.from(content, "utf-8"), "application/json");
    } catch (err) {
      log.error({ err, site }, "runtime-issues shutdown upload failed");
    }
  }
}

/** Test helper */
export function _resetRuntimeIssuesForTests(): void {
  bySite.clear();
}
