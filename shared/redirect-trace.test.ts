import { describe, expect, it } from "vitest";
import {
  REDIRECT_TRACE_MAX_HOPS,
  appendRedirectTraceHop,
  encodeRedirectTraceCookie,
  formatRedirectMatchLabel,
  parseRedirectTraceCookie,
  redirectTraceOriginalUrl,
  type RedirectTraceHop,
} from "./redirect-trace";

function hop(from: string, to: string, matchType: RedirectTraceHop["matchType"] = "exact"): RedirectTraceHop {
  return { from, to, status: 301, matchType, source: "site_4geeks-com/custom-redirects.yml" };
}

describe("redirect-trace cookie helpers", () => {
  it("round-trips hops through encode/parse", () => {
    const hops = [hop("/a", "/b", "regex")];
    expect(parseRedirectTraceCookie(encodeRedirectTraceCookie(hops))).toEqual(hops);
  });

  it("parses URI-encoded cookie values", () => {
    const hops = [hop("/es/foo", "/es/blog/foo", "fallback")];
    const encoded = encodeURIComponent(encodeRedirectTraceCookie(hops));
    expect(parseRedirectTraceCookie(encoded)).toEqual(hops);
  });

  it("returns [] for garbage", () => {
    expect(parseRedirectTraceCookie(undefined)).toEqual([]);
    expect(parseRedirectTraceCookie("not-json")).toEqual([]);
    expect(parseRedirectTraceCookie("{}")).toEqual([]);
  });

  it("caps hops at REDIRECT_TRACE_MAX_HOPS keeping the original from", () => {
    let hops: RedirectTraceHop[] = [];
    for (let i = 0; i < REDIRECT_TRACE_MAX_HOPS + 3; i++) {
      hops = appendRedirectTraceHop(hops, hop(`/h${i}`, `/h${i + 1}`));
    }
    expect(hops).toHaveLength(REDIRECT_TRACE_MAX_HOPS);
    expect(redirectTraceOriginalUrl(hops)).toBe("/h0");
    expect(hops[hops.length - 1]?.to).toBe(`/h${REDIRECT_TRACE_MAX_HOPS}`);
  });

  it("labels fallback regex vs exact fallback", () => {
    expect(formatRedirectMatchLabel(hop("/es/(?!blog/)([a-z]+)/x", "/es/blog/a/x", "fallback"))).toBe(
      "fallback regex",
    );
    expect(formatRedirectMatchLabel(hop("/es/old", "/es/new", "fallback"))).toBe("fallback");
    expect(formatRedirectMatchLabel(hop("/a", "/b", "canonical"))).toBe("canonical");
  });
});
