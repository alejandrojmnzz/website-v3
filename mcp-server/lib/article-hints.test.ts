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

  it("informs always-share and stamps when adding a second article without toc_group", () => {
    const result = hintsAfterAddArticle({
      existingSections: [{ type: "article", content: "# A", show_toc: true }],
      newSection: { type: "article", content: "# B" },
      insertIndex: 1,
      slug: "test",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toContain("article_split_always_share");
    expect(result.next_actions.some((a) => a.tool === "update_section_fields")).toBe(true);
    const fields = result.next_actions[0]?.args_hint?.fields as Record<string, unknown>;
    expect(fields["sections.0.toc_group"]).toBeTruthy();
    expect(fields["sections.1.toc_group"]).toBe(fields["sections.0.toc_group"]);
    expect(fields["sections.0.show_toc"]).toBe(true);
    expect(fields["sections.1.show_toc"]).toBeUndefined();
    expect(result.next_actions[0]?.reason).not.toMatch(/ask the user/i);
    expect(result.next_actions[0]?.reason).not.toMatch(/stay separate/i);
  });

  it("still informs always-share when toc_group already matches", () => {
    const result = hintsAfterAddArticle({
      existingSections: [
        { type: "article", toc_group: "group_1", show_toc: true, content: "short" },
      ],
      newSection: { type: "article", toc_group: "group_1", content: "also short" },
      insertIndex: 1,
      slug: "test",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toContain("article_split_always_share");
    expect(result.warnings.map((w) => w.code)).not.toContain("article_toc_group_suggested");
  });

  it("warns when lead lacks show_toc but a later article has it", () => {
    const result = hintsAfterAddArticle({
      existingSections: [{ type: "article", content: "# A", show_toc: false }],
      newSection: { type: "article", content: "# B", show_toc: true, toc_group: "g1" },
      insertIndex: 1,
      slug: "test",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toContain("article_lead_toc_misconfigured");
  });

  it("warns when a later article has more content than the first", () => {
    const result = hintsAfterAddArticle({
      existingSections: [
        { type: "article", content: "word ", show_toc: true, toc_group: "g1" },
      ],
      newSection: {
        type: "article",
        content: "word ".repeat(400),
        toc_group: "g1",
      },
      insertIndex: 1,
      slug: "test",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toContain("article_lead_order_suspicious");
  });
});

describe("hintsAfterReplaceSections", () => {
  it("warns always-share when two articles lack a shared group", () => {
    const result = hintsAfterReplaceSections({
      sections: [
        { type: "article", content: "a" },
        { type: "cta_banner" },
        { type: "article", content: "b" },
      ],
      slug: "test",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toContain("article_split_always_share");
    expect(result.next_actions.some((a) => a.tool === "update_section_fields")).toBe(true);
  });
});
