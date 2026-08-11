import { describe, expect, it } from "vitest";
import {
  resolveHardcodedEntriesForDynamic,
  resolveSearchPhraseForDynamic,
  mergeFaqItemsWithLimit,
} from "./dynamic-entries";

describe("resolveHardcodedEntriesForDynamic", () => {
  it("resolves {{ single.faq_entries }} to the JSON array from the bag", () => {
    const faqs = [
      { question: "What is Art. 4?", answer: "AI literacy obligation." },
    ];
    expect(
      resolveHardcodedEntriesForDynamic("{{ single.faq_entries | [] }}", {
        faq_entries: faqs,
      }),
    ).toEqual(faqs);
  });

  it("returns [] for unresolved binds with [] fallback", () => {
    expect(resolveHardcodedEntriesForDynamic("{{ single.faq_entries | [] }}")).toEqual(
      [],
    );
  });

  it("passes through literal arrays", () => {
    const faqs = [{ question: "Q?", answer: "A." }];
    expect(resolveHardcodedEntriesForDynamic(faqs)).toEqual(faqs);
  });

  it("returns [] for non-array unresolved values", () => {
    expect(resolveHardcodedEntriesForDynamic("not-a-bind")).toEqual([]);
  });
});

describe("resolveSearchPhraseForDynamic", () => {
  it("resolves {{ single.title }} for semantic search", () => {
    expect(
      resolveSearchPhraseForDynamic(
        "{{ single.title | ¿Qué significa ser Full Stack? }}",
        { title: "Qué es el artículo 4 del Reglamento de IA" },
      ),
    ).toBe("Qué es el artículo 4 del Reglamento de IA");
  });

  it("uses pipe fallback when title is missing", () => {
    expect(
      resolveSearchPhraseForDynamic(
        "{{ single.title | ¿Qué significa ser Full Stack? }}",
        {},
      ),
    ).toBe("¿Qué significa ser Full Stack?");
  });

  it("trims plain search strings", () => {
    expect(resolveSearchPhraseForDynamic("  hello world  ")).toBe("hello world");
  });
});

describe("mergeFaqItemsWithLimit", () => {
  const hard = [
    { question: "H1", answer: "a" },
    { question: "H2", answer: "b" },
    { question: "H3", answer: "c" },
  ];
  const db = [
    { question: "D1", answer: "d" },
    { question: "D2", answer: "e" },
  ];

  it("returns all items when limit is unset", () => {
    expect(mergeFaqItemsWithLimit(hard, db)).toEqual([...hard, ...db]);
  });

  it("caps total at limit with hardcoded first", () => {
    expect(mergeFaqItemsWithLimit(hard, db, 2)).toEqual([
      { question: "H1", answer: "a" },
      { question: "H2", answer: "b" },
    ]);
    expect(mergeFaqItemsWithLimit(hard, db, 4)).toEqual([
      ...hard,
      { question: "D1", answer: "d" },
    ]);
  });

  it("fills remaining slots from DB when hardcoded is shorter than limit", () => {
    expect(mergeFaqItemsWithLimit(hard.slice(0, 1), db, 3)).toEqual([
      { question: "H1", answer: "a" },
      { question: "D1", answer: "d" },
      { question: "D2", answer: "e" },
    ]);
  });
});
