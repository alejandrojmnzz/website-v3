import { describe, expect, it } from "vitest";
import { heuristicIgnoreSuggestions } from "@shared/runtime-issues-ignore";
import { neighborIgnorePaths } from "./runtime-issues-ignore-suggest";

describe("neighborIgnorePaths", () => {
  it("prefers shared prefix and last segment", () => {
    const neighbors = neighborIgnorePaths(
      ["/us/old-blog/post-1"],
      ["/us/old-blog/post-2", "/us/other", "/es/old-blog/post-1"],
    );
    expect(neighbors).toContain("/us/old-blog/post-2");
    expect(neighbors).toContain("/es/old-blog/post-1");
    expect(neighbors).not.toContain("/us/other");
  });
});

describe("heuristicIgnoreSuggestions via suggest", () => {
  it("covers exact and locales without LLM", () => {
    const groups = heuristicIgnoreSuggestions(["/us/old-page"], ["us", "es"]);
    expect(groups.some((g) => g.rules[0]?.kind === "exact")).toBe(true);
    expect(groups.some((g) => g.rules[0]?.kind === "locales")).toBe(true);
  });
});
