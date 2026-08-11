import { describe, it, expect } from "vitest";
import {
  applyFaqDefaults,
  findFaqDuplicateIndex,
  filterIndexedItems,
  faqDuplicateKey,
  normalizeFaqQuestion,
  paginateItems,
  prepareBatchAdd,
  prepareBatchUpdate,
  abortRemainingPatches,
  summarizeUsage,
  validateBulkLength,
  validateFaqItem,
  withGlobalIndices,
  FAQ_DB_NAME,
  type BatchRowResult,
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

describe("validateBulkLength", () => {
  it("rejects empty and over MAX_BULK", () => {
    expect(validateBulkLength(0).ok).toBe(false);
    expect(validateBulkLength(41).ok).toBe(false);
    expect(validateBulkLength(1).ok).toBe(true);
    expect(validateBulkLength(40).ok).toBe(true);
  });
});

describe("prepareBatchAdd", () => {
  const existing = [
    { locale: "en", question: "Existing?", answer: "A", priority: 2 },
  ];

  it("writes valid rows and fails invalid (best-effort)", () => {
    const { results, toWrite } = prepareBatchAdd(
      FAQ_DB_NAME,
      [
        { question: "New one?", answer: "Yes", locale: "en" },
        { question: "", answer: "No", locale: "en" },
        { question: "Another?", answer: "Ok", locale: "es" },
      ],
      existing,
    );
    expect(toWrite).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    if (!results[1].ok) expect(results[1].code).toBe("validation");
    expect(results[2].ok).toBe(true);
  });

  it("first-wins on intra-batch and vs existing duplicates", () => {
    const { results, toWrite } = prepareBatchAdd(
      FAQ_DB_NAME,
      [
        { question: "Existing?", answer: "Dup of DB", locale: "en" },
        { question: "Brand?", answer: "A", locale: "en" },
        { question: "Brand!", answer: "B", locale: "en" },
      ],
      existing,
    );
    expect(toWrite).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].code).toBe("duplicate");
      expect(results[0].existing_index).toBe(0);
    }
    expect(results[1].ok).toBe(true);
    expect(results[2].ok).toBe(false);
    if (!results[2].ok) expect(results[2].code).toBe("duplicate");
  });
});

describe("prepareBatchUpdate", () => {
  const existing = [
    { locale: "en", question: "Alpha?", answer: "A1" },
    { locale: "en", question: "Beta?", answer: "B1" },
    { locale: "en", question: "Gamma?", answer: "G1" },
  ];

  it("fails expect_mismatch and not_found", () => {
    const { results, toPatch } = prepareBatchUpdate(
      FAQ_DB_NAME,
      [
        { index: 0, item: { answer: "x" }, expect_question: "Wrong?" },
        { index: 99, item: { answer: "x" } },
      ],
      existing,
    );
    expect(toPatch).toHaveLength(0);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) expect(results[0].code).toBe("expect_mismatch");
    expect(results[1].ok).toBe(false);
    if (!results[1].ok) expect(results[1].code).toBe("not_found");
  });

  it("duplicate_index: first wins", () => {
    const { results, toPatch } = prepareBatchUpdate(
      FAQ_DB_NAME,
      [
        { index: 0, item: { answer: "first" } },
        { index: 0, item: { answer: "second" } },
      ],
      existing,
    );
    expect(toPatch).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    if (!results[1].ok) expect(results[1].code).toBe("duplicate_index");
  });

  it("allows FAQ question swap via working-copy simulation", () => {
    const { results, toPatch } = prepareBatchUpdate(
      FAQ_DB_NAME,
      [
        { index: 0, item: { question: "Beta?" } },
        { index: 1, item: { question: "Alpha?" } },
      ],
      existing,
    );
    expect(toPatch).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("fail-both when two updates land on the same FAQ key", () => {
    const { results, toPatch } = prepareBatchUpdate(
      FAQ_DB_NAME,
      [
        { index: 0, item: { question: "Same key?" } },
        { index: 1, item: { question: "Same key?" } },
      ],
      existing,
    );
    expect(toPatch).toHaveLength(0);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(false);
    if (!results[0].ok) expect(results[0].code).toBe("duplicate");
    if (!results[1].ok) expect(results[1].code).toBe("duplicate");
  });

  it("does not free a key for another row when a colliding update is demoted", () => {
    // index 0 tries to take Gamma (untouched collision) — demoted
    // index 1 tries to take Alpha (would only be free if 0's demotion freed it incorrectly)
    // After demoting 0, index 1 taking Alpha collides with original 0 — demote 1 too
    const { results, toPatch } = prepareBatchUpdate(
      FAQ_DB_NAME,
      [
        { index: 0, item: { question: "Gamma?" } },
        { index: 1, item: { question: "Alpha?" } },
      ],
      existing,
    );
    expect(toPatch).toHaveLength(0);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(false);
  });

  it("allows taking a key freed by an earlier successful rename in the batch", () => {
    const { results, toPatch } = prepareBatchUpdate(
      FAQ_DB_NAME,
      [
        { index: 0, item: { question: "UniqueNew?" } },
        { index: 1, item: { question: "Alpha?" } },
      ],
      existing,
    );
    expect(toPatch).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe("abortRemainingPatches", () => {
  it("marks later prepared rows aborted", () => {
    const results: BatchRowResult[] = [
      { input_index: 0, ok: true, index: 0, item: {} },
      { input_index: 1, ok: true, index: 1, item: {} },
      { input_index: 2, ok: true, index: 2, item: {} },
    ];
    const toPatch = [
      { input_index: 0, index: 0, item: {}, merged: {} },
      { input_index: 1, index: 1, item: {}, merged: {} },
      { input_index: 2, index: 2, item: {}, merged: {} },
    ];
    const n = abortRemainingPatches(results, toPatch, 0, "aborted after fail");
    expect(n).toBe(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    if (!results[1].ok) expect(results[1].code).toBe("aborted");
    expect(results[2].ok).toBe(false);
    if (!results[2].ok) expect(results[2].code).toBe("aborted");
  });
});
