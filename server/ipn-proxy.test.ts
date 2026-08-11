import { describe, expect, it } from "vitest";
import {
  IPN_MOUNT_PATH,
  ipnTokensMatch,
  parseIpnRequestPath,
  pathMatchesIpn,
  resolveIpnTarget,
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

describe("resolveIpnSecret", () => {
  it("reads IPN_SECRET from env only", async () => {
    const { resolveIpnSecret } = await import("./ipn-proxy");
    const prev = process.env.IPN_SECRET;
    process.env.IPN_SECRET = "env-ipn-secret";
    expect(resolveIpnSecret()).toEqual({ value: "env-ipn-secret", source: "env" });
    delete process.env.IPN_SECRET;
    expect(resolveIpnSecret()).toEqual({ value: "", source: "none" });
    process.env.IPN_SECRET = prev;
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

describe("ipn recent calls ring buffer", () => {
  it("keeps only the last 5 calls", async () => {
    const {
      clearIpnRecentCalls,
      getIpnRecentCalls,
      __recordIpnCallForTest,
      IPN_RECENT_CALLS_LIMIT,
    } = await import("./ipn-proxy");
    clearIpnRecentCalls();
    for (let i = 0; i < 7; i++) {
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
    expect(calls[0].path).toBe("/v6");
    expect(calls[0].bodyPreview).toBe('{"i":6}');
    expect(calls[4].path).toBe("/v2");
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
  it("keeps auth and content-type headers, skips cookie/host", async () => {
    const { extractRelevantHeaders } = await import("./ipn-proxy");
    const headers = extractRelevantHeaders({
      headers: {
        authorization: "Bearer secret-token",
        "api-key": "brevo-key",
        "content-type": "application/json",
        "x-ipn-token": "ipn-secret",
        cookie: "session=abc",
        host: "example.com",
        "user-agent": "test",
      },
    } as any);
    expect(headers).toEqual({
      authorization: "Bearer secret-token",
      "api-key": "brevo-key",
      "content-type": "application/json",
      "x-ipn-token": "ipn-secret",
    });
  });
});
