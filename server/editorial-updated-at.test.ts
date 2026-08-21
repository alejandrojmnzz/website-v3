import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toSitemapLastmod } from "@shared/normalizeFlexibleDate";
import { resetRegistry, resolveEntryUpdatedAt, resolveEntryUpdatedAtDetail } from "./content-types";
import {
  applyEditorialUpdatedAtToData,
  operationsTouchEditorialContent,
  updatesTouchEditorialContent,
} from "./editorial-updated-at";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

const PUBLISHED = "2024-01-10T00:00:00.000Z";
const YAML_UPDATED = "2025-06-01T12:00:00.000Z";
const MANUAL = "2023-02-02T00:00:00.000Z";
const NOW = "2026-08-18T15:00:00.000Z";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editorial-updated-at-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "blog", "post-a"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    published_at: published_at
    _slug: slug
    _locale: locale
    _updated_at: updated_at
  url_pattern:
    en: /en/blog/:slug
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "_common.yml"),
    `title: Post A\npublished_at: ${PUBLISHED}\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "en.yml"),
    "slug: post-a\nsections: []\n",
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

describe("resolveEntryUpdatedAt", () => {
  it("uses locale YAML updated_at when present", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      `slug: post-a\nupdated_at: ${YAML_UPDATED}\n`,
      "utf-8",
    );
    const detail = resolveEntryUpdatedAtDetail({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      isDb: false,
    });
    expect(detail).toEqual({ iso: YAML_UPDATED, source: "yaml" });
  });

  it("falls back to published_at when YAML updated_at is missing", () => {
    const iso = resolveEntryUpdatedAt({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      isDb: false,
    });
    expect(iso).toBe(PUBLISHED);
    expect(
      resolveEntryUpdatedAtDetail({
        contentType: "blog",
        slug: "post-a",
        locale: "en",
        contentRoot,
        isDb: false,
      }).source,
    ).toBe("published_at");
  });

  it("never uses today or sync-state when YAML and published_at are absent", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "_common.yml"),
      "title: Post A\n",
      "utf-8",
    );
    const iso = resolveEntryUpdatedAt({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      isDb: false,
    });
    expect(iso).toBeNull();
  });

  it("prefers record.updated_at over published_at", () => {
    const iso = resolveEntryUpdatedAt({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      record: { updated_at: YAML_UPDATED, published_at: PUBLISHED },
      contentRoot,
      isDb: false,
    });
    expect(iso).toBe(YAML_UPDATED);
  });
});

describe("operationsTouchEditorialContent", () => {
  const previous = {
    title: "Old",
    meta: { page_title: "Old | Site", description: "Old desc", robots: "index, follow" },
    sections: [
      {
        type: "hero",
        section_id: "abc",
        paddingY: { desktop: "sm" },
        data: { title: "Hello" },
      },
    ],
  };

  it("bumps on title, meta description, and section image/copy", () => {
    expect(
      operationsTouchEditorialContent(
        [{ action: "update_field", path: "title", value: "New" }],
        previous,
      ),
    ).toBe(true);
    expect(
      operationsTouchEditorialContent(
        [{ action: "update_field", path: "meta.description", value: "New desc" }],
        previous,
      ),
    ).toBe(true);
    expect(
      operationsTouchEditorialContent(
        [{ action: "update_field", path: "meta", value: { ...previous.meta, page_title: "New | Site" } }],
        previous,
      ),
    ).toBe(true);
    expect(
      operationsTouchEditorialContent(
        [{ action: "update_field", path: "sections.0.data.title", value: "Hi" }],
        previous,
      ),
    ).toBe(true);
    expect(
      operationsTouchEditorialContent(
        [
          {
            action: "update_section",
            index: 0,
            section: {
              type: "hero",
              section_id: "abc",
              paddingY: { desktop: "lg" },
              data: { title: "Hello", image: { src: "https://example.com/a.png" } },
            },
          },
        ],
        previous,
      ),
    ).toBe(true);
  });

  it("does not bump on seo, robots, reorder, or layout-only section edits", () => {
    expect(
      operationsTouchEditorialContent(
        [{ action: "update_field", path: "seo.pillar_path", value: "/en/hub" }],
        previous,
      ),
    ).toBe(false);
    expect(
      operationsTouchEditorialContent(
        [{ action: "update_field", path: "meta.robots", value: "noindex" }],
        previous,
      ),
    ).toBe(false);
    expect(
      operationsTouchEditorialContent(
        [{ action: "update_field", path: "meta", value: { ...previous.meta, robots: "noindex" } }],
        previous,
      ),
    ).toBe(false);
    expect(
      operationsTouchEditorialContent(
        [{ action: "reorder_sections", from: 0, to: 0 }],
        previous,
      ),
    ).toBe(false);
    expect(
      operationsTouchEditorialContent(
        [{ action: "update_field", path: "sections.0.paddingY", value: { desktop: "lg" } }],
        previous,
      ),
    ).toBe(false);
    expect(
      operationsTouchEditorialContent(
        [
          {
            action: "update_section",
            index: 0,
            section: {
              type: "hero",
              section_id: "abc",
              paddingY: { desktop: "xl" },
              showOn: ["desktop"],
              data: { title: "Hello" },
            },
          },
        ],
        previous,
      ),
    ).toBe(false);
    expect(updatesTouchEditorialContent({ "seo.pillar_path": "/en/hub" })).toBe(false);
    expect(updatesTouchEditorialContent({ title: "New" })).toBe(true);
    expect(updatesTouchEditorialContent({ updated_at: MANUAL })).toBe(false);
  });
});

describe("applyEditorialUpdatedAtToData", () => {
  it("persists published_at seed on non-whitelist save when empty", () => {
    const data: Record<string, unknown> = { slug: "post-a", sections: [] };
    const result = applyEditorialUpdatedAtToData({
      data,
      previous: { ...data },
      operations: [{ action: "update_field", path: "meta.robots", value: "noindex" }],
      contentType: "blog",
      slug: "post-a",
      contentRoot,
      now: NOW,
    });
    expect(result.kind).toBe("seed");
    expect(data.updated_at).toBe(PUBLISHED);
    expect(data._updated_at).toBeUndefined();
  });

  it("keeps a manual updated_at until a whitelist save overwrites with now", () => {
    const data: Record<string, unknown> = { slug: "post-a", updated_at: MANUAL };
    const keep = applyEditorialUpdatedAtToData({
      data,
      previous: { ...data },
      operations: [{ action: "update_field", path: "meta.robots", value: "noindex" }],
      contentType: "blog",
      slug: "post-a",
      contentRoot,
      now: NOW,
    });
    expect(keep.kind).toBe("keep");
    expect(data.updated_at).toBe(MANUAL);

    const bump = applyEditorialUpdatedAtToData({
      data,
      previous: { ...data, title: "Old" },
      operations: [{ action: "update_field", path: "title", value: "New" }],
      contentType: "blog",
      slug: "post-a",
      contentRoot,
      now: NOW,
    });
    expect(bump.kind).toBe("now");
    expect(data.updated_at).toBe(NOW);
  });
});

describe("sitemap lastmod from editorial resolver", () => {
  it("uses toSitemapLastmod(resolved, false) and does not fall back to today", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      `slug: post-a\nupdated_at: ${YAML_UPDATED}\n`,
      "utf-8",
    );
    const iso = resolveEntryUpdatedAt({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      isDb: false,
    });
    expect(toSitemapLastmod(iso, false)).toBe("2025-06-01");

    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      "slug: post-a\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "_common.yml"),
      "title: Post A\n",
      "utf-8",
    );
    const missing = resolveEntryUpdatedAt({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      isDb: false,
    });
    expect(missing).toBeNull();
    expect(toSitemapLastmod(missing, false)).toBe("");
    const today = new Date().toISOString().slice(0, 10);
    expect(toSitemapLastmod(missing, false)).not.toBe(today);
  });
});
