import { describe, expect, it } from "vitest";
import {
  bucketUserAgent,
  fingerprintNotFound,
  localeFromPath,
  normalizeRuntimePath,
  pruneRuntimeIssuesState,
  shouldHardDropNotFound,
  stripReferrerQuery,
  emptyRuntimeIssuesState,
  MAX_ISSUES_PER_SITE,
} from "./runtime-issues";

describe("normalizeRuntimePath", () => {
  it("strips query and hash and trailing slash", () => {
    expect(normalizeRuntimePath("/foo/bar/?utm=1#x")).toBe("/foo/bar");
    expect(normalizeRuntimePath("https://example.com/us/page/")).toBe("/us/page");
  });

  it("keeps root slash", () => {
    expect(normalizeRuntimePath("/")).toBe("/");
  });
});

describe("localeFromPath", () => {
  it("reads two-letter prefix", () => {
    expect(localeFromPath("/es/coding")).toBe("es");
    expect(localeFromPath("/en/coding")).toBe("en");
    expect(localeFromPath("/coding")).toBe("en");
  });
});

describe("fingerprintNotFound", () => {
  it("includes site locale and path", () => {
    expect(fingerprintNotFound("site_4geeks-com", "es", "/es/foo/")).toBe(
      "http.not_found|site_4geeks-com|es|/es/foo",
    );
  });
});

describe("stripReferrerQuery", () => {
  it("removes query from absolute URLs", () => {
    expect(stripReferrerQuery("https://x.com/a?b=1")).toBe("https://x.com/a");
  });
});

describe("bots", () => {
  it("hard-drops probe paths and bot UAs", () => {
    expect(shouldHardDropNotFound("/.env", "Mozilla")).toBe(true);
    expect(shouldHardDropNotFound("/wp-admin/foo", "Mozilla")).toBe(true);
    expect(shouldHardDropNotFound("/us/missing", "Googlebot/2.1")).toBe(true);
    expect(shouldHardDropNotFound("/us/missing", "Mozilla/5.0")).toBe(false);
  });

  it("buckets UA", () => {
    expect(bucketUserAgent("Googlebot")).toBe("bot");
    expect(bucketUserAgent("Mozilla/5.0 (iPhone)")).toBe("mobile");
  });
});

describe("pruneRuntimeIssuesState", () => {
  it("drops old and caps size", () => {
    const state = emptyRuntimeIssuesState();
    const now = Date.now();
    for (let i = 0; i < MAX_ISSUES_PER_SITE + 10; i++) {
      const fp = `http.not_found|s|en|/p${i}`;
      state.issues[fp] = {
        fingerprint: fp,
        kind: "http.not_found",
        path: `/p${i}`,
        locale: "en",
        count: i,
        firstSeen: now,
        lastSeen: now,
      };
    }
    const oldFp = "http.not_found|s|en|/old";
    state.issues[oldFp] = {
      fingerprint: oldFp,
      kind: "http.not_found",
      path: "/old",
      locale: "en",
      count: 9999,
      firstSeen: 1,
      lastSeen: 1,
    };
    const pruned = pruneRuntimeIssuesState(state, now);
    expect(Object.keys(pruned.issues).length).toBeLessThanOrEqual(MAX_ISSUES_PER_SITE);
    expect(pruned.issues[oldFp]).toBeUndefined();
  });
});
