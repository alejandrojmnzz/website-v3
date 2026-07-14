import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getContentTypeConfig,
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
