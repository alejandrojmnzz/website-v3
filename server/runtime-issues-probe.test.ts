import { describe, expect, it, vi } from "vitest";
import type { RedirectTestResult } from "./redirects";
import {
  MAX_PROBE_HOPS,
  combineProbeWalks,
  lookupDestination,
  probePathsMatch,
  probeUrlKey,
  walkHttpRedirects,
  walkIndexRedirects,
  type HttpWalkResult,
  type IndexWalkResult,
} from "./runtime-issues-probe";

function redirectTo(to: string, matchType: RedirectTestResult["matchType"] = "exact"): RedirectTestResult {
  return { match: true, resolvedTo: to, matchType, from: "/from", status: 301 };
}

function pageAt(): RedirectTestResult {
  return { match: false, pageExists: true };
}

function missing(): RedirectTestResult {
  return { match: false, pageExists: false };
}

function indexBase(overrides: Partial<IndexWalkResult> = {}): IndexWalkResult {
  return {
    hops: ["/hello"],
    finalUrl: "/hello",
    pageExists: false,
    matchedRedirect: false,
    destExists: false,
    external: false,
    loop: false,
    ...overrides,
  };
}

function httpBase(overrides: Partial<HttpWalkResult> = {}): HttpWalkResult {
  return {
    hops: ["http://localhost:5000/hello"],
    finalUrl: "http://localhost:5000/hello",
    status: 404,
    loop: false,
    ...overrides,
  };
}

describe("probeUrlKey", () => {
  it("normalizes path and absolute URL to comparable keys", () => {
    expect(probeUrlKey("/us/page/")).toBe("/us/page");
    expect(probeUrlKey("http://localhost:5000/us/page")).toBe("http://localhost:5000/us/page");
    expect(probeUrlKey("https://example.com/x/")).toBe("https://example.com/x");
  });

  it("lowercases so Colombia and colombia agree", () => {
    expect(probeUrlKey("/es/blog/cat/post-en-Colombia")).toBe(
      "/es/blog/cat/post-en-colombia",
    );
    expect(probeUrlKey("http://localhost:5000/es/blog/cat/post-en-Colombia")).toBe(
      "http://localhost:5000/es/blog/cat/post-en-colombia",
    );
  });
});

describe("probePathsMatch", () => {
  it("treats path case as insignificant", () => {
    expect(
      probePathsMatch(
        "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia",
        "http://localhost:5000/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia",
      ),
    ).toBe(true);
  });
});

describe("lookupDestination", () => {
  it("treats absolute URLs as external", async () => {
    const lookup = await lookupDestination("https://example.com/x", { resolveUrl: () => null });
    expect(lookup).toEqual({ exists: true, external: true });
  });

  it("returns missing when resolveUrl is null", async () => {
    const lookup = await lookupDestination("/gone", { resolveUrl: () => null });
    expect(lookup.exists).toBe(false);
    expect(lookup.external).toBe(false);
  });

  it("accepts YAML entries without a DB check", async () => {
    const lookup = await lookupDestination("/us/page", {
      resolveUrl: () => ({ contentType: "page", slug: "page" }),
    });
    expect(lookup.exists).toBe(true);
    expect(lookup.entry).toEqual({ contentType: "page", slug: "page" });
  });

  it("requires querySlugExists for fromDatabase entries", async () => {
    const ci = {
      resolveUrl: () => ({ contentType: "blog", slug: "post", fromDatabase: true }),
    };
    expect((await lookupDestination("/us/blog/post", ci)).exists).toBe(false);
    expect((await lookupDestination("/us/blog/post", ci, async () => true)).exists).toBe(true);
    expect((await lookupDestination("/us/blog/post", ci, async () => false)).exists).toBe(false);
  });
});

describe("walkIndexRedirects", () => {
  it("returns page when the path exists with no redirect", async () => {
    const result = await walkIndexRedirects({
      path: "/hello",
      locale: "en",
      test: () => pageAt(),
      lookup: async () => ({
        exists: true,
        external: false,
        entry: { contentType: "page", slug: "hello" },
      }),
    });
    expect(result.pageExists).toBe(true);
    expect(result.matchedRedirect).toBe(false);
    expect(result.hops).toEqual(["/hello"]);
    expect(result.loop).toBe(false);
  });

  it("follows one hop to a live page", async () => {
    const result = await walkIndexRedirects({
      path: "/hello",
      locale: "en",
      test: (url) => (url === "/hello" ? redirectTo("/us/page") : pageAt()),
      lookup: async (url) => ({
        exists: url === "/us/page",
        external: false,
        entry: url === "/us/page" ? { contentType: "page", slug: "page" } : undefined,
      }),
    });
    expect(result.matchedRedirect).toBe(true);
    expect(result.pageExists).toBe(true);
    expect(result.hops).toEqual(["/hello", "/us/page"]);
    expect(result.matchType).toBe("exact");
  });

  it("follows a chain and flags more than one hop via hops length", async () => {
    const result = await walkIndexRedirects({
      path: "/a",
      locale: "en",
      test: (url) => {
        if (url === "/a") return redirectTo("/b");
        if (url === "/b") return redirectTo("/c");
        return pageAt();
      },
      lookup: async () => ({ exists: true, external: false }),
    });
    expect(result.hops).toEqual(["/a", "/b", "/c"]);
    expect(result.finalUrl).toBe("/c");
  });

  it("detects a redirect cycle", async () => {
    const result = await walkIndexRedirects({
      path: "/a",
      locale: "en",
      test: (url) => (url === "/a" ? redirectTo("/b") : redirectTo("/a")),
      lookup: async () => ({ exists: false, external: false }),
    });
    expect(result.loop).toBe(true);
  });

  it("does not treat case-only canonicalization as a cycle (Colombia → colombia)", async () => {
    const mixed =
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia";
    const canonical =
      "/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia";
    const result = await walkIndexRedirects({
      path: mixed,
      locale: "es",
      test: (url) => {
        if (url === mixed) return redirectTo(canonical, "canonical");
        if (url === canonical) return pageAt();
        return missing();
      },
      lookup: async (url) => ({
        exists: url === canonical,
        external: false,
        entry:
          url === canonical
            ? { contentType: "blog", slug: "cuanto-gana-un-programador-en-colombia" }
            : undefined,
      }),
    });
    expect(result.loop).toBe(false);
    expect(result.matchedRedirect).toBe(true);
    expect(result.pageExists).toBe(true);
    expect(result.finalUrl).toBe(canonical);
    expect(result.hops).toEqual([mixed, canonical]);
    expect(result.matchType).toBe("canonical");
  });

  it("settles case-only hop even when destination is missing", async () => {
    const mixed = "/es/blog/cat/Post-Slug";
    const canonical = "/es/blog/cat/post-slug";
    const result = await walkIndexRedirects({
      path: mixed,
      locale: "es",
      test: (url) => (url === mixed ? redirectTo(canonical, "canonical") : missing()),
      lookup: async () => ({ exists: false, external: false }),
    });
    expect(result.loop).toBe(false);
    expect(result.matchedRedirect).toBe(true);
    expect(result.pageExists).toBe(false);
    expect(result.destExists).toBe(false);
    expect(result.finalUrl).toBe(canonical);
  });

  it("stops at an external destination", async () => {
    const result = await walkIndexRedirects({
      path: "/out",
      locale: "en",
      test: () => redirectTo("https://example.com/x"),
      lookup: async () => ({ exists: true, external: true }),
    });
    expect(result.external).toBe(true);
    expect(result.finalUrl).toBe("https://example.com/x");
    expect(result.hops).toEqual(["/out", "https://example.com/x"]);
  });

  it("keeps canonical matchType from the first hop", async () => {
    const result = await walkIndexRedirects({
      path: "/us/blog/wrong/real-post",
      locale: "en",
      test: () => redirectTo("/us/blog/right/real-post", "canonical"),
      lookup: async () => ({
        exists: true,
        external: false,
        entry: { contentType: "blog", slug: "real-post" },
      }),
    });
    expect(result.matchType).toBe("canonical");
  });

  it("caps hops and reports a loop", async () => {
    let n = 0;
    const result = await walkIndexRedirects({
      path: "/0",
      locale: "en",
      test: () => {
        n += 1;
        return redirectTo(`/${n}`);
      },
      lookup: async () => ({ exists: false, external: false }),
    });
    expect(result.loop).toBe(true);
    expect(result.hops.length).toBeLessThanOrEqual(MAX_PROBE_HOPS + 1);
  });
});

describe("walkHttpRedirects", () => {
  it("follows Location until a non-3xx", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/hello")) {
        return new Response(null, { status: 301, headers: { location: "/us/page" } });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await walkHttpRedirects({
      startUrl: "http://localhost:5000/hello",
      fetchFn,
    });
    expect(result.status).toBe(200);
    expect(result.finalUrl).toBe("http://localhost:5000/us/page");
    expect(result.hops).toEqual(["http://localhost:5000/hello", "http://localhost:5000/us/page"]);
  });

  it("returns 404 without following", async () => {
    const fetchFn = vi.fn(async () => new Response("missing", { status: 404 })) as unknown as typeof fetch;
    const result = await walkHttpRedirects({
      startUrl: "http://localhost:5000/hello",
      fetchFn,
    });
    expect(result.status).toBe(404);
    expect(result.finalUrl).toBe("http://localhost:5000/hello");
  });

  it("treats fetch failure as an error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    const result = await walkHttpRedirects({
      startUrl: "https://dead.example/x",
      fetchFn,
    });
    expect(result.status).toBeNull();
    expect(result.error).toBe("timeout");
  });

  it("does not treat case-only Location as a cycle", async () => {
    const mixed =
      "http://localhost:5000/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-Colombia";
    const canonical =
      "http://localhost:5000/es/blog/cuanto-gana-un-programador/cuanto-gana-un-programador-en-colombia";
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === mixed) {
        return new Response(null, {
          status: 301,
          headers: { location: canonical },
        });
      }
      if (href === canonical) {
        return new Response("ok", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await walkHttpRedirects({ startUrl: mixed, fetchFn });
    expect(result.loop).toBe(false);
    expect(result.status).toBe(200);
    expect(result.finalUrl).toBe(canonical);
    expect(result.hops).toEqual([mixed, canonical]);
  });
});

describe("combineProbeWalks", () => {
  it("returns not_found when both sides miss", () => {
    const probe = combineProbeWalks(indexBase(), httpBase(), 1);
    expect(probe.status).toBe("not_found");
    expect(probe.destination).toBeUndefined();
    expect(probe.at).toBe(1);
  });

  it("returns page when the path is live on both sides", () => {
    const probe = combineProbeWalks(
      indexBase({
        pageExists: true,
        destExists: true,
        entry: { contentType: "page", slug: "hello" },
      }),
      httpBase({ status: 200 }),
      1,
    );
    expect(probe.status).toBe("page");
    expect(probe.destination).toBe("/hello");
  });

  it("returns redirect for one hop when HTTP lands on the same path", () => {
    const probe = combineProbeWalks(
      indexBase({
        hops: ["/hello", "/us/page"],
        finalUrl: "/us/page",
        matchedRedirect: true,
        destExists: true,
        pageExists: true,
        matchType: "exact",
      }),
      httpBase({
        hops: ["http://localhost:5000/hello", "http://localhost:5000/us/page"],
        finalUrl: "http://localhost:5000/us/page",
        status: 200,
      }),
      1,
    );
    expect(probe.status).toBe("redirect");
    expect(probe.chained).toBeUndefined();
    expect(probe.destination).toBe("/us/page");
  });

  it("flags chained when the index hop list is longer than two", () => {
    const probe = combineProbeWalks(
      indexBase({
        hops: ["/a", "/b", "/c"],
        finalUrl: "/c",
        matchedRedirect: true,
        destExists: true,
        pageExists: true,
      }),
      httpBase({
        finalUrl: "http://localhost:5000/c",
        status: 200,
      }),
      1,
    );
    expect(probe.status).toBe("redirect");
    expect(probe.chained).toBe(true);
  });

  it("returns broken_redirect when the index dest is missing", () => {
    const probe = combineProbeWalks(
      indexBase({
        hops: ["/hello", "/gone"],
        finalUrl: "/gone",
        matchedRedirect: true,
        destExists: false,
      }),
      httpBase({ status: 404 }),
      1,
    );
    expect(probe.status).toBe("broken_redirect");
    expect(probe.destination).toBe("/gone");
  });

  it("returns mismatch when index and HTTP finals disagree", () => {
    const probe = combineProbeWalks(
      indexBase({
        hops: ["/hello", "/us/page"],
        finalUrl: "/us/page",
        matchedRedirect: true,
        destExists: true,
        pageExists: true,
      }),
      httpBase({
        finalUrl: "http://localhost:5000/other",
        status: 200,
      }),
      1,
    );
    expect(probe.status).toBe("mismatch");
  });

  it("does not mismatch when finals differ only by path case", () => {
    const probe = combineProbeWalks(
      indexBase({
        hops: [
          "/es/blog/cat/post-en-Colombia",
          "/es/blog/cat/post-en-colombia",
        ],
        finalUrl: "/es/blog/cat/post-en-colombia",
        matchedRedirect: true,
        destExists: true,
        pageExists: true,
      }),
      httpBase({
        finalUrl: "http://localhost:5000/es/blog/cat/post-en-Colombia",
        status: 200,
      }),
      1,
    );
    expect(probe.status).toBe("redirect");
  });

  it("returns loop when either walk loops", () => {
    expect(combineProbeWalks(indexBase({ loop: true }), httpBase(), 1).status).toBe("loop");
    expect(combineProbeWalks(indexBase(), httpBase({ loop: true }), 1).status).toBe("loop");
  });

  it("returns redirect when an external destination HTTP 2xxs", () => {
    const probe = combineProbeWalks(
      indexBase({
        hops: ["/out", "https://example.com/x"],
        finalUrl: "https://example.com/x",
        matchedRedirect: true,
        destExists: true,
        external: true,
      }),
      httpBase({
        finalUrl: "https://example.com/x",
        status: 200,
      }),
      1,
    );
    expect(probe.status).toBe("redirect");
  });

  it("returns broken_redirect when an external destination fails HTTP", () => {
    const probe = combineProbeWalks(
      indexBase({
        hops: ["/out", "https://dead.example/x"],
        finalUrl: "https://dead.example/x",
        matchedRedirect: true,
        destExists: true,
        external: true,
      }),
      httpBase({
        finalUrl: "https://dead.example/x",
        status: 404,
      }),
      1,
    );
    expect(probe.status).toBe("broken_redirect");
  });
});
