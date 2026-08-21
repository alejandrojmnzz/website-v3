import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRegistry } from "./content-types";
import { invalidateSeoIndexCache, loadSeoIndex, resetSeoOverlayField, writeSeoFields } from "./seo-index";
import type { ContentIndex } from "./content-index";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function stubCi(selfPath: string): ContentIndex {
  return {
    getAlternateUrls: () => ({ en: selfPath }),
    getRedirects: () => [],
    refreshCustomRedirects: () => [],
    isKnownUrl: (url: string) => url === selfPath || url.startsWith("/en/"),
    findBySlug: () => [],
  } as unknown as ContentIndex;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-index-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "blog", "post-a"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  url_pattern:
    en: /en/blog/:slug
  seo_monitoring:
    enabled: true
    require_cluster: true
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "en.yml"),
    `slug: post-a
content: |
  # Keep me
  markdown body
meta:
  page_title: Post A
  description: SEO
`,
    "utf-8",
  );
  resetRegistry();
  invalidateSeoIndexCache();
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  resetRegistry();
  invalidateSeoIndexCache();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("writeSeoFields", () => {
  it("does not yaml.dump the content: block", () => {
    const result = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "learn javascript" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    const text = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8");
    expect(text).toContain("content: |");
    expect(text).toContain("  # Keep me");
    expect(text).toContain("markdown body");
    expect(text).toContain("main_keyword: learn javascript");
  });

  it("does not index variant files", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "draft.en.yml"),
      `slug: post-a
meta:
  page_title: Draft
  description: Draft SEO
`,
      "utf-8",
    );
    const result = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "draft kw" },
      contentRoot,
      variant: "draft",
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.isVariantLayer).toBe(true);
    const index = loadSeoIndex(contentRoot);
    expect(index.entries["blog/post-a/en"]).toBeUndefined();
  });
});

describe("resetSeoOverlayField", () => {
  it("removes a seo: key and falls back to empty when no DB baseline", () => {
    writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "keep", pillar_path: "/en/blog/hub" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    const result = resetSeoOverlayField({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      fieldPath: "seo.pillar_path",
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    expect(result.noop).toBeFalsy();
    const text = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8");
    expect(text).toContain("main_keyword: keep");
    expect(text).not.toMatch(/pillar_path:/);
  });

  it("returns noop when key is absent", () => {
    const result = resetSeoOverlayField({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      fieldPath: "seo.main_keyword",
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
  });
});
