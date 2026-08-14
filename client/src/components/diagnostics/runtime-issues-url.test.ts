import { describe, expect, it } from "vitest";
import { FILTER_ALL } from "./runtime-issues-filters";
import {
  RUNTIME_ISSUE_VIEW_DEFAULTS,
  parseRuntimeIssueSearch,
  serializeRuntimeIssueSearch,
} from "./runtime-issues-url";

describe("parseRuntimeIssueSearch", () => {
  it("returns defaults for an empty query", () => {
    expect(parseRuntimeIssueSearch("")).toEqual(RUNTIME_ISSUE_VIEW_DEFAULTS);
    expect(parseRuntimeIssueSearch("?")).toEqual(RUNTIME_ISSUE_VIEW_DEFAULTS);
  });

  it("parses hideBots=0 and pagesOnly=0", () => {
    const view = parseRuntimeIssueSearch("hideBots=0&pagesOnly=0");
    expect(view.hideBots).toBe(false);
    expect(view.filters.pagesOnly).toBe(false);
  });

  it("parses path, referrer, locale, device, sort, dir", () => {
    const view = parseRuntimeIssueSearch(
      "path=%2Fen&referrer=google&locale=es&device=mobile&sort=lastSeen&dir=asc",
    );
    expect(view.filters.pathQuery).toBe("/en");
    expect(view.filters.referrerQuery).toBe("google");
    expect(view.filters.locale).toBe("es");
    expect(view.filters.device).toBe("mobile");
    expect(view.sortKey).toBe("lastSeen");
    expect(view.sortDir).toBe("asc");
  });

  it("treats FILTER_ALL locale as all locales", () => {
    expect(parseRuntimeIssueSearch("locale=__all__").filters.locale).toBe(FILTER_ALL);
  });
});

describe("serializeRuntimeIssueSearch", () => {
  it("omits defaults so the URL stays empty", () => {
    expect(serializeRuntimeIssueSearch(RUNTIME_ISSUE_VIEW_DEFAULTS)).toBe("");
  });

  it("writes only non-default keys", () => {
    const qs = serializeRuntimeIssueSearch({
      ...RUNTIME_ISSUE_VIEW_DEFAULTS,
      hideBots: false,
      filters: {
        ...RUNTIME_ISSUE_VIEW_DEFAULTS.filters,
        pathQuery: "/es/blog",
        locale: "es",
        pagesOnly: true,
        windowDays: 7,
      },
      sortKey: "lastSeen",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("hideBots")).toBe("0");
    expect(params.get("pagesOnly")).toBe("1");
    expect(params.get("window")).toBe("7");
    expect(params.get("path")).toBe("/es/blog");
    expect(params.get("locale")).toBe("es");
    expect(params.get("sort")).toBe("lastSeen");
    expect(params.has("dir")).toBe(false);
    expect(params.has("device")).toBe(false);
  });

  it("preserves unrelated query params", () => {
    const qs = serializeRuntimeIssueSearch(RUNTIME_ISSUE_VIEW_DEFAULTS, "token=abc&path=/old");
    const params = new URLSearchParams(qs);
    expect(params.get("token")).toBe("abc");
    expect(params.has("path")).toBe(false);
  });

  it("round-trips a fully customized view", () => {
    const view = parseRuntimeIssueSearch(
      "hideBots=0&pagesOnly=1&path=/en&referrer=press&locale=en&device=desktop&window=7&tz=America/Bogota&source=search_crawler&sort=lastSeen&dir=asc",
    );
    expect(parseRuntimeIssueSearch(serializeRuntimeIssueSearch(view))).toEqual(view);
  });
});
