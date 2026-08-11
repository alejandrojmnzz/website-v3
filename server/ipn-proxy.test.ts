import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IPN_MOUNT_PATH,
  IPN_RECENT_CALLS_LIMIT,
  getCachedEgressIp,
  ipnTokensMatch,
  parseIpnRequestPath,
  pathMatchesIpn,
  resolveIpnTarget,
  __awaitEgressRefreshForTest,
  __clearEgressCacheForTest,
  __flushIpnCallsSaveForTest,
  __recordIpnCallForTest,
  __resetIpnCallsMemoryForTest,
  __setEgressFetchForTest,
  __setIpnCallsStatePathForTest,
  __setIpnSaveDebounceMsForTest,
  clearIpnRecentCalls,
  getIpnRecentCalls,
} from "./ipn-proxy";
import {
  isBlockedIpnHostname,
  normalizeIpnBaseUrl,
  validateIpnDestination,
} from "./settings";

describe("ipn-proxy path helpers", () => {
  it("matches /ipn and nested paths", () => {
    expect(pathMatchesIpn("/ipn")).toBe(true);
    expect(pathMatchesIpn("/ipn/")).toBe(true);
    expect(pathMatchesIpn("/ipn/crm")).toBe(true);
    expect(pathMatchesIpn("/ipn/crm/v3/contacts")).toBe(true);
    expect(pathMatchesIpn("/api/ipn")).toBe(false);
    expect(pathMatchesIpn("/sgtm/")).toBe(false);
  });

  it("parses destination id and remainder", () => {
    expect(parseIpnRequestPath("/ipn")).toBeNull();
    expect(parseIpnRequestPath("/ipn/")).toBeNull();
    expect(parseIpnRequestPath("/ipn/crm")).toEqual({ id: "crm", remainder: "/" });
    expect(parseIpnRequestPath("/ipn/crm/")).toEqual({ id: "crm", remainder: "/" });
    expect(parseIpnRequestPath("/ipn/crm/v3/contacts")).toEqual({
      id: "crm",
      remainder: "/v3/contacts",
    });
  });

  it("resolves target URL from destination + remainder", () => {
    const { targetUrl, parsed } = resolveIpnTarget(
      { id: "crm", base_url: "https://api.brevo.com" },
      "/v3/contacts",
    );
    expect(targetUrl).toBe("https://api.brevo.com/v3/contacts");
    expect(parsed.hostname).toBe("api.brevo.com");
    expect(parsed.pathname).toBe("/v3/contacts");
  });

  it("preserves base_url path prefix", () => {
    const { targetUrl } = resolveIpnTarget(
      { id: "crm", base_url: "https://api.example.com/v3" },
      "/contacts",
    );
    expect(targetUrl).toBe("https://api.example.com/v3/contacts");
  });
});

describe("ipnTokensMatch", () => {
  it("accepts matching secrets", () => {
    expect(ipnTokensMatch("abc123", "abc123")).toBe(true);
  });

  it("rejects missing, empty, or mismatched secrets", () => {
    expect(ipnTokensMatch(undefined, "abc")).toBe(false);
    expect(ipnTokensMatch("", "abc")).toBe(false);
    expect(ipnTokensMatch("abc", "")).toBe(false);
    expect(ipnTokensMatch("abc", "abd")).toBe(false);
    expect(ipnTokensMatch("short", "longer")).toBe(false);
  });
});

describe("ipn destination validation", () => {
  it("normalizes https base URLs and strips trailing slash", () => {
    expect(normalizeIpnBaseUrl("https://api.brevo.com/")).toBe("https://api.brevo.com");
    expect(normalizeIpnBaseUrl("https://api.example.com/v3/")).toBe("https://api.example.com/v3");
  });

  it("rejects non-https, query, hash, and private hosts", () => {
    expect(() => normalizeIpnBaseUrl("http://api.brevo.com")).toThrow(/https/);
    expect(() => normalizeIpnBaseUrl("https://api.brevo.com?x=1")).toThrow(/query/);
    expect(() => normalizeIpnBaseUrl("https://api.brevo.com#frag")).toThrow(/hash/);
    expect(() => normalizeIpnBaseUrl("https://localhost/api")).toThrow(/not allowed/);
    expect(() => normalizeIpnBaseUrl("https://127.0.0.1/")).toThrow(/not allowed/);
    expect(() => normalizeIpnBaseUrl("https://192.168.1.1/")).toThrow(/not allowed/);
  });

  it("blocks private hostnames", () => {
    expect(isBlockedIpnHostname("localhost")).toBe(true);
    expect(isBlockedIpnHostname("10.0.0.1")).toBe(true);
    expect(isBlockedIpnHostname("api.brevo.com")).toBe(false);
  });

  it("validates destination ids", () => {
    expect(validateIpnDestination({ id: "crm", base_url: "https://api.brevo.com" })).toEqual({
      id: "crm",
      base_url: "https://api.brevo.com",
    });
    expect(() => validateIpnDestination({ id: "CRM", base_url: "https://api.brevo.com" })).toThrow(
      /Invalid destination id/,
    );
    expect(() => validateIpnDestination({ id: "", base_url: "https://api.brevo.com" })).toThrow();
  });

  it("exposes fixed mount path", () => {
    expect(IPN_MOUNT_PATH).toBe("/ipn/");
  });
});

describe("ipn recent calls ring buffer + persistence", () => {
  let tmpFile: string;

  afterEach(() => {
    clearIpnRecentCalls();
    __setIpnCallsStatePathForTest(null);
    __setIpnSaveDebounceMsForTest(2000);
    __setEgressFetchForTest(null);
    __clearEgressCacheForTest();
    if (tmpFile && fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
    }
  });

  it("keeps only the last IPN_RECENT_CALLS_LIMIT calls", () => {
    tmpFile = path.join(os.tmpdir(), `ipn-calls-trim-${Date.now()}.txt`);
    __setIpnCallsStatePathForTest(tmpFile);
    __setIpnSaveDebounceMsForTest(0);
    clearIpnRecentCalls();

    const extra = 3;
    for (let i = 0; i < IPN_RECENT_CALLS_LIMIT + extra; i++) {
      __recordIpnCallForTest({
        method: "POST",
        destinationId: "crm",
        path: `/v${i}`,
        status: 200,
        outcome: "forwarded",
        bodyPreview: `{"i":${i}}`,
      });
    }
    const calls = getIpnRecentCalls();
    expect(calls).toHaveLength(IPN_RECENT_CALLS_LIMIT);
    const last = IPN_RECENT_CALLS_LIMIT + extra - 1;
    expect(calls[0].path).toBe(`/v${last}`);
    expect(calls[0].bodyPreview).toBe(`{"i":${last}}`);
    expect(calls[IPN_RECENT_CALLS_LIMIT - 1].path).toBe(`/v${extra}`);
  });

  it("persists to disk and reloads after memory reset", () => {
    tmpFile = path.join(os.tmpdir(), `ipn-calls-persist-${Date.now()}.txt`);
    __setIpnCallsStatePathForTest(tmpFile);
    __setIpnSaveDebounceMsForTest(0);
    clearIpnRecentCalls();

    __recordIpnCallForTest({
      method: "POST",
      destinationId: "crm",
      path: "/v3/events",
      status: 200,
      outcome: "forwarded",
      targetHost: "api.brevo.com",
      egressIp: "203.0.113.10",
      callerIp: "198.51.100.1",
    });
    __flushIpnCallsSaveForTest();
    expect(fs.existsSync(tmpFile)).toBe(true);

    __resetIpnCallsMemoryForTest();
    const calls = getIpnRecentCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v3/events");
    expect(calls[0].targetHost).toBe("api.brevo.com");
    expect(calls[0].egressIp).toBe("203.0.113.10");
    expect(calls[0].callerIp).toBe("198.51.100.1");
  });

  it("clear removes the state file", () => {
    tmpFile = path.join(os.tmpdir(), `ipn-calls-clear-${Date.now()}.txt`);
    __setIpnCallsStatePathForTest(tmpFile);
    __setIpnSaveDebounceMsForTest(0);
    clearIpnRecentCalls();

    __recordIpnCallForTest({
      method: "GET",
      destinationId: "crm",
      path: "/",
      status: 200,
      outcome: "forwarded",
    });
    expect(fs.existsSync(tmpFile)).toBe(true);
    clearIpnRecentCalls();
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(getIpnRecentCalls()).toHaveLength(0);
  });
});

describe("ipn egress cache", () => {
  afterEach(() => {
    __setEgressFetchForTest(null);
    __clearEgressCacheForTest();
  });

  it("returns cached egress IP after successful refresh", async () => {
    __clearEgressCacheForTest();
    __setEgressFetchForTest(async () => "203.0.113.55");
    expect(getCachedEgressIp()).toBeNull();
    await __awaitEgressRefreshForTest();
    expect(getCachedEgressIp()).toBe("203.0.113.55");
  });

  it("leaves egress null when fetch fails without throwing", async () => {
    __clearEgressCacheForTest();
    __setEgressFetchForTest(async () => {
      throw new Error("network down");
    });
    expect(getCachedEgressIp()).toBeNull();
    await __awaitEgressRefreshForTest();
    expect(getCachedEgressIp()).toBeNull();
  });

  it("attaches cached egress when recording a call with targetHost", async () => {
    const tmpFile = path.join(os.tmpdir(), `ipn-calls-egress-${Date.now()}.txt`);
    __setIpnCallsStatePathForTest(tmpFile);
    __setIpnSaveDebounceMsForTest(0);
    clearIpnRecentCalls();
    __clearEgressCacheForTest();
    __setEgressFetchForTest(async () => "198.51.100.99");
    await __awaitEgressRefreshForTest();

    __recordIpnCallForTest({
      method: "POST",
      destinationId: "crm",
      path: "/v3/events",
      status: 200,
      outcome: "forwarded",
      targetHost: "api.brevo.com",
    });
    const calls = getIpnRecentCalls();
    expect(calls[0].egressIp).toBe("198.51.100.99");

    clearIpnRecentCalls();
    __setIpnCallsStatePathForTest(null);
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });
});

describe("extractRequestBodyPreview", () => {
  it("reads rawBody and truncates long bodies", async () => {
    const { extractRequestBodyPreview, IPN_BODY_LOG_MAX_CHARS } = await import("./ipn-proxy");
    const short = extractRequestBodyPreview({
      rawBody: Buffer.from('{"ok":true}'),
      body: {},
    } as any);
    expect(short).toBe('{"ok":true}');

    const big = "x".repeat(IPN_BODY_LOG_MAX_CHARS + 10);
    const truncated = extractRequestBodyPreview({
      rawBody: Buffer.from(big),
      body: {},
    } as any);
    expect(truncated?.endsWith("…[truncated]")).toBe(true);
    expect(truncated!.length).toBe(IPN_BODY_LOG_MAX_CHARS + "…[truncated]".length);
  });
});

describe("extractRequestQuery / bodyPreviewForLog", () => {
  it("captures query string and uses it as GET body preview", async () => {
    const { extractRequestQuery, bodyPreviewForLog } = await import("./ipn-proxy");
    const req = {
      method: "GET",
      originalUrl: "/ipn/crm/v3/contacts?email=a%40b.com&limit=10",
      path: "/ipn/crm/v3/contacts",
    } as any;
    expect(extractRequestQuery(req)).toBe("?email=a%40b.com&limit=10");
    expect(bodyPreviewForLog(req, null, "?email=a%40b.com&limit=10")).toBe(
      "?email=a%40b.com&limit=10",
    );
    expect(bodyPreviewForLog({ method: "POST" } as any, null, "?x=1")).toBeNull();
    expect(bodyPreviewForLog(req, '{"a":1}', "?x=1")).toBe('{"a":1}');
  });
});

describe("extractRelevantHeaders", () => {
  it("keeps auth and content-type headers, skips cookie/host, redacts secrets to last 4 chars", async () => {
    const { extractRelevantHeaders, redactSecretTail } = await import("./ipn-proxy");
    expect(redactSecretTail("2f1ec13b74f52450")).toBe("••••2450");
    expect(redactSecretTail("ab")).toBe("••••");

    const headers = extractRelevantHeaders({
      headers: {
        authorization: "Bearer secret-token",
        "api-key": "brevo-key",
        "content-type": "application/json",
        "x-ipn-token": "2f1ec13b74f524503a4af0530278eab0",
        cookie: "session=abc",
        host: "example.com",
        "user-agent": "test",
      },
    } as any);
    expect(headers).toEqual({
      authorization: "••••oken",
      "api-key": "••••-key",
      "content-type": "application/json",
      "x-ipn-token": "••••eab0",
    });
  });
});
