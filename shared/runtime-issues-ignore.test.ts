import { describe, expect, it } from "vitest";
import {
  formatIgnoreRulePreview,
  heuristicIgnoreSuggestions,
  pathMatchesIgnoreRule,
  previewIgnoreRule,
  splitLocalePrefix,
  suggestionFromKind,
  validateIgnoreRuleInput,
} from "./runtime-issues-ignore";

describe("splitLocalePrefix", () => {
  it("requires a slug after the locale", () => {
    expect(splitLocalePrefix("/us/old-page")).toEqual({ locale: "us", rest: "/old-page" });
    expect(splitLocalePrefix("/us")).toBeNull();
    expect(splitLocalePrefix("/old-page")).toBeNull();
  });
});

describe("pathMatchesIgnoreRule", () => {
  it("matches exact paths only", () => {
    const rule = validateIgnoreRuleInput({ kind: "exact", path: "/us/old-page" });
    expect(rule).toBeTruthy();
    expect(pathMatchesIgnoreRule("/us/old-page/", rule!)).toBe(true);
    expect(pathMatchesIgnoreRule("/us/old-page/extra", rule!)).toBe(false);
  });

  it("matches locale twins but not extra segments", () => {
    const rule = validateIgnoreRuleInput({
      kind: "locales",
      locales: ["us", "es"],
      rest: "/old-page",
    });
    expect(rule).toBeTruthy();
    expect(pathMatchesIgnoreRule("/us/old-page", rule!)).toBe(true);
    expect(pathMatchesIgnoreRule("/es/old-page", rule!)).toBe(true);
    expect(pathMatchesIgnoreRule("/us/old-page/extra", rule!)).toBe(false);
    expect(pathMatchesIgnoreRule("/en/old-page", rule!)).toBe(false);
  });

  it("matches only listed slugs under a parent", () => {
    const rule = validateIgnoreRuleInput({
      kind: "slug_list",
      locales: ["us"],
      parent: "/old-blog",
      slugs: ["post-1", "post-2"],
    });
    expect(rule).toBeTruthy();
    expect(pathMatchesIgnoreRule("/us/old-blog/post-1", rule!)).toBe(true);
    expect(pathMatchesIgnoreRule("/us/old-blog/post-3", rule!)).toBe(false);
    expect(pathMatchesIgnoreRule("/es/old-blog/post-1", rule!)).toBe(false);
  });
});

describe("heuristicIgnoreSuggestions", () => {
  it("suggests exact and locale-flexible for a single path", () => {
    const suggestions = heuristicIgnoreSuggestions(["/us/old-page"], ["us", "es"]);
    const labels = suggestions.map((s) => s.label);
    expect(labels).toContain("This path only");
    expect(labels).toContain("Same path, any locale");
    expect(suggestions.some((s) => s.rules[0]?.kind === "slug_list")).toBe(false);
  });

  it("suggests a closed slug list for bulk siblings", () => {
    const suggestions = heuristicIgnoreSuggestions(
      ["/us/old-blog/post-1", "/us/old-blog/post-2"],
      ["us", "es"],
    );
    const slug = suggestions.find((s) => s.rules[0]?.kind === "slug_list");
    expect(slug).toBeTruthy();
    expect(slug?.rules[0]).toMatchObject({
      kind: "slug_list",
      parent: "/old-blog",
      slugs: ["post-1", "post-2"],
    });
    expect(pathMatchesIgnoreRule("/us/old-blog/post-3", slug!.rules[0]!)).toBe(false);
  });

  it("does not suggest a folder wildcard", () => {
    const suggestions = heuristicIgnoreSuggestions(["/us/old-campaign/foo"], ["us"]);
    expect(suggestions.every((s) => s.rules.every((r) => r.kind !== "slug_list" || r.slugs.length >= 1))).toBe(
      true,
    );
    expect(formatIgnoreRulePreview(suggestions[0]!.rules[0]!)).toBe("/us/old-campaign/foo");
  });
});

describe("previewIgnoreRule", () => {
  it("counts current matching paths", () => {
    const rule = validateIgnoreRuleInput({
      kind: "locales",
      locales: ["us", "es"],
      rest: "/gone",
    })!;
    const preview = previewIgnoreRule(rule, ["/us/gone", "/es/gone", "/us/keep"]);
    expect(preview.matchCount).toBe(2);
  });
});

describe("suggestionFromKind", () => {
  it("returns null for slug_list on a single path", () => {
    expect(suggestionFromKind("slug_list", ["/us/old-page"])).toBeNull();
  });
});
