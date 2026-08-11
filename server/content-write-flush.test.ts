import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./redirects", () => ({
  clearRedirectCache: vi.fn(),
}));
vi.mock("./sitemap", () => ({
  refreshSitemapEntry: vi.fn(),
  refreshSitemapEntriesForContentKey: vi.fn(),
}));
vi.mock("./routes/_helpers", () => ({
  invalidateContentCaches: vi.fn(),
}));
vi.mock("./settings", () => ({
  getSupportedLocales: () => ["en", "es"],
  normalizeLocale: (l: string) => l,
}));

import { clearRedirectCache } from "./redirects";
import {
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
} from "./sitemap";
import { invalidateContentCaches } from "./routes/_helpers";
import { flushAfterContentWrites } from "./content-write-flush";
import {
  validateBulkMetaUpdates,
  BULK_META_MAX_SLUGS,
} from "./bulk-update-meta";

describe("flushAfterContentWrites", () => {
  const ci = { refresh: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears redirects, refreshes CI, invalidates caches once per type, refreshes locale sitemap", () => {
    flushAfterContentWrites({
      ci: ci as any,
      contentTypes: ["page", "page", "blog"],
      sitemapEntries: [
        { contentType: "page", slug: "home", locale: "en" },
        { contentType: "blog", slug: "post", locale: "en" },
      ],
      commonMetaTouched: false,
    });

    expect(clearRedirectCache).toHaveBeenCalledTimes(1);
    expect(ci.refresh).toHaveBeenCalledTimes(1);
    expect(invalidateContentCaches).toHaveBeenCalledTimes(2);
    expect(refreshSitemapEntry).toHaveBeenCalledTimes(2);
    expect(refreshSitemapEntriesForContentKey).not.toHaveBeenCalled();
  });

  it("uses content-key sitemap refresh when commonMetaTouched", () => {
    flushAfterContentWrites({
      ci: ci as any,
      contentTypes: ["page"],
      sitemapEntries: [
        { contentType: "page", slug: "home", locale: "en" },
        { contentType: "page", slug: "home", locale: "es" },
      ],
      commonMetaTouched: true,
    });

    expect(refreshSitemapEntriesForContentKey).toHaveBeenCalledTimes(1);
    expect(refreshSitemapEntriesForContentKey).toHaveBeenCalledWith(
      "page",
      "home",
      ["en", "es"],
    );
    expect(refreshSitemapEntry).not.toHaveBeenCalled();
  });
});

describe("validateBulkMetaUpdates", () => {
  it("rejects empty updates", () => {
    expect(validateBulkMetaUpdates([])).toMatch(/non-empty/i);
  });

  it("rejects non-meta paths", () => {
    expect(
      validateBulkMetaUpdates([{ field_path: "sections.0.title", value: "x" }]),
    ).toMatch(/Non-meta/i);
    expect(
      validateBulkMetaUpdates([{ field_path: "title", value: "x" }]),
    ).toMatch(/Non-meta/i);
  });

  it("rejects duplicate field_path", () => {
    expect(
      validateBulkMetaUpdates([
        { field_path: "meta.robots", value: "a" },
        { field_path: "meta.robots", value: "b" },
      ]),
    ).toMatch(/Duplicate/i);
  });

  it("requires meta_target for unknown meta keys", () => {
    expect(
      validateBulkMetaUpdates([{ field_path: "meta.twitter_card", value: "summary" }]),
    ).toMatch(/meta_target/);
  });

  it("accepts known meta paths", () => {
    expect(
      validateBulkMetaUpdates([
        { field_path: "meta.robots", value: "index" },
        { field_path: "meta.page_title", value: "Hi" },
      ]),
    ).toBeNull();
  });

  it("exposes max slug constant", () => {
    expect(BULK_META_MAX_SLUGS).toBe(50);
  });
});
