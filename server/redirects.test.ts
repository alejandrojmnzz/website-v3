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

import { findCanonicalSoftMatch, isLivePublicUrl, resolveRedirectRequestLocale, testRedirect } from "./redirects";
import { applyRedirectTraceCookie } from "./redirect-trace-cookie";
import {
  REDIRECT_TRACE_COOKIE_NAME,
  REDIRECT_TRACE_MAX_HOPS,
  appendRedirectTraceHop,
  parseRedirectTraceCookie,
  type RedirectTraceHop,
} from "@shared/redirect-trace";
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

describe("resolveRedirectRequestLocale", () => {
  it("prefers /es/ path prefix over English Accept-Language", () => {
    expect(
      resolveRedirectRequestLocale({
        path: "/es/blog/coding-bootcamps/legacy-slug",
        headers: { "accept-language": "en-US,en;q=0.9" },
      }),
    ).toBe("es");
  });

  it("uses Accept-Language when the path has no locale prefix", () => {
    expect(
      resolveRedirectRequestLocale({
        path: "/coding-bootcamps/legacy-slug",
        headers: { "accept-language": "es-ES,es;q=0.9" },
      }),
    ).toBe("es");
  });

  it("defaults to en when path and Accept-Language are ambiguous", () => {
    expect(
      resolveRedirectRequestLocale({
        path: "/coding-bootcamps/legacy-slug",
        headers: {},
      }),
    ).toBe("en");
  });
});

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

  it("soft-matches when only slug casing differs", () => {
    const ci = makeCi({
      knownSlugs: {
        "cuanto-gana-un-programador-en-colombia": {
          es: "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
        },
      },
    });
    const soft = findCanonicalSoftMatch(
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia",
      ci,
    );
    expect(soft).toEqual({
      typeName: "blog",
      canonicalUrl:
        "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
    });
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
    expect(result.destinationExists).toBe(true);
    expect(isLivePublicUrl(result)).toBe(true);
  });

  it("reports canonical match when slug case differs (Colombia vs colombia)", () => {
    const ci = makeCi({
      knownSlugs: {
        "cuanto-gana-un-programador-en-colombia": {
          es: "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
        },
      },
    });
    const result = testRedirect(
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia",
      "es",
      ci,
    );
    expect(result.match).toBe(true);
    expect(result.matchType).toBe("canonical");
    expect(result.resolvedTo).toBe(
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
    );
    expect(result.destinationExists).toBe(true);
    expect(isLivePublicUrl(result)).toBe(true);
  });
});

describe("regex capture groups lowercase for relative destinations", () => {
  it("lowercases $n when substituting into a site path", () => {
    const ci = {
      findBySlug: () => [],
      getAlternateUrls: () => ({}),
      isKnownUrl: (url: string) =>
        url ===
        "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
      getRedirects: () => [
        {
          from: "/es/(?!blog/|how-to/)([a-z_-]+)/([a-z0-9_-]+)",
          to: "/es/blog/$1/$2",
          type: "custom",
          source: "test",
          status: 301,
          priority: "fallback",
        },
      ],
      refreshCustomRedirects: () => [
        {
          from: "/es/(?!blog/|how-to/)([a-z_-]+)/([a-z0-9_-]+)",
          to: "/es/blog/$1/$2",
          type: "custom",
          source: "test",
          status: 301,
          priority: "fallback",
        },
      ],
    } as unknown as typeof ContentIndexType;

    const result = testRedirect(
      "/es/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia",
      "es",
      ci,
    );
    expect(result.match).toBe(true);
    expect(result.resolvedTo).toBe(
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
    );
    expect(result.destinationExists).toBe(true);
  });
});

describe("isLivePublicUrl matches Test a URL", () => {
  it("treats a known page with query string as live", () => {
    const ci = makeCi({
      knownSlugs: { apply: { en: "/en/apply" } },
    });
    const result = testRedirect("/en/apply?program=ai-fluency", "en", ci);
    expect(result.match).toBe(false);
    expect(result.pageExists).toBe(true);
    expect(isLivePublicUrl(result)).toBe(true);
  });

  it("treats an unknown path as not live", () => {
    const ci = makeCi({ knownSlugs: {} });
    const result = testRedirect("/en/missing-page", "en", ci);
    expect(isLivePublicUrl(result)).toBe(false);
  });
});

describe("redirect trace cookie", () => {
  it("appends hops and caps at REDIRECT_TRACE_MAX_HOPS", () => {
    let hops: RedirectTraceHop[] = [];
    for (let i = 0; i < REDIRECT_TRACE_MAX_HOPS + 2; i++) {
      hops = appendRedirectTraceHop(hops, {
        from: `/from-${i}`,
        to: `/to-${i}`,
        status: 301,
        matchType: "fallback",
        source: "site_4geeks-com/custom-redirects.yml",
      });
    }
    expect(hops).toHaveLength(REDIRECT_TRACE_MAX_HOPS);
    expect(hops[0]?.from).toBe("/from-0");
  });

  it("applyRedirectTraceCookie writes a parseable cookie", () => {
    const cookies: Record<string, string> = {};
    const req = { cookies: {}, hostname: "localhost" } as any;
    const res = {
      cookie: (name: string, value: string) => {
        cookies[name] = value;
      },
    } as any;
    applyRedirectTraceCookie(req, res, {
      from: "/es/interactive-exercise/foo",
      to: "/es/blog/interactive-exercise/foo",
      status: 301,
      matchType: "fallback",
      priority: "fallback",
      source: "site_4geeks-com/custom-redirects.yml",
    });
    const parsed = parseRedirectTraceCookie(cookies[REDIRECT_TRACE_COOKIE_NAME]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.from).toBe("/es/interactive-exercise/foo");
    expect(parsed[0]?.matchType).toBe("fallback");
  });
});
