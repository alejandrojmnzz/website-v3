import { describe, it, expect } from "vitest";
import { gscHeadline, gscCrawlerErrorCount, gscPermissionLabel, isGscPropertyAccessDenied } from "./gscInspection";

describe("gscHeadline", () => {
  it("labels drafts, never-checked, indexed, and errors", () => {
    expect(gscHeadline(null, { requested: "/x", loc: null, inSitemap: false, isDraft: true, isPreview: true })).toBe(
      "Not in sitemap (draft)",
    );
    expect(gscHeadline(null)).toBe("Never checked");
    expect(gscHeadline({ inspectedAt: "t", verdict: "PASS" })).toBe("Indexed");
    expect(gscHeadline({ inspectedAt: "t", coverageState: "Submitted and indexed" })).toBe("Indexed");
    expect(gscHeadline({ inspectedAt: "t", verdict: "FAIL" })).toBe("Not indexed");
    expect(gscHeadline({ inspectedAt: "t", error: "quota" })).toBe("Error");
  });
});

describe("gscCrawlerErrorCount", () => {
  it("counts not configured and not indexed as errors", () => {
    expect(gscCrawlerErrorCount({ configured: false })).toBe(1);
    expect(gscCrawlerErrorCount({ configured: true, record: { inspectedAt: "t", verdict: "FAIL" } })).toBe(1);
    expect(gscCrawlerErrorCount({ configured: true, record: { inspectedAt: "t", error: "quota" } })).toBe(1);
    expect(gscCrawlerErrorCount({ loadError: true })).toBe(1);
  });

  it("does not count indexed, never-checked, drafts, or loading", () => {
    expect(gscCrawlerErrorCount({ configured: true, record: { inspectedAt: "t", verdict: "PASS" } })).toBe(0);
    expect(gscCrawlerErrorCount({ configured: true, record: null })).toBe(0);
    expect(
      gscCrawlerErrorCount({
        configured: true,
        resolved: { requested: "/x", loc: null, inSitemap: false, isDraft: true, isPreview: true },
      }),
    ).toBe(0);
    expect(gscCrawlerErrorCount({})).toBe(0);
  });
});

describe("isGscPropertyAccessDenied", () => {
  it("detects Search Console permission errors", () => {
    expect(isGscPropertyAccessDenied("Search Console inspect failed (403): PERMISSION_DENIED")).toBe(true);
    expect(isGscPropertyAccessDenied("quota exceeded")).toBe(false);
  });
});

describe("gscPermissionLabel", () => {
  it("maps Search Console permission levels", () => {
    expect(gscPermissionLabel("siteOwner")).toBe("Owner");
    expect(gscPermissionLabel("siteRestrictedUser")).toBe("Restricted user");
    expect(gscPermissionLabel("")).toBe("Unknown");
  });
});
