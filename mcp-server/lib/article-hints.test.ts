import { describe, expect, it } from "vitest";
import { hintsAfterAddArticle, hintsAfterReplaceSections } from "./article-hints";

describe("hintsAfterAddArticle", () => {
  it("is silent when adding the first article", () => {
    const result = hintsAfterAddArticle({
      existingSections: [{ type: "hero" }],
      newSection: { type: "article", content: "# Hi" },
      slug: "test",
      locale: "en",
    });
    expect(result.warnings).toEqual([]);
    expect(result.next_actions).toEqual([]);
  });

  it("warns when adding a second article without toc_group", () => {
    const result = hintsAfterAddArticle({
      existingSections: [{ type: "article", content: "# A", show_toc: true }],
      newSection: { type: "article", content: "# B" },
      insertIndex: 1,
      slug: "test",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toContain("article_toc_group_suggested");
    expect(result.next_actions.some((a) => a.tool === "update_section_fields")).toBe(true);
    const fields = result.next_actions[0]?.args_hint?.fields as Record<string, unknown>;
    expect(fields["sections.0.toc_group"]).toBeTruthy();
    expect(fields["sections.1.toc_group"]).toBe(fields["sections.0.toc_group"]);
    expect(fields["sections.0.show_toc"]).toBe(true);
    expect(fields["sections.1.show_toc"]).toBe(true);
  });

  it("is silent when all articles already share toc_group", () => {
    const result = hintsAfterAddArticle({
      existingSections: [
        { type: "article", toc_group: "group_1", show_toc: true },
      ],
      newSection: { type: "article", toc_group: "group_1", show_toc: true },
      insertIndex: 1,
      slug: "test",
      locale: "en",
    });
    expect(result.warnings).toEqual([]);
  });
});

describe("hintsAfterReplaceSections", () => {
  it("warns when two articles lack a shared group", () => {
    const result = hintsAfterReplaceSections({
      sections: [
        { type: "article", content: "a" },
        { type: "cta_banner" },
        { type: "article", content: "b" },
      ],
      slug: "test",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toContain("article_toc_group_suggested");
  });
});
