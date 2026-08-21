import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";

const tmpDirs: string[] = [];

function makeSite(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-index-refresh-"));
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "content-types.yml"),
    [
      "page:",
      "  directory: pages",
      "  url_pattern:",
      "    en: /en/:slug",
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.mkdirSync(path.join(dir, "pages", "home"), { recursive: true });
  fs.writeFileSync(path.join(dir, "pages", "home", "en.yml"), "title: Home\nslug: home\n", "utf-8");
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ContentIndex.refresh serialization", () => {
  it("coalesces an overlapping refresh into one follow-up scan", () => {
    const root = makeSite();
    const ci = new ContentIndex(root);

    let scans = 0;
    const originalScan = (ci as any).scan.bind(ci) as () => void;
    (ci as any).scan = () => {
      scans += 1;
      if (scans === 1) {
        ci.refresh();
      }
      originalScan();
    };

    ci.refresh();
    expect(scans).toBe(2);
  });
});
