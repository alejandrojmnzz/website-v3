import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractUrlPatternParams,
  getContentTypeConfig,
  listExtraUrlPatternParams,
  resetRegistry,
  updateContentTypeConfig,
} from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "content-types-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  field_mapping:
    _slug: slug
    _locale: lang
    title: title
    slug: slug
  database:
    slug: blog_posts
  url_pattern:
    en: /en/blog/:slug
    es: /es/blog/:slug
`,
    "utf-8",
  );
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("updateContentTypeConfig database unlink", () => {
  it("removes the database key when database is null", () => {
    const before = getContentTypeConfig("blog", contentRoot);
    expect(before?.database?.slug).toBe("blog_posts");

    updateContentTypeConfig(
      "blog",
      {
        database: null,
        field_mapping: { slug: "slug", title: "title" },
      },
      contentRoot,
    );

    resetRegistry(contentRoot);
    const after = getContentTypeConfig("blog", contentRoot);
    expect(after?.database).toBeUndefined();
    expect(after?.field_mapping).toEqual({ slug: "slug", title: "title" });
    expect(after?.url_pattern.en).toBe("/en/blog/:slug");

    const raw = fs.readFileSync(path.join(contentRoot, "content-types.yml"), "utf-8");
    expect(raw).not.toMatch(/database:/);
    expect(raw).not.toMatch(/blog_posts/);
  });

  it("still merges database slug updates when an object is passed", () => {
    updateContentTypeConfig("blog", { database: { slug: "other_db" } }, contentRoot);
    resetRegistry(contentRoot);
    const after = getContentTypeConfig("blog", contentRoot);
    expect(after?.database?.slug).toBe("other_db");
  });
});

describe("extractUrlPatternParams", () => {
  it("resolves multi-variable patterns from entry data, including nested object slugs", () => {
    const { params, missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { slug: "my-post", category: { slug: "uncategorized" } },
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ category: "uncategorized" });
  });

  it("resolves plain string fields and ignores slug/locale placeholders", () => {
    const { params, missing } = extractUrlPatternParams(
      "/:locale/posts/:author/:year/:slug",
      { author: "jane", year: 2026 },
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ author: "jane", year: "2026" });
  });

  it("reports missing variables instead of resolving them to empty strings", () => {
    const { params, missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { slug: "my-post" },
    );
    expect(missing).toEqual(["category"]);
    expect(params).toEqual({});
  });

  it("treats empty values as missing", () => {
    const { missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { slug: "my-post", category: { slug: "" } },
    );
    expect(missing).toEqual(["category"]);
  });

  it("uses field mapping to resolve variables from mapped source fields", () => {
    const { params, missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { category_name: "trends-and-tech" },
      { category: "category_name" },
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ category: "trends-and-tech" });
  });
});

describe("listExtraUrlPatternParams", () => {
  it("collects unique extra params across locale patterns", () => {
    expect(
      listExtraUrlPatternParams({
        en: "/en/blog/:category/:slug",
        es: "/es/blog/:category/:slug",
      }),
    ).toEqual(["category"]);
  });

  it("ignores slug and locale placeholders", () => {
    expect(
      listExtraUrlPatternParams({
        default: "/:locale/posts/:author/:slug",
      }),
    ).toEqual(["author"]);
  });

  it("returns empty for slug-only patterns", () => {
    expect(listExtraUrlPatternParams({ en: "/en/:slug" })).toEqual([]);
  });
});
