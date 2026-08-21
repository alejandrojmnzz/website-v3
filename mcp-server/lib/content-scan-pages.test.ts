import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { scanPages } from "./content";

const tmpDirs: string[] = [];

function makeSite(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-content-scan-pages-"));
  tmpDirs.push(root);
  fs.writeFileSync(
    path.join(root, "content-types.yml"),
    [
      "page:",
      "  directory: pages",
      "  url_pattern:",
      "    en: /en/:slug",
      "    es: /es/:slug",
      "",
    ].join("\n"),
    "utf-8",
  );
  const entryDir = path.join(root, "pages", "interactive-exercises");
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(path.join(entryDir, "_common.yml"), "title: Interactive exercises\n", "utf-8");
  fs.writeFileSync(path.join(entryDir, "en.yml"), "slug: interactive-exercises\n", "utf-8");
  fs.writeFileSync(path.join(entryDir, "es.yml"), "slug: tutoriales-interactivos\n", "utf-8");
  return root;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("scanPages locale URL resolution", () => {
  it("uses locale yaml slug overrides when building urls", () => {
    const root = makeSite();
    const pages = scanPages(root);
    const entry = pages.find((p) => p.contentType === "page" && p.slug === "interactive-exercises");
    expect(entry).toBeDefined();
    expect(entry?.urls?.en).toBe("/en/interactive-exercises");
    expect(entry?.urls?.es).toBe("/es/tutoriales-interactivos");
  });
});
