import { describe, expect, it } from "vitest";
import { collectSectionSchemas, type SchemaComponentContext } from "./index";

const context: SchemaComponentContext = {
  locale: "en",
  // No fixture files needed: these tests only use inline `items` /
  // `hardcoded_entries`, which never touch the filesystem.
  contentRoot: "/nonexistent-content-root",
  baseUrl: "https://example.com",
};

function faqSection(
  items: Array<{ question: string; answer: string }>,
): Record<string, unknown> {
  return { type: "faq", title: "FAQ", items };
}

describe("collectSectionSchemas", () => {
  it("ignores sections without a registered contributor", () => {
    const schemas = collectSectionSchemas(
      [
        { type: "hero", title: "Hero" },
        { type: "listing", dynamic_entries: { content_type: "blog" } },
      ],
      context,
    );

    expect(schemas).toEqual([]);
  });

  it("emits FAQPage from a page mixing a listing component and a FAQ section", () => {
    const schemas = collectSectionSchemas(
      [
        { type: "listing", dynamic_entries: { content_type: "blog" } },
        faqSection([{ question: "Q1?", answer: "A1." }]),
      ],
      context,
    );

    expect(schemas).toHaveLength(1);
    expect(schemas[0]["@type"]).toBe("FAQPage");
    const mainEntity = schemas[0].mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity).toHaveLength(1);
    expect(mainEntity[0].name).toBe("Q1?");
  });

  it("merges multiple FAQ sections into one deduped FAQPage", () => {
    const schemas = collectSectionSchemas(
      [
        faqSection([
          { question: "What is AI?", answer: "First answer." },
          { question: "How long?", answer: "16 weeks." },
        ]),
        faqSection([
          { question: "what is ai? ", answer: "Duplicate answer." },
          { question: "Financing?", answer: "Yes." },
        ]),
      ],
      context,
    );

    expect(schemas).toHaveLength(1);
    const mainEntity = schemas[0].mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity.map((q) => q.name)).toEqual([
      "What is AI?",
      "How long?",
      "Financing?",
    ]);
    expect((mainEntity[0].acceptedAnswer as Record<string, unknown>).text).toBe("First answer.");
  });

  it("omits FAQPage when no FAQ section resolves any items", () => {
    const schemas = collectSectionSchemas(
      [{ type: "faq", title: "Empty FAQ" }, faqSection([])],
      context,
    );

    expect(schemas).toEqual([]);
  });

  it("resolves standalone root hardcoded_entries", () => {
    const schemas = collectSectionSchemas(
      [
        {
          type: "faq",
          title: "FAQ",
          hardcoded_entries: [
            { question: "Hardcoded question?", answer: "Hardcoded answer." },
          ],
        },
      ],
      context,
    );

    expect(schemas).toHaveLength(1);
    const mainEntity = schemas[0].mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity[0].name).toBe("Hardcoded question?");
  });

  it("emits BreadcrumbList documents before the merged FAQPage", () => {
    const schemas = collectSectionSchemas(
      [
        faqSection([{ question: "Q1?", answer: "A1." }]),
        {
          type: "breadcrumb",
          items: [
            { label: "Home", url: "/" },
            { label: "Current page" },
          ],
        },
      ],
      context,
    );

    expect(schemas.map((s) => s["@type"])).toEqual(["BreadcrumbList", "FAQPage"]);
    const elements = schemas[0].itemListElement as Array<Record<string, unknown>>;
    expect(elements[0].item).toBe("https://example.com/");
    expect(elements[1]).not.toHaveProperty("item");
  });

  it("skips breadcrumb sections without labeled items and dedupes identical documents", () => {
    const breadcrumb = {
      type: "breadcrumb",
      items: [{ label: "Home", url: "/" }, { label: "Page" }],
    };
    const schemas = collectSectionSchemas(
      [{ type: "breadcrumb", items: [] }, breadcrumb, { ...breadcrumb }],
      context,
    );

    expect(schemas).toHaveLength(1);
    expect(schemas[0]["@type"]).toBe("BreadcrumbList");
  });
});
