import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach } from "vitest";
import { resetRegistry } from "./content-types";
import { resolveEffectiveSeo, seoBaselineFromDbItem } from "./seo-effective-seo";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-effective-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "blog", "post-a"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  database:
    slug: blog_db
  field_mapping:
    _slug: slug
    seo_main_keyword: cluster_keyword
    seo_pillar_path: cluster_url
    seo_is_pillar: is_hub
  url_pattern:
    en: /en/blog/:slug
`,
    "utf-8",
  );
  resetRegistry();
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  resetRegistry();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveEffectiveSeo", () => {
  it("uses DB baseline when locale YAML has no seo: block", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      "slug: post-a\nmeta:\n  page_title: A\n  description: B\n",
      "utf-8",
    );
    const seo = resolveEffectiveSeo({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      dbItem: {
        slug: "post-a",
        locale: "en",
        cluster_keyword: "from db",
        cluster_url: "/en/blog/hub",
        is_hub: false,
      },
    });
    expect(seo.main_keyword).toBe("from db");
    expect(seo.pillar_path).toBe("/en/blog/hub");
    expect(seo.is_pillar).not.toBe(true);
  });

  it("lets locale YAML overlay win per key", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      `slug: post-a
seo:
  main_keyword: from yaml
meta:
  page_title: A
  description: B
`,
      "utf-8",
    );
    const seo = resolveEffectiveSeo({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      dbItem: {
        slug: "post-a",
        cluster_keyword: "from db",
        cluster_url: "/en/blog/hub",
      },
    });
    expect(seo.main_keyword).toBe("from yaml");
    expect(seo.pillar_path).toBe("/en/blog/hub");
  });

  it("seoBaselineFromDbItem ignores YAML", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      `slug: post-a
seo:
  main_keyword: from yaml
`,
      "utf-8",
    );
    const base = seoBaselineFromDbItem(
      { cluster_keyword: "from db", cluster_url: "/en/x" },
      "blog",
      contentRoot,
    );
    expect(base.main_keyword).toBe("from db");
    expect(base.pillar_path).toBe("/en/x");
  });
});
