import { describe, expect, it } from "vitest";
import {
  extractSeoUpdatesFromOps,
  migrateMainKeywordInYamlText,
  surgicalReplaceSeoBlock,
  validateSeoSave,
  yamlHasSeoKey,
} from "./seo-fields";
import type { ContentIndex } from "./content-index";

function stubCi(selfPath = "/en/blog/learn-js/learn-js"): ContentIndex {
  return {
    getAlternateUrls: () => ({ en: selfPath }),
    getRedirects: () => [],
    refreshCustomRedirects: () => [],
    isKnownUrl: (url: string) => url === selfPath,
    findBySlug: () => [],
  } as unknown as ContentIndex;
}

describe("surgicalReplaceSeoBlock", () => {
  it("inserts seo: without dumping the rest of the file", () => {
    const original = `slug: learn-js
content: |
  # Hello
  keep this body
meta:
  page_title: Learn JS
`;
    const next = surgicalReplaceSeoBlock(original, { main_keyword: "learn javascript" });
    expect(next).toContain("content: |");
    expect(next).toContain("  # Hello");
    expect(next).toContain("keep this body");
    expect(next).toMatch(/^seo:\n  main_keyword: learn javascript$/m);
  });

  it("replaces an existing seo block in place", () => {
    const original = `title: Post
seo:
  pillar: /en/old
  main_keyword: js
content: |
  body stays
`;
    const next = surgicalReplaceSeoBlock(original, {
      main_keyword: "javascript",
      pillar_path: "/en/blog/js/js",
    });
    expect(next).not.toContain("pillar:");
    expect(next).toContain("pillar_path: /en/blog/js/js");
    expect(next).toContain("content: |\n  body stays");
  });
});

describe("migrateMainKeywordInYamlText", () => {
  it("moves top-level main_seo_keyword and seo.pillar", () => {
    const original = `main_seo_keyword: learn javascript
seo:
  pillar: /en/blog/js/js
content: |
  keep
`;
    const { text, moved } = migrateMainKeywordInYamlText(original);
    expect(moved).toBe(true);
    expect(text).not.toMatch(/^main_seo_keyword:/m);
    expect(text).toContain("main_keyword: learn javascript");
    expect(text).toContain("pillar_path: /en/blog/js/js");
    expect(text).not.toMatch(/^\s+pillar:/m);
    expect(text).toContain("content: |\n  keep");
  });
});

describe("validateSeoSave", () => {
  it("rejects seo on _common.yml", () => {
    const result = validateSeoSave({
      next: { main_keyword: "x" },
      locale: "en",
      contentType: "blog",
      slug: "learn-js",
      ci: stubCi(),
      commonYaml: "seo:\n  main_keyword: no\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("seo_on_common");
  });

  it("auto-fills pillar_path when is_pillar is true", () => {
    const self = "/en/blog/learn-js/learn-js";
    const result = validateSeoSave({
      next: { is_pillar: true },
      locale: "en",
      contentType: "blog",
      slug: "learn-js",
      ci: stubCi(self),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.coerced.pillar_path).toBe(self);
  });

  it("fails when is_pillar path does not match self", () => {
    const result = validateSeoSave({
      next: { is_pillar: true, pillar_path: "/en/other" },
      locale: "en",
      contentType: "blog",
      slug: "learn-js",
      ci: stubCi("/en/blog/learn-js/learn-js"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("seo_hub_path_mismatch");
  });

  it("fails locale prefix mismatch", () => {
    const result = validateSeoSave({
      next: { pillar_path: "/es/blog/foo/foo" },
      locale: "en",
      contentType: "blog",
      slug: "learn-js",
      ci: stubCi(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("seo_locale_mismatch");
  });
});

describe("extractSeoUpdatesFromOps", () => {
  it("splits known seo.* from other ops", () => {
    const { seoUpdates, rest, commonSeo } = extractSeoUpdatesFromOps([
      { action: "update_field", path: "seo.main_keyword", value: "js" },
      { action: "update_field", path: "title", value: "Hi" },
    ]);
    expect(seoUpdates).toEqual({ main_keyword: "js" });
    expect(rest).toHaveLength(1);
    expect(commonSeo).toBe(false);
  });

  it("flags unknown seo.* paths", () => {
    const { commonSeo, rest } = extractSeoUpdatesFromOps([
      { action: "update_field", path: "seo.intent", value: "awareness" },
    ]);
    expect(commonSeo).toBe(true);
    expect(rest).toHaveLength(0);
  });
});

describe("yamlHasSeoKey", () => {
  it("detects a top-level seo: key", () => {
    expect(yamlHasSeoKey("title: x\nseo:\n  main_keyword: a\n")).toBe(true);
    expect(yamlHasSeoKey("title: x\n")).toBe(false);
  });
});
