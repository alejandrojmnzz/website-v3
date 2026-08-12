import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasStaticSharedLayoutEntryLocale,
  loadMergedSinglePage,
} from "./database-single-loader";
import { resetRegistry } from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function writeTypes(extraUrlParams = false) {
  const urlPattern = extraUrlParams
    ? `  url_pattern:
    en: /en/blog/:category/:slug
    es: /es/blog/:category/:slug`
    : `  url_pattern:
    en: /en/blog/:slug
    es: /es/blog/:slug`;
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    description: description
    content: content
    category:
      source: category
      default: general
    _slug: slug
    _locale: locale
${urlPattern}
`,
    "utf-8",
  );
}

function writeSingleTemplates() {
  const blogDir = path.join(contentRoot, "blog");
  fs.mkdirSync(blogDir, { recursive: true });
  for (const loc of ["en", "es"]) {
    fs.writeFileSync(
      path.join(blogDir, `single.${loc}.yml`),
      [
        "meta:",
        '  page_title: "{{ single.title }}"',
        "sections:",
        "  - type: article",
        "    section_id: article-1",
        "    show_toc: true",
        '    content: "{{ single.content }}"',
        "",
      ].join("\n"),
      "utf-8",
    );
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-single-loader-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  writeTypes(true);
  writeSingleTemplates();
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("hasStaticSharedLayoutEntryLocale", () => {
  it("is false when the entry locale file is missing", () => {
    expect(
      hasStaticSharedLayoutEntryLocale("blog", "missing-slug", "es", contentRoot),
    ).toBe(false);
  });

  it("is true when {slug}/{locale}.yml exists", () => {
    const entryDir = path.join(contentRoot, "blog", "real-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "es.yml"), "title: Real\ncontent: Body\n", "utf-8");
    expect(
      hasStaticSharedLayoutEntryLocale("blog", "real-post", "es", contentRoot),
    ).toBe(true);
    expect(
      hasStaticSharedLayoutEntryLocale("blog", "real-post", "en", contentRoot),
    ).toBe(false);
  });
});

describe("loadMergedSinglePage static shared-layout", () => {
  it("returns null for a missing slug (no empty single.*.yml shell)", async () => {
    const page = await loadMergedSinglePage(
      "blog",
      "mejores-agentes-de-codigo8",
      "es",
      contentRoot,
    );
    expect(page).toBeNull();
  });

  it("returns the merged template when the entry locale exists", async () => {
    const entryDir = path.join(contentRoot, "blog", "real-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "_common.yml"),
      "category:\n  slug: herramientas-ia\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(entryDir, "es.yml"),
      "title: Real Post\ncontent: \"# Hello\"\n",
      "utf-8",
    );

    const page = await loadMergedSinglePage("blog", "real-post", "es", contentRoot);
    expect(page).not.toBeNull();
    expect(page?.sections?.some((s) => (s as { type?: string }).type === "article")).toBe(
      true,
    );
  });
});
