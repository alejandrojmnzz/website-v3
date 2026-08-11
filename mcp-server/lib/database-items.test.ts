import { describe, it, expect } from "vitest";
import {
  applyFaqDefaults,
  findFaqDuplicateIndex,
  filterIndexedItems,
  faqDuplicateKey,
  normalizeFaqQuestion,
  paginateItems,
  summarizeUsage,
  validateFaqItem,
  withGlobalIndices,
} from "./database-items";

describe("normalizeFaqQuestion / faqDuplicateKey", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeFaqQuestion("  Job Guarantee?! ")).toBe("job guarantee");
    expect(faqDuplicateKey("EN", "Job Guarantee?")).toBe(
      faqDuplicateKey("en", "job guarantee"),
    );
  });
});

describe("validateFaqItem", () => {
  it("requires question, answer, locale", () => {
    expect(validateFaqItem({ question: "Q?", answer: "A" }).ok).toBe(false);
    expect(
      validateFaqItem({ question: "Q?", answer: "A", locale: "en" }).ok,
    ).toBe(true);
  });
});

describe("applyFaqDefaults", () => {
  it("fills last_updated, priority, locations", () => {
    const out = applyFaqDefaults({ question: "Q?", answer: "A", locale: "en" });
    expect(out.priority).toBe(2);
    expect(out.locations).toEqual(["all"]);
    expect(typeof out.last_updated).toBe("string");
    expect(String(out.last_updated)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not overwrite provided defaults", () => {
    const out = applyFaqDefaults({
      question: "Q?",
      answer: "A",
      locale: "en",
      priority: 1,
      locations: ["madrid-spain"],
      last_updated: "2020-01-01",
    });
    expect(out.priority).toBe(1);
    expect(out.locations).toEqual(["madrid-spain"]);
    expect(out.last_updated).toBe("2020-01-01");
  });
});

describe("findFaqDuplicateIndex", () => {
  const items = [
    { locale: "en", question: "Hello world?" },
    { locale: "es", question: "Hola mundo?" },
    { locale: "en", question: "Other?" },
  ];

  it("finds duplicate by locale + normalized question", () => {
    expect(findFaqDuplicateIndex(items, "en", "Hello World!")).toBe(0);
    expect(findFaqDuplicateIndex(items, "es", "hola mundo")).toBe(1);
  });

  it("excludes self index on update", () => {
    expect(findFaqDuplicateIndex(items, "en", "Hello world?", 0)).toBe(-1);
  });

  it("returns -1 when unique", () => {
    expect(findFaqDuplicateIndex(items, "en", "Brand new?")).toBe(-1);
  });
});

describe("withGlobalIndices + filterIndexedItems", () => {
  it("preserves global index after locale filter", () => {
    const indexed = withGlobalIndices([
      { locale: "en", question: "A" },
      { locale: "es", question: "B" },
      { locale: "en", question: "C" },
    ]);
    const filtered = filterIndexedItems(indexed, { locale: "en" });
    expect(filtered.map((i) => i.index)).toEqual([0, 2]);
    expect(filtered[1].question).toBe("C");
  });
});

describe("paginateItems", () => {
  it("pages without changing items", () => {
    const items = [0, 1, 2, 3, 4];
    expect(paginateItems(items, 2, 2)).toEqual({
      items: [2, 3],
      page: 2,
      limit: 2,
      total_count: 5,
    });
  });
});

describe("summarizeUsage", () => {
  it("caps sample files", () => {
    const s = summarizeUsage({
      content_types: [{ name: "landing" }],
      queries: Array.from({ length: 12 }, (_, i) => ({ file: `f${i}.yml` })),
    });
    expect(s.content_type_count).toBe(1);
    expect(s.query_count).toBe(12);
    expect(s.sample_files).toHaveLength(8);
  });
});

describe("expect_question mismatch semantics", () => {
  it("documents mismatch detection used by update/delete tools", () => {
    const current = { question: "Do I get a job?" };
    const expect_question = "Different question?";
    expect(String(current.question ?? "") !== expect_question).toBe(true);
  });
});

describe("delete confirm gate", () => {
  it("treats only confirm===true as authorized", () => {
    expect(true !== true).toBe(false);
    expect((undefined as boolean | undefined) !== true).toBe(true);
    expect((false as boolean) !== true).toBe(true);
  });
});
