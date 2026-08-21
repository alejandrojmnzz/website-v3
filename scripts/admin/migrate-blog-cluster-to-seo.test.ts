import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "../../server/content-index";
import { invalidateSeoIndexCache } from "../../server/seo-index";
import { readSeoBlockFromYamlText, readTopLevelScalar } from "../../server/seo-fields";
import {
  existingSeoDisagrees,
  formatLeftoverReport,
  migrateBlogClusterToSeo,
  stripClusterHoldingKeys,
} from "./migrate-blog-cluster-to-seo";

const tmpRoots: string[] = [];

afterEach(() => {
  invalidateSeoIndexCache();
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeFile(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blog-cluster-seo-"));
  tmpRoots.push(root);
  writeFile(
    root,
    "content-types.yml",
    `blog:
  directory: blog
  url_pattern:
    en: /en/blog/:slug
program:
  directory: programs
  url_pattern:
    en: /en/career-programs/:slug
`,
  );
  return root;
}

describe("stripClusterHoldingKeys", () => {
  it("removes top-level cluster_keyword and cluster_url", () => {
    const next = stripClusterHoldingKeys(`title: Post
cluster_keyword: Topic
cluster_url: /en/blog/hub
seo:
  main_keyword: post
`);
    expect(next).not.toMatch(/^cluster_keyword:/m);
    expect(next).not.toMatch(/^cluster_url:/m);
    expect(next).toContain("main_keyword: post");
  });
});

describe("existingSeoDisagrees", () => {
  it("ignores empty seo", () => {
    expect(existingSeoDisagrees({}, { pillar_path: "/en/blog/hub", is_pillar: false })).toBe(false);
  });

  it("flags a different pillar_path", () => {
    expect(
      existingSeoDisagrees(
        { pillar_path: "/en/other" },
        { pillar_path: "/en/blog/hub", is_pillar: false },
      ),
    ).toBe(true);
  });
});

describe("formatLeftoverReport", () => {
  it("writes a TSV with a header", () => {
    const text = formatLeftoverReport([
      {
        id: "blog/foo/en.yml",
        locale: "en",
        clusterKeyword: "Topic",
        clusterUrl: "",
        reason: "empty_url",
      },
    ]);
    expect(text).toContain("blog/foo/en.yml\ten\tTopic\t\tempty_url\t");
  });
});

describe("migrateBlogClusterToSeo", () => {
  it("dry-run does not write", async () => {
    const root = fixtureRoot();
    writeFile(
      root,
      "blog/hub/en.yml",
      `title: Hub
cluster_keyword: Topic
cluster_url: /en/blog/hub
`,
    );
    const ci = new ContentIndex(root);
    const leftoverPath = path.join(root, "leftover.txt");
    const result = await migrateBlogClusterToSeo({
      contentRoot: root,
      dryRun: true,
      leftoverPath,
      mark: false,
      ci,
    });
    expect(result.migratedCount).toBe(1);
    expect(fs.readFileSync(path.join(root, "blog/hub/en.yml"), "utf-8")).toContain("cluster_url:");
    expect(fs.existsSync(leftoverPath)).toBe(false);
  });

  it("marks a self hub, copies empty main_keyword, and strips holding keys", async () => {
    const root = fixtureRoot();
    writeFile(
      root,
      "blog/hub/en.yml",
      `title: Hub
cluster_keyword: Topic
cluster_url: /en/blog/hub
`,
    );
    const ci = new ContentIndex(root);
    const leftoverPath = path.join(root, "leftover.txt");
    const result = await migrateBlogClusterToSeo({
      contentRoot: root,
      dryRun: false,
      leftoverPath,
      mark: false,
      ci,
    });
    expect(result.errorCount).toBe(0);
    const text = fs.readFileSync(path.join(root, "blog/hub/en.yml"), "utf-8");
    expect(text).not.toMatch(/^cluster_keyword:/m);
    expect(text).not.toMatch(/^cluster_url:/m);
    const seo = readSeoBlockFromYamlText(text);
    expect(seo.is_pillar).toBe(true);
    expect(seo.pillar_path).toBe("/en/blog/hub");
    expect(seo.main_keyword).toBe("Topic");
  });

  it("sets pillar_path on a spoke without copying cluster_keyword onto main_keyword", async () => {
    const root = fixtureRoot();
    writeFile(
      root,
      "blog/hub/en.yml",
      `title: Hub
cluster_keyword: Topic
cluster_url: /en/blog/hub
`,
    );
    writeFile(
      root,
      "blog/spoke/en.yml",
      `title: Spoke
cluster_keyword: Topic
cluster_url: /en/blog/hub
seo:
  main_keyword: spoke query
`,
    );
    const ci = new ContentIndex(root);
    await migrateBlogClusterToSeo({
      contentRoot: root,
      dryRun: false,
      leftoverPath: path.join(root, "leftover.txt"),
      mark: false,
      ci,
    });
    const spoke = fs.readFileSync(path.join(root, "blog/spoke/en.yml"), "utf-8");
    expect(readTopLevelScalar(spoke, "cluster_url")).toBeNull();
    const seo = readSeoBlockFromYamlText(spoke);
    expect(seo.is_pillar).not.toBe(true);
    expect(seo.pillar_path).toBe("/en/blog/hub");
    expect(seo.main_keyword).toBe("spoke query");
  });

  it("strips empty cluster_url into the leftover file", async () => {
    const root = fixtureRoot();
    writeFile(
      root,
      "blog/orphan/en.yml",
      `title: Orphan
cluster_keyword: Lonely
`,
    );
    const leftoverPath = path.join(root, "leftover.txt");
    const result = await migrateBlogClusterToSeo({
      contentRoot: root,
      dryRun: false,
      leftoverPath,
      mark: false,
      ci: new ContentIndex(root),
    });
    expect(result.strippedOnlyCount).toBe(1);
    const text = fs.readFileSync(path.join(root, "blog/orphan/en.yml"), "utf-8");
    expect(text).not.toMatch(/^cluster_keyword:/m);
    expect(fs.readFileSync(leftoverPath, "utf-8")).toContain("empty_url");
  });

  it("keeps existing seo.* when it disagrees with cluster_url", async () => {
    const root = fixtureRoot();
    writeFile(
      root,
      "blog/hub/en.yml",
      `title: Hub
cluster_keyword: Topic
cluster_url: /en/blog/hub
`,
    );
    writeFile(
      root,
      "blog/conflict/en.yml",
      `title: Conflict
cluster_keyword: Topic
cluster_url: /en/blog/hub
seo:
  pillar_path: /en/other
`,
    );
    const leftoverPath = path.join(root, "leftover.txt");
    await migrateBlogClusterToSeo({
      contentRoot: root,
      dryRun: false,
      leftoverPath,
      mark: false,
      ci: new ContentIndex(root),
    });
    const seo = readSeoBlockFromYamlText(fs.readFileSync(path.join(root, "blog/conflict/en.yml"), "utf-8"));
    expect(seo.pillar_path).toBe("/en/other");
    expect(fs.readFileSync(leftoverPath, "utf-8")).toContain("seo_conflict");
  });

  it("marks a cross-type hub and fills empty main_keyword", async () => {
    const root = fixtureRoot();
    writeFile(
      root,
      "programs/cyber/en.yml",
      `title: Cybersecurity
`,
    );
    writeFile(
      root,
      "blog/why-cyber/en.yml",
      `title: Why cyber
cluster_keyword: Cybersecurity
cluster_url: /en/career-programs/cyber
`,
    );
    await migrateBlogClusterToSeo({
      contentRoot: root,
      dryRun: false,
      leftoverPath: path.join(root, "leftover.txt"),
      mark: false,
      ci: new ContentIndex(root),
    });
    const spoke = readSeoBlockFromYamlText(fs.readFileSync(path.join(root, "blog/why-cyber/en.yml"), "utf-8"));
    expect(spoke.pillar_path).toBe("/en/career-programs/cyber");
    expect(spoke.is_pillar).not.toBe(true);
    const hub = readSeoBlockFromYamlText(fs.readFileSync(path.join(root, "programs/cyber/en.yml"), "utf-8"));
    expect(hub.is_pillar).toBe(true);
    expect(hub.pillar_path).toBe("/en/career-programs/cyber");
    expect(hub.main_keyword).toBe("Cybersecurity");
  });

  it("keeps the first hub keyword and leftover-logs extras", async () => {
    const root = fixtureRoot();
    writeFile(root, "programs/cyber/en.yml", `title: Cybersecurity\n`);
    writeFile(
      root,
      "blog/a/en.yml",
      `title: A
cluster_keyword: Cybersecurity
cluster_url: /en/career-programs/cyber
`,
    );
    writeFile(
      root,
      "blog/b/en.yml",
      `title: B
cluster_keyword: Cybersecurity Bootcamp
cluster_url: /en/career-programs/cyber
`,
    );
    const leftoverPath = path.join(root, "leftover.txt");
    await migrateBlogClusterToSeo({
      contentRoot: root,
      dryRun: false,
      leftoverPath,
      mark: false,
      ci: new ContentIndex(root),
    });
    const hub = readSeoBlockFromYamlText(fs.readFileSync(path.join(root, "programs/cyber/en.yml"), "utf-8"));
    expect(hub.main_keyword).toBe("Cybersecurity");
    expect(fs.readFileSync(leftoverPath, "utf-8")).toContain("keyword_conflict");
  });
});
