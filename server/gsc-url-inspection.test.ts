import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { DebugSitemapUrl } from "./sitemap";
import {
  MAX_INSPECT_URLS,
  assertInspectBatch,
  buildSummary,
  getGscConfig,
  getRecord,
  gscPropertyAccessFromRecords,
  hasMainSeoKeyword,
  inspectAndStore,
  isFresh,
  isGscPropertyAccessDenied,
  isIndexed,
  isPreviewLoc,
  mapInspectPayload,
  mergeInspectError,
  mergeInspectSuccess,
  resetGscInspectionMemory,
  resolveGscCredentials,
  resolvePublicInspectLoc,
  setGscCacheRootForTests,
  sidecarPath,
  suggestedGscSiteUrl,
  upsertRecord,
} from "./gsc-url-inspection";
import { resetSettings } from "./settings";

function url(partial: Partial<DebugSitemapUrl> & { loc: string }): DebugSitemapUrl {
  return {
    inSitemap: true,
    ...partial,
  };
}

describe("gsc-url-inspection", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-insp-"));
    setGscCacheRootForTests(tmp);
    resetGscInspectionMemory();
  });

  afterEach(() => {
    setGscCacheRootForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes and reads a sidecar atomically", () => {
    const loc = "https://example.com/us/blog/foo";
    const rec = { inspectedAt: "2026-08-15T12:00:00.000Z", verdict: "PASS" };
    upsertRecord("site_demo", loc, rec);
    expect(fs.existsSync(sidecarPath("site_demo"))).toBe(true);
    resetGscInspectionMemory();
    expect(getRecord("site_demo", loc)).toEqual(rec);
  });

  it("starts empty when the sidecar file is missing", () => {
    expect(getRecord("site_demo", "https://example.com/x")).toBeUndefined();
  });

  it("maps a GSC inspect payload", () => {
    const mapped = mapInspectPayload({
      inspectionResult: {
        indexStatusResult: {
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          lastCrawlTime: "2026-08-01T00:00:00Z",
          googleCanonical: "https://example.com/us/blog/foo",
          userCanonical: "https://example.com/us/blog/foo",
        },
      },
    });
    expect(mapped.verdict).toBe("PASS");
    expect(mapped.coverageState).toBe("Submitted and indexed");
    expect(isIndexed({ inspectedAt: "x", ...mapped })).toBe(true);
  });

  it("keeps last good coverage when an inspect errors", () => {
    const prev = mergeInspectSuccess(
      undefined,
      { verdict: "PASS", coverageState: "Submitted and indexed" },
      "2026-08-14T00:00:00.000Z",
    );
    const failed = mergeInspectError(prev, "quota", "2026-08-15T00:00:00.000Z");
    expect(failed.verdict).toBe("PASS");
    expect(failed.error).toBe("quota");
    expect(failed.inspectedAt).toBe("2026-08-14T00:00:00.000Z");
  });

  it("treats records newer than 1h as fresh", () => {
    const now = Date.parse("2026-08-15T12:00:00.000Z");
    expect(isFresh({ inspectedAt: "2026-08-15T11:30:00.000Z" }, now)).toBe(true);
    expect(isFresh({ inspectedAt: "2026-08-15T10:00:00.000Z" }, now)).toBe(false);
  });

  it("rejects batches over the cap", () => {
    expect(assertInspectBatch([])).toMatch(/non-empty/);
    expect(assertInspectBatch(Array.from({ length: MAX_INSPECT_URLS + 1 }, (_, i) => `https://x/${i}`))).toMatch(
      /At most 10/,
    );
    expect(assertInspectBatch(["https://x/1"])).toBeNull();
  });

  it("resolves preview URLs to the public sitemap loc", () => {
    const debug: DebugSitemapUrl[] = [
      url({
        loc: "https://example.com/private/preview/blog/foo?locale=en",
        content_type: "blog",
        slug: "foo",
        locale: "en",
        inSitemap: false,
        isDraft: true,
      }),
      url({
        loc: "https://example.com/us/blog/foo",
        content_type: "blog",
        slug: "foo",
        locale: "en",
        inSitemap: true,
      }),
    ];
    expect(isPreviewLoc(debug[0].loc)).toBe(true);
    const resolved = resolvePublicInspectLoc(debug[0].loc, debug);
    expect(resolved.loc).toBe("https://example.com/us/blog/foo");
    expect(resolved.isDraft).toBe(false);
    expect(resolved.inSitemap).toBe(true);
  });

  it("refuses draft-only preview URLs", () => {
    const debug: DebugSitemapUrl[] = [
      url({
        loc: "https://example.com/private/preview/blog/foo?locale=en",
        content_type: "blog",
        slug: "foo",
        locale: "en",
        inSitemap: false,
        isDraft: true,
      }),
    ];
    const resolved = resolvePublicInspectLoc(debug[0].loc, debug);
    expect(resolved.loc).toBeNull();
    expect(resolved.isDraft).toBe(true);
  });

  it("builds coverage summary without mixing never-checked into not-indexed", () => {
    const debug: DebugSitemapUrl[] = [
      url({ loc: "https://example.com/", inSitemap: true, content_type: "page", slug: "home" }),
      url({ loc: "https://example.com/us/blog/a", inSitemap: true, content_type: "blog", slug: "a" }),
      url({ loc: "https://example.com/us/blog/b", inSitemap: true, content_type: "blog", slug: "b" }),
      url({
        loc: "https://example.com/us/hidden",
        inSitemap: false,
        content_type: "page",
        slug: "hidden",
      }),
    ];
    const records = {
      "https://example.com/": {
        inspectedAt: "2026-08-15T00:00:00.000Z",
        verdict: "PASS",
      },
      "https://example.com/us/blog/a": {
        inspectedAt: "2026-08-15T00:00:00.000Z",
        verdict: "FAIL",
        coverageState: "Crawled - currently not indexed",
      },
    };
    const summary = buildSummary(records, debug);
    expect(summary.sitemapCount).toBe(3);
    expect(summary.inspected).toBe(2);
    expect(summary.indexed).toBe(1);
    expect(summary.notIndexed).toBe(1);
    expect(summary.neverChecked).toBe(1);
    expect(summary.notOnSitemap).toBe(1);
    expect(summary.byContentType.blog.inSitemap).toBe(2);
    expect(summary.byContentType.blog.neverChecked).toBe(1);
    expect(summary.exceptions.notIndexed[0].loc).toBe("https://example.com/us/blog/a");
  });

  it("skips fresh URLs unless force is set", async () => {
    const contentRoot = path.join(tmp, "content");
    fs.mkdirSync(contentRoot, { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "settings.yml"),
      "search_console:\n  site_url: https://example.com/\n",
      "utf-8",
    );
    resetSettings(contentRoot);
    process.env.GSC_CREDENTIALS_JSON = JSON.stringify({
      client_email: "sa@example.com",
      private_key: "x",
    });
    const loc = "https://example.com/us/blog/foo";
    upsertRecord("site_demo", loc, {
      inspectedAt: "2026-08-15T11:30:00.000Z",
      verdict: "PASS",
    });
    const debug = [url({ loc, content_type: "blog", slug: "foo", locale: "en" })];
    let calls = 0;
    const skipped = await inspectAndStore({
      contentRootName: "site_demo",
      contentRoot,
      urls: [loc],
      debugUrls: debug,
      now: Date.parse("2026-08-15T12:00:00.000Z"),
      inspectFn: async () => {
        calls += 1;
        return {};
      },
    });
    expect(skipped[0].skipped).toBe(true);
    expect(calls).toBe(0);

    const forced = await inspectAndStore({
      contentRootName: "site_demo",
      contentRoot,
      urls: [loc],
      force: true,
      debugUrls: debug,
      now: Date.parse("2026-08-15T12:00:00.000Z"),
      inspectFn: async () => {
        calls += 1;
        return {
          inspectionResult: { indexStatusResult: { verdict: "NEUTRAL" } },
        };
      },
    });
    expect(forced[0].skipped).toBeUndefined();
    expect(forced[0].record?.verdict).toBe("NEUTRAL");
    expect(calls).toBe(1);
    delete process.env.GSC_CREDENTIALS_JSON;
    resetSettings(contentRoot);
  });

  it("does not treat credentials alone as configured", () => {
    const contentRoot = path.join(tmp, "content");
    fs.mkdirSync(contentRoot, { recursive: true });
    fs.writeFileSync(path.join(contentRoot, "settings.yml"), "i18n: {}\n", "utf-8");
    resetSettings(contentRoot);
    process.env.GSC_CREDENTIALS_JSON = JSON.stringify({
      client_email: "sa@example.com",
      private_key: "x",
    });
    const cfg = getGscConfig(contentRoot);
    expect(cfg.siteUrl).toBeNull();
    expect(cfg.credentialsConfigured).toBe(true);
    expect(cfg.configured).toBe(false);
    delete process.env.GSC_CREDENTIALS_JSON;
    resetSettings(contentRoot);
  });

  it("accepts GCS_CREDENTIALS_JSON as the Search Console service account", () => {
    const prevGcs = process.env.GCS_CREDENTIALS_JSON;
    const prevGsc = process.env.GSC_CREDENTIALS_JSON;
    delete process.env.GSC_CREDENTIALS_JSON;
    process.env.GCS_CREDENTIALS_JSON = JSON.stringify({
      client_email: "gcs-sa@example.com",
      private_key: "x",
    });
    const creds = resolveGscCredentials();
    expect(creds.source).toBe("gcs");
    expect(creds.envVar).toBe("GCS_CREDENTIALS_JSON");
    expect(getGscConfig(tmp).credentialsConfigured).toBe(true);
    expect(getGscConfig(tmp).serviceAccountEmail).toBe("gcs-sa@example.com");
    if (prevGcs === undefined) delete process.env.GCS_CREDENTIALS_JSON;
    else process.env.GCS_CREDENTIALS_JSON = prevGcs;
    if (prevGsc === undefined) delete process.env.GSC_CREDENTIALS_JSON;
    else process.env.GSC_CREDENTIALS_JSON = prevGsc;
  });

  it("detects missing Search Console role from inspect errors", () => {
    expect(
      isGscPropertyAccessDenied(
        `Search Console inspect failed (403): {"error":{"status":"PERMISSION_DENIED","message":"User does not have sufficient permission for site"}}`,
      ),
    ).toBe(true);
    expect(isGscPropertyAccessDenied("quota exceeded")).toBe(false);
    expect(
      gscPropertyAccessFromRecords({
        "https://example.com/": {
          inspectedAt: "t",
          error: "Search Console inspect failed (403): PERMISSION_DENIED",
        },
      }),
    ).toBe("denied");
    expect(
      gscPropertyAccessFromRecords({
        "https://example.com/": { inspectedAt: "t", verdict: "PASS" },
      }),
    ).toBe("ok");
  });

  it("suggests https://{domain}/ and skips localhost", () => {
    expect(suggestedGscSiteUrl("4geeks.com")).toBe("https://4geeks.com/");
    expect(suggestedGscSiteUrl("https://www.example.com/path")).toBe("https://www.example.com/");
    expect(suggestedGscSiteUrl("localhost")).toBeNull();
  });

  it("detects main_seo_keyword on the entry or seo block", () => {
    expect(hasMainSeoKeyword({ main_seo_keyword: "bootcamp" })).toBe(true);
    expect(hasMainSeoKeyword({ seo: { main_seo_keyword: "python" } })).toBe(true);
    expect(hasMainSeoKeyword({ seo: { pillar: "/x" } })).toBe(false);
  });
});
