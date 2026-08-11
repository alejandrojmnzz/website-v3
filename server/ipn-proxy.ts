import type { Express, Request, Response } from "express";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { timingSafeEqual } from "crypto";
import { URL } from "url";
import { getDefaultContentRoot } from "./site-config";
import { getOptimizationSettings, type IpnDestination } from "./settings";
import { child } from "./logger";

const log = child({ module: "ipn-proxy" });

/** Fixed mount path for IP Normalization egress proxy (not configurable). */
export const IPN_MOUNT_PATH = "/ipn/";

/** Header sGTM must send; stripped before forwarding to the destination. */
export const IPN_TOKEN_HEADER = "x-ipn-token";

/** Persisted + in-memory ring buffer of recent IPN calls. */
export const IPN_RECENT_CALLS_LIMIT = 500;
export const IPN_BODY_LOG_MAX_CHARS = 8_192;
export const IPN_CALLS_STATE_FILENAME = ".ipn-calls-state.txt";
export const IPN_EGRESS_CACHE_TTL_MS = 5 * 60 * 1000;
const IPN_SAVE_DEBOUNCE_MS_DEFAULT = 2_000;

export type IpnCallOutcome =
  | "forwarded"
  | "unauthorized"
  | "not_found"
  | "unknown_destination"
  | "error"
  | "disabled";

export interface IpnCallLogEntry {
  at: string;
  method: string;
  destinationId: string | null;
  path: string;
  status: number;
  outcome: IpnCallOutcome;
  targetHost?: string;
  /** Raw query string including leading `?`, if any. */
  query?: string | null;
  /** Truncated request body preview for test debugging (may contain PII). */
  bodyPreview?: string | null;
  /** Allowlisted request headers (auth / content-type / IPN token, etc.). */
  headersPreview?: Record<string, string> | null;
  /** Public egress IP of this Node process (what the destination API should see). */
  egressIp?: string | null;
  /** Caller IP that hit /ipn/ (sGTM / proxy), not the Brevo allowlist IP. */
  callerIp?: string | null;
}

const recentCalls: IpnCallLogEntry[] = [];
let callsLoaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveDebounceMs = IPN_SAVE_DEBOUNCE_MS_DEFAULT;
let callsStatePathOverride: string | null = null;

type EgressFetchFn = () => Promise<string | null>;

let egressCache: { ip: string | null; fetchedAt: number } | null = null;
let egressRefreshInFlight: Promise<void> | null = null;
let egressFetchFn: EgressFetchFn = defaultEgressFetch;

async function defaultEgressFetch(): Promise<string | null> {
  const res = await fetch("https://api.ipify.org", {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;
  const text = (await res.text()).trim();
  if (!text || text.length > 64) return null;
  // IPv4 or IPv6 (rough)
  if (!/^[\d.:a-fA-F]+$/.test(text)) return null;
  return text;
}

function getIpnCallsStatePath(): string {
  if (callsStatePathOverride) return callsStatePathOverride;
  return path.join(getDefaultContentRoot(), IPN_CALLS_STATE_FILENAME);
}

function loadIpnCallsIfNeeded(): void {
  if (callsLoaded) return;
  callsLoaded = true;
  try {
    const filePath = getIpnCallsStatePath();
    if (!fs.existsSync(filePath)) {
      recentCalls.length = 0;
      return;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const entries: IpnCallLogEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as IpnCallLogEntry);
      } catch {
        // skip corrupt lines
      }
    }
    recentCalls.length = 0;
    recentCalls.push(...entries.slice(0, IPN_RECENT_CALLS_LIMIT));
  } catch (err) {
    log.warn({ err }, "[IPN Proxy] Failed to load call history");
    recentCalls.length = 0;
  }
}

function saveIpnCallsLocal(): void {
  try {
    const filePath = getIpnCallsStatePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (recentCalls.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    const content = recentCalls.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (err) {
    log.error({ err }, "[IPN Proxy] Failed to save call history");
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  if (saveDebounceMs <= 0) {
    saveIpnCallsLocal();
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveIpnCallsLocal();
  }, saveDebounceMs);
}

/** Kick a background refresh when cache is missing or stale; return current cached value (may be null). */
export function getCachedEgressIp(): string | null {
  const now = Date.now();
  const fresh =
    egressCache != null && now - egressCache.fetchedAt < IPN_EGRESS_CACHE_TTL_MS;
  if (!fresh) {
    void refreshEgressIpInBackground();
  }
  return egressCache?.ip ?? null;
}

function refreshEgressIpInBackground(): Promise<void> {
  if (egressRefreshInFlight) return egressRefreshInFlight;
  egressRefreshInFlight = (async () => {
    try {
      const ip = await egressFetchFn();
      egressCache = { ip, fetchedAt: Date.now() };
    } catch {
      egressCache = {
        ip: egressCache?.ip ?? null,
        fetchedAt: Date.now(),
      };
    } finally {
      egressRefreshInFlight = null;
    }
  })();
  return egressRefreshInFlight;
}

export function extractCallerIp(req: Request): string | null {
  const raw = req.ip || req.socket?.remoteAddress || null;
  if (!raw) return null;
  return raw.length > 128 ? `${raw.slice(0, 128)}…` : raw;
}

function recordIpnCall(entry: Omit<IpnCallLogEntry, "at">): void {
  loadIpnCallsIfNeeded();
  let egressIp: string | null = entry.egressIp !== undefined ? entry.egressIp : null;
  if (entry.targetHost && entry.egressIp === undefined) {
    egressIp = getCachedEgressIp();
  }

  recentCalls.unshift({
    ...entry,
    at: new Date().toISOString(),
    egressIp,
  });
  if (recentCalls.length > IPN_RECENT_CALLS_LIMIT) {
    recentCalls.length = IPN_RECENT_CALLS_LIMIT;
  }
  scheduleSave();
}

export function getIpnRecentCalls(): IpnCallLogEntry[] {
  loadIpnCallsIfNeeded();
  return [...recentCalls];
}

export function clearIpnRecentCalls(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  recentCalls.length = 0;
  callsLoaded = true;
  saveIpnCallsLocal();
}

/** @internal test helper */
export function __recordIpnCallForTest(entry: Omit<IpnCallLogEntry, "at">): void {
  recordIpnCall(entry);
}

/** @internal test helper — override state file path; resets memory load flag. */
export function __setIpnCallsStatePathForTest(filePath: string | null): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  callsStatePathOverride = filePath;
  recentCalls.length = 0;
  callsLoaded = false;
}

/** @internal test helper */
export function __setIpnSaveDebounceMsForTest(ms: number): void {
  saveDebounceMs = ms;
}

/** @internal test helper — drop in-memory state so next get/load reloads from disk. */
export function __resetIpnCallsMemoryForTest(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  recentCalls.length = 0;
  callsLoaded = false;
}

/** @internal test helper */
export function __flushIpnCallsSaveForTest(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveIpnCallsLocal();
}

/** @internal test helper */
export function __setEgressFetchForTest(fn: EgressFetchFn | null): void {
  egressFetchFn = fn ?? defaultEgressFetch;
}

/** @internal test helper */
export function __clearEgressCacheForTest(): void {
  egressCache = null;
  egressRefreshInFlight = null;
}

/** @internal test helper — wait for in-flight egress refresh */
export async function __awaitEgressRefreshForTest(): Promise<void> {
  if (egressRefreshInFlight) await egressRefreshInFlight;
  else await refreshEgressIpInBackground();
}

export function extractRequestBodyPreview(req: Request): string | null {
  const raw = (req as any).rawBody;
  if (Buffer.isBuffer(raw) && raw.length > 0) {
    const text = raw.toString("utf-8");
    return text.length > IPN_BODY_LOG_MAX_CHARS
      ? `${text.slice(0, IPN_BODY_LOG_MAX_CHARS)}…[truncated]`
      : text;
  }
  if (req.body != null && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    try {
      const text = JSON.stringify(req.body, null, 2);
      return text.length > IPN_BODY_LOG_MAX_CHARS
        ? `${text.slice(0, IPN_BODY_LOG_MAX_CHARS)}…[truncated]`
        : text;
    } catch {
      return "[unserializable body]";
    }
  }
  if (typeof req.body === "string" && req.body.length > 0) {
    return req.body.length > IPN_BODY_LOG_MAX_CHARS
      ? `${req.body.slice(0, IPN_BODY_LOG_MAX_CHARS)}…[truncated]`
      : req.body;
  }
  return null;
}

/** Returns `?foo=bar` from originalUrl, or null. */
export function extractRequestQuery(req: Request): string | null {
  const url = req.originalUrl || "";
  const q = url.indexOf("?");
  if (q === -1) return null;
  const qs = url.slice(q);
  return qs.length > 1 ? qs : null;
}

/** For GET (and other empty-body requests), surface query params in the body preview slot. */
export function bodyPreviewForLog(req: Request, bodyPreview: string | null, query: string | null): string | null {
  if (bodyPreview) return bodyPreview;
  if (query && (req.method || "GET").toUpperCase() === "GET") {
    return query;
  }
  return null;
}

const RELEVANT_HEADER_EXACT = new Set([
  "authorization",
  "api-key",
  "x-api-key",
  "sib-authorized", // Brevo alias sometimes seen
  "content-type",
  "accept",
  "x-ipn-token",
  "x-requested-with",
]);

const RELEVANT_HEADER_RE = /^(x-)?(api[-_]?key|auth|access[-_]?token|bearer)/i;

function headerValueAsString(value: string | string[] | undefined): string | null {
  if (value == null) return null;
  const raw = Array.isArray(value) ? value.join(", ") : value;
  if (!raw) return null;
  return raw.length > 256 ? `${raw.slice(0, 256)}…[truncated]` : raw;
}

/** Log preview: keep only the last N characters; mask the rest with bullets (e.g. `••••b7a3`). */
export function redactSecretTail(value: string, tailChars: number = 4): string {
  if (!value) return "••••";
  if (value.length <= tailChars) return "••••";
  return `••••${value.slice(-tailChars)}`;
}

const HEADERS_REDACT_TAIL = new Set([
  "x-ipn-token",
  "authorization",
  "api-key",
  "x-api-key",
  "sib-authorized",
]);

/** Pick auth / content-type style headers for the test log (skips Cookie, Host, etc.). */
export function extractRelevantHeaders(req: Request): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (lower === "cookie" || lower === "cookie2" || lower === "set-cookie") continue;
    if (!RELEVANT_HEADER_EXACT.has(lower) && !RELEVANT_HEADER_RE.test(lower)) continue;
    let asString = headerValueAsString(value);
    if (!asString) continue;
    if (HEADERS_REDACT_TAIL.has(lower) || RELEVANT_HEADER_RE.test(lower)) {
      asString = redactSecretTail(asString);
    }
    out[lower] = asString;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const agentsByHost = new Map<string, http.Agent | https.Agent>();

function getAgent(targetBase: string): http.Agent | https.Agent {
  const existing = agentsByHost.get(targetBase);
  if (existing) return existing;
  const isHttps = targetBase.startsWith("https://");
  const agent = isHttps
    ? new https.Agent({ keepAlive: true, maxSockets: 50 })
    : new http.Agent({ keepAlive: true, maxSockets: 50 });
  agentsByHost.set(targetBase, agent);
  return agent;
}

export function pathMatchesIpn(reqPath: string, mountPath: string = IPN_MOUNT_PATH): boolean {
  return reqPath === mountPath.slice(0, -1) || reqPath.startsWith(mountPath);
}

/**
 * Parse `/ipn/{id}/rest...` into destination id + remainder path (always starts with `/` or is `/`).
 * Returns null when path has no destination id (bare `/ipn` or `/ipn/`).
 */
export function parseIpnRequestPath(
  reqPath: string,
  mountPath: string = IPN_MOUNT_PATH,
): { id: string; remainder: string } | null {
  if (!pathMatchesIpn(reqPath, mountPath)) return null;
  if (reqPath === mountPath.slice(0, -1) || reqPath === mountPath) {
    return null;
  }
  const after = reqPath.slice(mountPath.length);
  const slash = after.indexOf("/");
  const id = slash === -1 ? after : after.slice(0, slash);
  if (!id) return null;
  const remainder = slash === -1 ? "/" : after.slice(slash) || "/";
  return { id, remainder };
}

export function resolveIpnTarget(
  dest: IpnDestination,
  remainder: string,
): { targetUrl: string; parsed: URL } {
  const base = dest.base_url.replace(/\/$/, "");
  const pathPart = remainder.startsWith("/") ? remainder : `/${remainder}`;
  const targetUrl = `${base}${pathPart}`;
  const parsed = new URL(targetUrl);
  return { targetUrl, parsed };
}

export function ipnTokensMatch(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Shared secret for X-IPN-Token — host env only (never settings.yml). */
export function resolveIpnSecret(): { value: string; source: "env" | "none" } {
  const fromEnv = process.env.IPN_SECRET?.trim() || "";
  if (fromEnv) return { value: fromEnv, source: "env" };
  return { value: "", source: "none" };
}

export function registerIpnProxy(app: Express): void {
  // Warm egress IP cache so early forwards can log it
  void refreshEgressIpInBackground();

  app.use((req: Request, res: Response, next) => {
    if (!pathMatchesIpn(req.path)) {
      return next();
    }

    const method = req.method || "GET";
    const query = extractRequestQuery(req);
    const rawBodyPreview = extractRequestBodyPreview(req);
    const bodyPreview = bodyPreviewForLog(req, rawBodyPreview, query);
    const headersPreview = extractRelevantHeaders(req);
    const callerIp = extractCallerIp(req);
    const ipn = getOptimizationSettings().ip_normalization;
    const secret = resolveIpnSecret().value;

    if (!ipn.enabled) {
      recordIpnCall({
        method,
        destinationId: null,
        path: req.path,
        status: 404,
        outcome: "disabled",
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      return res.status(404).json({ error: "Not found" });
    }

    if (!secret) {
      log.warn("[IPN Proxy] Enabled but IPN_SECRET is empty — fail closed");
      recordIpnCall({
        method,
        destinationId: null,
        path: req.path,
        status: 401,
        outcome: "unauthorized",
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      return res.status(401).json({ error: "Unauthorized" });
    }

    const headerVal = req.headers[IPN_TOKEN_HEADER];
    const token = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!ipnTokensMatch(token, secret)) {
      recordIpnCall({
        method,
        destinationId: null,
        path: req.path,
        status: 401,
        outcome: "unauthorized",
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsedPath = parseIpnRequestPath(req.path);
    if (!parsedPath) {
      recordIpnCall({
        method,
        destinationId: null,
        path: req.path,
        status: 404,
        outcome: "not_found",
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      return res.status(404).json({ error: "Not found" });
    }

    const dest = ipn.destinations.find((d) => d.id === parsedPath.id);
    if (!dest) {
      recordIpnCall({
        method,
        destinationId: parsedPath.id,
        path: parsedPath.remainder,
        status: 404,
        outcome: "unknown_destination",
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      return res.status(404).json({ error: "Unknown destination" });
    }

    let targetUrl: string;
    let parsedTarget: URL;
    try {
      ({ targetUrl, parsed: parsedTarget } = resolveIpnTarget(dest, parsedPath.remainder));
    } catch (err) {
      log.warn({ err, id: dest.id }, "[IPN Proxy] Invalid target URL");
      recordIpnCall({
        method,
        destinationId: dest.id,
        path: parsedPath.remainder,
        status: 502,
        outcome: "error",
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      return res.status(502).json({ error: "Invalid destination URL" });
    }

    if (parsedTarget.protocol !== "https:") {
      recordIpnCall({
        method,
        destinationId: dest.id,
        path: parsedPath.remainder,
        status: 502,
        outcome: "error",
        targetHost: parsedTarget.host,
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      return res.status(502).json({ error: "Destination must be https" });
    }

    const agent = getAgent(dest.base_url);
    const qs = query || "";
    const targetPath = parsedTarget.pathname + qs;

    const headers: http.OutgoingHttpHeaders = {
      ...req.headers,
      host: parsedTarget.host,
      "x-forwarded-for": req.ip || req.socket?.remoteAddress || "",
      "x-forwarded-proto": "https",
      "x-forwarded-host": req.hostname,
    };
    delete headers["transfer-encoding"];
    delete headers["connection"];
    delete headers[IPN_TOKEN_HEADER];
    delete headers["X-IPN-Token"];

    const options: http.RequestOptions = {
      agent,
      hostname: parsedTarget.hostname,
      port: parsedTarget.port || 443,
      path: targetPath,
      method: req.method,
      headers,
    };

    const proxyReq = https.request(options, (proxyRes) => {
      const status = proxyRes.statusCode ?? 502;
      log.info(
        { destination: dest.id, status, method: req.method, path: parsedPath.remainder },
        "[IPN Proxy] Forwarded",
      );
      recordIpnCall({
        method,
        destinationId: dest.id,
        path: parsedPath.remainder,
        status,
        outcome: "forwarded",
        targetHost: parsedTarget.host,
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      res.writeHead(status, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", (err) => {
      log.error({ err, targetUrl, destination: dest.id }, "[IPN Proxy] Error proxying");
      recordIpnCall({
        method,
        destinationId: dest.id,
        path: parsedPath.remainder,
        status: 502,
        outcome: "error",
        targetHost: parsedTarget.host,
        query,
        bodyPreview,
        headersPreview,
        callerIp,
      });
      if (!res.headersSent) {
        res.status(502).json({ error: "Destination unavailable" });
      }
    });

    const raw = (req as any).rawBody;
    if (Buffer.isBuffer(raw) && raw.length > 0) {
      proxyReq.end(raw);
    } else if (req.body && ["POST", "PUT", "PATCH"].includes(req.method)) {
      const body = Buffer.from(JSON.stringify(req.body));
      proxyReq.end(body);
    } else {
      req.pipe(proxyReq, { end: true });
    }
  });

  log.info("[IPN Proxy] Middleware registered at %s (dynamic — reads config per request)", IPN_MOUNT_PATH);
}
