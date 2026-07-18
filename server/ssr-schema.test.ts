import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveFaqItems,
  buildFaqPageSchema,
  dedupeFaqItems,
  clearSsrSchemaCache,
  type FaqSection,
} from "./ssr-schema";

let tempDir: string;
let contentRoot: string;

function writeFaqDatabaseFixture() {
  const dbDir = path.join(contentRoot, "db", "frequently_asked_questions");
  fs.mkdirSync(dbDir, { recursive: true });

  fs.writeFileSync(
    path.join(dbDir, "config.yml"),
    `name: frequently asked questions
source:
  type: local
  local:
    filename: faqs.yml
    results_path: faqs
field_mapping:
  locale: locale
  question: question
  answer: answer
  locations: locations
  related_features: related_features
  priority: priority
`,
    "utf-8",
  );

  fs.writeFileSync(
    path.join(dbDir, "faqs.yml"),
    `faqs:
  - locale: en
    question: Do I need expensive hardware for AI development?
    answer: No, all exercises run in the cloud.
    locations:
      - all
    related_features:
      - ai-engineering
    priority: 3
  - locale: en
    question: How long does the AI Engineering program take?
    answer: About 16 weeks full time.
    locations:
      - all
    related_features:
      - ai-engineering
    priority: 1
  - locale: en
    question: Do you offer financing?
    answer: Yes, multiple financing options.
    locations:
      - all
    related_features:
      - financing
    priority: 2
  - locale: es
    question: Necesito hardware costoso para desarrollo de IA?
    answer: No, todos los ejercicios corren en la nube.
    locations:
      - all
    related_features:
      - ai-engineering
    priority: 3
  - locale: en
    question: Is this only for Madrid students?
    answer: This applies to Madrid only.
    locations:
      - madrid-spain
    related_features:
      - ai-engineering
    priority: 2
`,
    "utf-8",
  );
}

function makeDynamicFaqSection(
  overrides: Partial<NonNullable<FaqSection["dynamic_entries"]>> = {},
): FaqSection {
  return {
    type: "faq",
    title: "FAQ",
    dynamic_entries: {
      database: "frequently_asked_questions",
      limit: 9,
      permanent_filters: [
        { item_property_slug: "related_features", value: ["ai-engineering"] },
        { item_property_slug: "locations", value: "all" },
      ],
      ...overrides,
    },
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssr-schema-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  writeFaqDatabaseFixture();
  clearSsrSchemaCache();
});

afterEach(() => {
  clearSsrSchemaCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveFaqItems with dynamic_entries", () => {
  it("resolves database-backed FAQ entries filtered by locale and permanent filters", () => {
    const items = resolveFaqItems(makeDynamicFaqSection(), "en", undefined, "ai-engineering", contentRoot);

    expect(items.map((i) => i.question)).toEqual([
      "Do I need expensive hardware for AI development?",
      "How long does the AI Engineering program take?",
    ]);
    expect(items[0].answer).toBe("No, all exercises run in the cloud.");
  });

  it("filters by locale", () => {
    const items = resolveFaqItems(makeDynamicFaqSection(), "es", undefined, undefined, contentRoot);

    expect(items).toHaveLength(1);
    expect(items[0].question).toBe("Necesito hardware costoso para desarrollo de IA?");
  });

  it("applies limit after prepending hardcoded entries", () => {
    const section = makeDynamicFaqSection({
      limit: 2,
      hardcoded_entries: [{ question: "Hardcoded question?", answer: "Hardcoded answer." }],
    });
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items).toHaveLength(2);
    expect(items[0].question).toBe("Hardcoded question?");
  });

  it("excludes ignored entries by slug key", () => {
    const section = makeDynamicFaqSection({
      ignored_entries: ["how-long-does-the-ai-engineering-program-take"],
    });
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items.map((i) => i.question)).toEqual([
      "Do I need expensive hardware for AI development?",
    ]);
  });

  it("returns empty array when database does not exist", () => {
    const section = makeDynamicFaqSection({ database: "nonexistent_db" });
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items).toEqual([]);
  });

  it("still prefers inline items over dynamic entries", () => {
    const section: FaqSection = {
      ...makeDynamicFaqSection(),
      items: [{ question: "Inline question?", answer: "Inline answer." }],
    };
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items).toEqual([{ question: "Inline question?", answer: "Inline answer." }]);
  });
});

describe("buildFaqPageSchema", () => {
  it("produces a FAQPage schema with Question mainEntity", () => {
    const schema = buildFaqPageSchema([
      { question: "Q1?", answer: "A1." },
      { question: "Q2?", answer: "A2." },
    ]);

    expect(schema["@type"]).toBe("FAQPage");
    expect(schema["@context"]).toBe("https://schema.org");
    const mainEntity = schema.mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity).toHaveLength(2);
    expect(mainEntity[0]).toEqual({
      "@type": "Question",
      name: "Q1?",
      acceptedAnswer: { "@type": "Answer", text: "A1." },
    });
  });
});

describe("dedupeFaqItems", () => {
  it("removes duplicate questions case-insensitively, keeping first occurrence", () => {
    const result = dedupeFaqItems([
      { question: "What is AI?", answer: "First answer." },
      { question: "what is ai? ", answer: "Second answer." },
      { question: "Other question?", answer: "Other answer." },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].answer).toBe("First answer.");
  });
});
