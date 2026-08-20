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
  listGscSites,
  mapGscSitesListPayload,
  gscPermissionLabel,
  mapInspectPayload,
  mergeInspectError,
  mergeInspectSuccess,
  resetGscInspectionMemory,
  resolveGscCredentials,
  resolvePublicInspectLoc,
  setGscCacheRootForTests,
  setGscGcsSyncForTests,
  sidecarPath,
  suggestedGscSiteUrl,
  upsertRecord,
  loadGscInspectionStoreFromBucket,
  forceUploadGscInspectionToBucket,
  pullGscInspectionStoreFromBucket,
  isStale,
  STALE_MS,
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
    setGscGcsSyncForTests(null);
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

  it("maps Search Console sites.list payloads", async () => {
    expect(mapGscSitesListPayload(null)).toEqual([]);
    expect(mapGscSitesListPayload({ siteEntry: [] })).toEqual([]);
    expect(
      mapGscSitesListPayload({
        siteEntry: [
          { siteUrl: "https://4geeks.com/", permissionLevel: "siteRestrictedUser" },
          { siteUrl: "sc-domain:4geeks.com", permissionLevel: "siteOwner" },
          { permissionLevel: "siteOwner" },
        ],
      }),
    ).toEqual([
      { siteUrl: "https://4geeks.com/", permissionLevel: "siteRestrictedUser" },
      { siteUrl: "sc-domain:4geeks.com", permissionLevel: "siteOwner" },
    ]);
    expect(gscPermissionLabel("siteOwner")).toBe("Owner");
    expect(gscPermissionLabel("siteFullUser")).toBe("Full user");
    const listed = await listGscSites({
      listFn: async () => ({
        siteEntry: [{ siteUrl: "https://example.com/", permissionLevel: "siteFullUser" }],
      }),
    });
    expect(listed).toEqual([{ siteUrl: "https://example.com/", permissionLevel: "siteFullUser" }]);
  });

  it("detects main_seo_keyword on the entry or seo block", () => {
    expect(hasMainSeoKeyword({ main_seo_keyword: "bootcamp" })).toBe(true);
    expect(hasMainSeoKeyword({ seo: { main_seo_keyword: "python" } })).toBe(true);
    expect(hasMainSeoKeyword({ seo: { pillar: "/x" } })).toBe(false);
  });

  it("treats missing and 7-day-old rows as stale, not 1-day-old", () => {
    const now = Date.parse("2026-08-18T00:00:00.000Z");
    expect(isStale(undefined, now)).toBe(true);
    expect(isStale({ inspectedAt: "2026-08-17T00:00:00.000Z" }, now)).toBe(false);
    expect(isStale({ inspectedAt: "2026-08-10T23:59:59.000Z" }, now)).toBe(true);
    expect(STALE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("counts stale as never-checked plus rows older than 7 days", () => {
    const now = Date.parse("2026-08-18T00:00:00.000Z");
    const debug: DebugSitemapUrl[] = [
      url({ loc: "https://example.com/fresh", inSitemap: true, content_type: "page", slug: "fresh" }),
      url({ loc: "https://example.com/old", inSitemap: true, content_type: "page", slug: "old" }),
      url({ loc: "https://example.com/missing", inSitemap: true, content_type: "page", slug: "missing" }),
    ];
    const summary = buildSummary(
      {
        "https://example.com/fresh": { inspectedAt: "2026-08-17T00:00:00.000Z", verdict: "PASS" },
        "https://example.com/old": { inspectedAt: "2026-08-01T00:00:00.000Z", verdict: "PASS" },
      },
      debug,
      now,
    );
    expect(summary.neverChecked).toBe(1);
    expect(summary.stale).toBe(2);
    expect(summary.indexed).toBe(2);
  });

  it("hydrates the sidecar from GCS without uploading", async () => {
    const loc = "https://example.com/us/blog/foo";
    const payload = {
      records: { [loc]: { inspectedAt: "2026-08-01T00:00:00.000Z", verdict: "PASS" } },
    };
    const uploads: string[] = [];
    setGscGcsSyncForTests({
      production: true,
      gcs: {
        available: true,
        initBootstrapFromEnv: () => {},
        downloadFirstExisting: async () => ({
          key: "site_demo/sync/gsc-url-inspection.json",
          data: Buffer.from(JSON.stringify(payload), "utf-8"),
        }),
        debouncedUpload: () => {
          uploads.push("debounce");
        },
        upload: async () => {
          uploads.push("upload");
        },
      },
    });

    const source = await loadGscInspectionStoreFromBucket("site_demo");
    expect(source).toBe("gcs");
    expect(getRecord("site_demo", loc)?.verdict).toBe("PASS");
    expect(fs.existsSync(sidecarPath("site_demo"))).toBe(true);
    expect(uploads).toEqual([]);
  });

  it("skips GCS in development unless forceFromGcs is set", async () => {
    const loc = "https://example.com/us/blog/foo";
    const payload = {
      records: { [loc]: { inspectedAt: "2026-08-01T00:00:00.000Z", verdict: "PASS" } },
    };
    let downloads = 0;
    setGscGcsSyncForTests({
      production: false,
      gcs: {
        available: true,
        initBootstrapFromEnv: () => {},
        downloadFirstExisting: async () => {
          downloads += 1;
          return {
            key: "site_demo/sync/gsc-url-inspection.json",
            data: Buffer.from(JSON.stringify(payload), "utf-8"),
          };
        },
        debouncedUpload: () => {},
        upload: async () => {},
      },
    });

    expect(await loadGscInspectionStoreFromBucket("site_demo")).toBe("empty");
    expect(downloads).toBe(0);

    const pulled = await pullGscInspectionStoreFromBucket("site_demo");
    expect(pulled.source).toBe("gcs");
    expect(pulled.recordCount).toBe(1);
    expect(pulled.gcsKey).toBe("site_demo/sync/gsc-url-inspection.json");
    expect(downloads).toBe(1);
    expect(getRecord("site_demo", loc)?.verdict).toBe("PASS");
  });

  it("starts empty when the GCS sidecar is missing or invalid", async () => {
    setGscGcsSyncForTests({
      production: true,
      gcs: {
        available: true,
        initBootstrapFromEnv: () => {},
        downloadFirstExisting: async () => ({
          key: "site_demo/sync/gsc-url-inspection.json",
          data: Buffer.from("not-json", "utf-8"),
        }),
        debouncedUpload: () => {},
        upload: async () => {},
      },
    });
    const source = await loadGscInspectionStoreFromBucket("site_demo");
    expect(source).toBe("empty");
    expect(getRecord("site_demo", "https://example.com/x")).toBeUndefined();
  });

  it("queues a debounced GCS upload in production and skips it in development", () => {
    const calls: Array<{ key: string; delay?: number }> = [];
    setGscGcsSyncForTests({
      production: true,
      gcs: {
        available: true,
        initBootstrapFromEnv: () => {},
        downloadFirstExisting: async () => null,
        debouncedUpload: (key, _data, _type, delayMs) => {
          calls.push({ key, delay: delayMs });
        },
        upload: async () => {},
      },
    });
    upsertRecord("site_demo", "https://example.com/a", { inspectedAt: "t", verdict: "PASS" });
    expect(calls).toEqual([{ key: "site_demo/sync/gsc-url-inspection.json", delay: 30_000 }]);

    calls.length = 0;
    setGscGcsSyncForTests({ production: false });
    upsertRecord("site_demo", "https://example.com/b", { inspectedAt: "t", verdict: "PASS" });
    expect(calls).toEqual([]);
  });

  it("force-uploads the sidecar in production", async () => {
    const uploaded: string[] = [];
    setGscGcsSyncForTests({
      production: true,
      gcs: {
        available: true,
        initBootstrapFromEnv: () => {},
        downloadFirstExisting: async () => null,
        debouncedUpload: () => {},
        upload: async (key) => {
          uploaded.push(key);
        },
      },
    });
    upsertRecord("site_demo", "https://example.com/a", { inspectedAt: "t" });
    const result = await forceUploadGscInspectionToBucket("site_demo");
    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(true);
    expect(uploaded).toEqual(["site_demo/sync/gsc-url-inspection.json"]);
  });
});
