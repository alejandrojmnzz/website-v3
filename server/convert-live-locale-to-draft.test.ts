import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convertLiveLocaleToDraft, TEMPLATE_CONVERT_BLOCKED } from "./convert-live-locale-to-draft";
import { resetRegistry } from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function writeLandingTypes() {
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `landing:
  directory: landings
  field_mapping:
    title: title
    description: description
  url_pattern:
    en: /landing/:slug
    es: /es/landing/:slug
blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    description: description
  url_pattern:
    en: /en/blog/:slug
    es: /es/blog/:slug
`,
    "utf-8",
  );
}

function writeLanding(slug: string, locales: string[]) {
  const dir = path.join(contentRoot, "landings", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "_common.yml"), `title: ${slug}\n`, "utf-8");
  for (const loc of locales) {
    fs.writeFileSync(
      path.join(dir, `${loc}.yml`),
      `meta:\n  page_title: ${slug} ${loc}\n  description: Desc\nsections:\n  - type: hero\n    id: hero-1\n    data:\n      title: Hello\n`,
      "utf-8",
    );
  }
  return dir;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convert-live-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  writeLandingTypes();
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("convertLiveLocaleToDraft", () => {
  it("renames the last live locale to draft and registers versioning", () => {
    const dir = writeLanding("hello", ["en"]);
    const result = convertLiveLocaleToDraft({
      contentType: "landing",
      slug: "hello",
      locale: "en",
      contentRoot,
      author: "test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lastLiveLocale).toBe(true);
    expect(result.variantSlug).toBe("draft");
    expect(fs.existsSync(path.join(dir, "en.yml"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "draft.en.yml"))).toBe(true);
    const versioning = fs.readFileSync(path.join(dir, "versioning.yml"), "utf-8");
    expect(versioning).toMatch(/slug:\s*draft/);
    expect(versioning).toMatch(/allocation:\s*0/);
  });

  it("leaves a sibling live locale published", () => {
    const dir = writeLanding("hello", ["en", "es"]);
    const result = convertLiveLocaleToDraft({
      contentType: "landing",
      slug: "hello",
      locale: "en",
      contentRoot,
      author: "test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lastLiveLocale).toBe(false);
    expect(fs.existsSync(path.join(dir, "en.yml"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "draft.en.yml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "es.yml"))).toBe(true);
  });

  it("does not overwrite an existing draft file", () => {
    const dir = writeLanding("hello", ["en"]);
    fs.writeFileSync(path.join(dir, "draft.en.yml"), "meta:\n  page_title: Existing\n", "utf-8");

    const result = convertLiveLocaleToDraft({
      contentType: "landing",
      slug: "hello",
      locale: "en",
      contentRoot,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, status: 409 }),
    );
    expect(fs.existsSync(path.join(dir, "en.yml"))).toBe(true);
  });

  it("returns 404 when the live file is missing", () => {
    writeLanding("hello", ["es"]);
    const result = convertLiveLocaleToDraft({
      contentType: "landing",
      slug: "hello",
      locale: "en",
      contentRoot,
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 404 }));
  });

  it("blocks converting the shared template slug", () => {
    const result = convertLiveLocaleToDraft({
      contentType: "blog",
      slug: "single",
      locale: "en",
      contentRoot,
    });
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: TEMPLATE_CONVERT_BLOCKED,
    });
  });

  it("blocks attached shared-layout entries until detached", () => {
    const entryDir = path.join(contentRoot, "blog", "my-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "_common.yml"), "title: Post\n", "utf-8");
    fs.writeFileSync(path.join(entryDir, "en.yml"), "slug: my-post\n", "utf-8");

    const result = convertLiveLocaleToDraft({
      contentType: "blog",
      slug: "my-post",
      locale: "en",
      contentRoot,
    });
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: TEMPLATE_CONVERT_BLOCKED,
    });
    expect(fs.existsSync(path.join(entryDir, "en.yml"))).toBe(true);
  });

  it("allows a detached shared-layout entry", () => {
    const entryDir = path.join(contentRoot, "blog", "my-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "_common.yml"), "title: Post\ndetached: true\n", "utf-8");
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      "meta:\n  page_title: Post\n  description: Desc\nsections:\n  - type: hero\n    id: h1\n    data:\n      title: Hi\n",
      "utf-8",
    );

    const result = convertLiveLocaleToDraft({
      contentType: "blog",
      slug: "my-post",
      locale: "en",
      contentRoot,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(entryDir, "en.yml"))).toBe(false);
    expect(fs.existsSync(path.join(entryDir, "draft.en.yml"))).toBe(true);
  });

  it("leaves extra variants unchanged", () => {
    const dir = writeLanding("hello", ["en"]);
    fs.writeFileSync(path.join(dir, "colorful.en.yml"), "meta:\n  page_title: Colorful\n", "utf-8");
    fs.writeFileSync(
      path.join(dir, "versioning.yml"),
      "en:\n  variants:\n    - slug: colorful\n      allocation: 0\n",
      "utf-8",
    );

    const result = convertLiveLocaleToDraft({
      contentType: "landing",
      slug: "hello",
      locale: "en",
      contentRoot,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(dir, "colorful.en.yml"))).toBe(true);
    const versioning = fs.readFileSync(path.join(dir, "versioning.yml"), "utf-8");
    expect(versioning).toMatch(/slug:\s*colorful/);
    expect(versioning).toMatch(/slug:\s*draft/);
  });
});
