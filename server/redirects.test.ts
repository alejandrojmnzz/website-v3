import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./content-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-types")>();
  return {
    ...actual,
    getAllConfigs: () => ({
      blog: {
        directory: "blog",
        single_template: true,
        field_mapping: {
          title: "title",
          category: { source: "category", default: "general" },
          _slug: "slug",
          _locale: "locale",
        },
        url_pattern: {
          en: "/en/blog/:category/:slug",
          es: "/es/blog/:category/:slug",
        },
      },
    }),
  };
});

import { findCanonicalSoftMatch, testRedirect } from "./redirects";
import type { contentIndex as ContentIndexType } from "./content-index";

function makeCi(opts: {
  knownSlugs?: Record<string, { es?: string; en?: string }>;
}): typeof ContentIndexType {
  const knownSlugs = opts.knownSlugs ?? {};
  return {
    findBySlug: (slug: string, filter?: { contentType?: string }) => {
      if (filter?.contentType && filter.contentType !== "blog") return [];
      if (!knownSlugs[slug]) return [];
      return [{ slug, contentType: "blog" }];
    },
    getAlternateUrls: (slug: string) => knownSlugs[slug] ?? {},
    isKnownUrl: (url: string) =>
      Object.values(knownSlugs).some((urls) => Object.values(urls).includes(url)),
    getRedirects: () => [],
    refreshCustomRedirects: () => [],
  } as unknown as typeof ContentIndexType;
}

describe("findCanonicalSoftMatch", () => {
  it("returns null when the last segment is not a real slug", () => {
    const ci = makeCi({ knownSlugs: {} });
    expect(
      findCanonicalSoftMatch(
        "/es/blog/herramientas-ia/mejores-agentes-de-codigo8",
        ci,
      ),
    ).toBeNull();
  });

  it("301-soft-matches wrong category when the slug exists", () => {
    const ci = makeCi({
      knownSlugs: {
        "real-post": {
          es: "/es/blog/herramientas-ia/real-post",
          en: "/en/blog/ai-tools/real-post",
        },
      },
    });
    const soft = findCanonicalSoftMatch("/es/blog/wrong-category/real-post", ci);
    expect(soft).toEqual({
      typeName: "blog",
      canonicalUrl: "/es/blog/herramientas-ia/real-post",
    });
  });

  it("returns null when URL is already canonical", () => {
    const ci = makeCi({
      knownSlugs: {
        "real-post": { es: "/es/blog/herramientas-ia/real-post" },
      },
    });
    expect(
      findCanonicalSoftMatch("/es/blog/herramientas-ia/real-post", ci),
    ).toBeNull();
  });
});

describe("testRedirect includes canonical soft-match", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports no match for a missing blog slug", () => {
    const ci = makeCi({ knownSlugs: {} });
    const result = testRedirect(
      "/es/blog/herramientas-ia/mejores-agentes-de-codigo8",
      "es",
      ci,
    );
    expect(result.match).toBe(false);
    expect(result.pageExists).toBe(false);
  });

  it("reports canonical match for wrong category + existing slug", () => {
    const ci = makeCi({
      knownSlugs: {
        "real-post": {
          es: "/es/blog/herramientas-ia/real-post",
        },
      },
    });
    const result = testRedirect("/es/blog/wrong-category/real-post", "es", ci);
    expect(result.match).toBe(true);
    expect(result.matchType).toBe("canonical");
    expect(result.status).toBe(301);
    expect(result.resolvedTo).toBe("/es/blog/herramientas-ia/real-post");
  });
});
