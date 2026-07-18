import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveFaqItems,
  buildFaqPageSchema,
  dedupeFaqItems,
  clearSsrSchemaCache,
  generateSsrSchemaHtml,
  generateDatabaseSsrHtml,
  type FaqSection,
} from "./ssr-schema";
import { contentIndex } from "./content-index";

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

describe("resolveFaqItems with standalone hardcoded_entries", () => {
  it("resolves root hardcoded_entries without dynamic_entries or related_features", () => {
    const section: FaqSection = {
      type: "faq",
      title: "FAQ",
      hardcoded_entries: [
        { question: "Do I need prior experience?", answer: "No prior experience required." },
      ],
    };
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items).toEqual([
      { question: "Do I need prior experience?", answer: "No prior experience required." },
    ]);
  });

  it("filters malformed hardcoded entries", () => {
    const section = {
      type: "faq",
      hardcoded_entries: [
        { question: "Valid?", answer: "Yes." },
        { question: "Missing answer?" },
        { answer: "Missing question." },
      ],
    } as unknown as FaqSection;
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items).toEqual([{ question: "Valid?", answer: "Yes." }]);
  });

  it("still prefers inline items over root hardcoded_entries", () => {
    const section: FaqSection = {
      type: "faq",
      items: [{ question: "Inline?", answer: "Inline answer." }],
      hardcoded_entries: [{ question: "Hardcoded?", answer: "Hardcoded answer." }],
    };
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items).toEqual([{ question: "Inline?", answer: "Inline answer." }]);
  });

  it("still merges root hardcoded_entries with dynamic database entries", () => {
    const section: FaqSection = {
      ...makeDynamicFaqSection(),
      hardcoded_entries: [{ question: "Hardcoded question?", answer: "Hardcoded answer." }],
    };
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items.map((i) => i.question)).toEqual([
      "Hardcoded question?",
      "Do I need expensive hardware for AI development?",
      "How long does the AI Engineering program take?",
    ]);
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function makeFakeCi(
  mergedData: Record<string, unknown> | null,
  isSharedTemplate = false,
): typeof contentIndex {
  return {
    resolveUrl: () => ({
      contentType: "landing",
      slug: "test-page",
      fromDatabase: false,
      params: { locale: "en" },
    }),
    loadMergedContent: () => ({
      data: mergedData,
      filePath: "/tmp/fake.yml",
      isSharedTemplate,
    }),
    loadCommonData: () => null,
    getLocaleUrls: () => ({}),
    resolveBaseSlug: (slug: string) => slug,
  } as unknown as typeof contentIndex;
}

describe("generateSsrSchemaHtml section schema dispatch (static pages)", () => {
  it("emits one FAQPage for a page mixing a listing component and FAQ sections", () => {
    const ci = makeFakeCi({
      sections: [
        { type: "listing", dynamic_entries: { content_type: "blog" } },
        { type: "faq", items: [{ question: "Q1?", answer: "A1." }] },
        { type: "faq", items: [{ question: "q1?", answer: "Duplicate." }, { question: "Q2?", answer: "A2." }] },
      ],
    });
    const html = generateSsrSchemaHtml("/en/test-page", ci, contentRoot);

    expect(countOccurrences(html, '"@type":"FAQPage"')).toBe(1);
    expect(countOccurrences(html, '"@type":"Question"')).toBe(2);
    expect(html).toContain("Q1?");
    expect(html).toContain("Q2?");
    expect(html).not.toContain("Duplicate.");
  });

  it("emits no FAQPage when FAQ sections resolve no items", () => {
    const ci = makeFakeCi({
      sections: [{ type: "faq", title: "Empty" }, { type: "hero", title: "Hero" }],
    });
    const html = generateSsrSchemaHtml("/en/test-page", ci, contentRoot);

    expect(html).not.toContain('"@type":"FAQPage"');
  });

  it("resolves {{ single.* }} vars in shared-template pages before contributing schema", () => {
    const ci = makeFakeCi(
      {
        title: "My Course",
        sections: [
          {
            type: "faq",
            hardcoded_entries: [
              { question: "About {{ single.title }}?", answer: "Answer for {{ single.title }}." },
            ],
          },
        ],
      },
      true,
    );
    const html = generateSsrSchemaHtml("/en/test-page", ci, contentRoot);

    expect(countOccurrences(html, '"@type":"FAQPage"')).toBe(1);
    expect(html).toContain("About My Course?");
    expect(html).toContain("Answer for My Course.");
    expect(html).not.toContain("{{ single.title }}");
  });
});

describe("generateDatabaseSsrHtml section schema dispatch (database/blog pages)", () => {
  function writeBlogTemplateFixture() {
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      `blog:
  directory: blog
  single_template: true
  url_pattern:
    en: /en/blog/:category/:slug
    es: /es/blog/:category/:slug
`,
      "utf-8",
    );

    const blogDir = path.join(contentRoot, "blog");
    fs.mkdirSync(blogDir, { recursive: true });
    fs.writeFileSync(
      path.join(blogDir, "single.en.yml"),
      `sections:
  - type: hero
    section_id: hero-1
    title: "{{ single.title }}"
  - type: breadcrumb
    section_id: breadcrumb-1
    items:
      - label: Home
        url: /
      - label: "{{ single.title }}"
  - type: faq
    section_id: faq-1
    title: Frequently Asked Questions
    hardcoded_entries:
      - question: Template question?
        answer: Template answer.
`,
      "utf-8",
    );

    const entryDir = path.join(blogDir, "my-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      `title: My Post
sections:
  - section_id: faq-1
    hardcoded_entries:
      - question: "About {{ single.title }}?"
        answer: Entry answer.
`,
      "utf-8",
    );
  }

  const record = {
    slug: "my-post",
    title: "My Post",
    description: "Post description",
    category: "learn",
    lang: "en",
    published_at: "2026-01-01",
  };

  it("emits FAQPage from the merged single template with per-entry overrides applied", () => {
    writeBlogTemplateFixture();
    const html = generateDatabaseSsrHtml("blog", record, "en", contentIndex, contentRoot);

    expect(html).toContain('"@type":"BlogPosting"');
    expect(countOccurrences(html, '"@type":"FAQPage"')).toBe(1);
    expect(html).toContain("About My Post?");
    expect(html).toContain("Entry answer.");
    expect(html).not.toContain("Template question?");
  });

  it("keeps a single BreadcrumbList on blog posts (synthetic trail only)", () => {
    writeBlogTemplateFixture();
    const html = generateDatabaseSsrHtml("blog", record, "en", contentIndex, contentRoot);

    expect(countOccurrences(html, '"@type":"BreadcrumbList"')).toBe(1);
    expect(html).toContain('"name":"Blog"');
  });

  it("falls back to the shared template FAQ when the entry has no override", () => {
    writeBlogTemplateFixture();
    const html = generateDatabaseSsrHtml(
      "blog",
      { ...record, slug: "another-post", title: "Another Post" },
      "en",
      contentIndex,
      contentRoot,
    );

    expect(countOccurrences(html, '"@type":"FAQPage"')).toBe(1);
    expect(html).toContain("Template question?");
    expect(html).toContain("Template answer.");
  });
});
