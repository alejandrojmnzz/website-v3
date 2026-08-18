import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { schemaCompletenessValidator, resolvePageSections } from "./schema-completeness";
import type { ContentFile, ValidationContext } from "../shared/types";

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "schema-completeness-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function context(file: ContentFile): ValidationContext {
  return {
    contentFiles: [file],
    redirectMap: new Map(),
    validUrls: new Set(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };
}

function baseFile(overrides: Partial<ContentFile> & Pick<ContentFile, "filePath">): ContentFile {
  return {
    slug: "home",
    title: "Home",
    type: "page",
    locale: "en",
    url: "/en",
    ...overrides,
  };
}

describe("resolvePageSections", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("prefers merged entryFields.sections over disk", () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections:\n  - type: hero\n");

    const sections = resolvePageSections(
      baseFile({
        filePath,
        entryFields: {
          sections: [{ type: "schema_org", schema_type: "WebSite" }],
        },
      }),
    );
    expect(sections.map((s) => s.type)).toEqual(["schema_org"]);
  });

  it("parses unquoted {{ template vars }} on disk instead of returning []", () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(
      filePath,
      [
        "sections:",
        "  - type: schema_org",
        "    schema_type: WebSite",
        "  - type: graduates_stats",
        "    stats:",
        "      - value: {{ global.global_job_placement_rate | 84% }}%",
        "        label: Average hiring rate",
        "",
      ].join("\n"),
    );

    const sections = resolvePageSections(baseFile({ filePath }));
    expect(sections.map((s) => s.type)).toEqual(["schema_org", "graduates_stats"]);
  });
});

describe("schemaCompletenessValidator PAGE_NO_SCHEMA", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("does not flag pages whose YAML has schema_org plus unquoted template vars", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(
      filePath,
      [
        "sections:",
        "  - type: schema_org",
        "    schema_type: Course",
        "  - type: hero",
        "    features:",
        "      - text: {{ global.ai_engineering_program_tracks | 22 Weeks }}",
        "",
      ].join("\n"),
    );

    const result = await schemaCompletenessValidator.run(
      context(baseFile({ slug: "ai-engineering", type: "program", filePath, url: "/en/career-programs/ai-engineering" })),
    );
    expect(result.warnings.filter((w) => w.code === "PAGE_NO_SCHEMA")).toEqual([]);
    expect(result.artifacts?.pagesWithSchema).toBe(1);
  });

  it("does not flag when merged entryFields has schema_org even if the file is unreadable YAML", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections: [this is: : not: valid\n");

    const result = await schemaCompletenessValidator.run(
      context(
        baseFile({
          filePath,
          entryFields: {
            sections: [{ type: "schema_org", schema_type: "WebSite" }],
          },
        }),
      ),
    );
    expect(result.warnings.filter((w) => w.code === "PAGE_NO_SCHEMA")).toEqual([]);
  });

  it("still flags pages with no schema contributors", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections:\n  - type: hero\n");

    const result = await schemaCompletenessValidator.run(
      context(
        baseFile({
          filePath,
          entryFields: { sections: [{ type: "hero" }] },
        }),
      ),
    );
    expect(result.warnings.some((w) => w.code === "PAGE_NO_SCHEMA")).toBe(true);
    expect(result.artifacts?.pagesWithoutSchema).toBe(1);
  });
});
