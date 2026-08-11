import type { Express, Request, Response } from "express";
import http from "http";
import https from "https";
import { timingSafeEqual } from "crypto";
import { URL } from "url";
import { getOptimizationSettings, type IpnDestination } from "./settings";
import { child } from "./logger";

const log = child({ module: "ipn-proxy" });

/** Fixed mount path for IP Normalization egress proxy (not configurable). */
export const IPN_MOUNT_PATH = "/ipn/";

/** Header sGTM must send; stripped before forwarding to the destination. */
export const IPN_TOKEN_HEADER = "x-ipn-token";

/** In-memory test log — last N calls (bodies truncated for memory). */
export const IPN_RECENT_CALLS_LIMIT = 5;
export const IPN_BODY_LOG_MAX_CHARS = 8_192;

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
}

const recentCalls: IpnCallLogEntry[] = [];

function recordIpnCall(entry: Omit<IpnCallLogEntry, "at">): void {
  recentCalls.unshift({ ...entry, at: new Date().toISOString() });
  if (recentCalls.length > IPN_RECENT_CALLS_LIMIT) {
    recentCalls.length = IPN_RECENT_CALLS_LIMIT;
  }
}

export function getIpnRecentCalls(): IpnCallLogEntry[] {
  return [...recentCalls];
}

export function clearIpnRecentCalls(): void {
  recentCalls.length = 0;
}

/** @internal test helper */
export function __recordIpnCallForTest(entry: Omit<IpnCallLogEntry, "at">): void {
  recordIpnCall(entry);
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

/** Pick auth / content-type style headers for the test log (skips Cookie, Host, etc.). */
export function extractRelevantHeaders(req: Request): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (lower === "cookie" || lower === "cookie2" || lower === "set-cookie") continue;
    if (!RELEVANT_HEADER_EXACT.has(lower) && !RELEVANT_HEADER_RE.test(lower)) continue;
    const asString = headerValueAsString(value);
    if (asString) out[lower] = asString;
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
  app.use((req: Request, res: Response, next) => {
    if (!pathMatchesIpn(req.path)) {
      return next();
    }

    const method = req.method || "GET";
    const query = extractRequestQuery(req);
    const rawBodyPreview = extractRequestBodyPreview(req);
    const bodyPreview = bodyPreviewForLog(req, rawBodyPreview, query);
    const headersPreview = extractRelevantHeaders(req);
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
