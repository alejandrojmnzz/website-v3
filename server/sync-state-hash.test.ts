import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  markFileAsModified,
  getFileUpdatedAtIso,
} from "./sync-state";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-hash-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "pages", "hello"), { recursive: true });
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("content-hash gated modifiedAt", () => {
  it("does not bump modifiedAt when content SHA is unchanged", () => {
    const rel = "site_test/pages/hello/en.yml";
    const full = path.join(tempDir, rel);
    fs.writeFileSync(full, "title: Hello\n", "utf-8");

    markFileAsModified(rel, "test", undefined, contentRoot);
    const first = getFileUpdatedAtIso(rel, contentRoot);

    // Same bytes again
    fs.writeFileSync(full, "title: Hello\n", "utf-8");
    markFileAsModified(rel, "test", undefined, contentRoot);
    const second = getFileUpdatedAtIso(rel, contentRoot);

    expect(second).toBe(first);
  });

  it("bumps modifiedAt when content SHA changes", async () => {
    const rel = "site_test/pages/hello/en.yml";
    const full = path.join(tempDir, rel);
    fs.writeFileSync(full, "title: Hello\n", "utf-8");

    markFileAsModified(rel, "test", undefined, contentRoot);
    const first = getFileUpdatedAtIso(rel, contentRoot);

    await new Promise((r) => setTimeout(r, 5));
    fs.writeFileSync(full, "title: Hello changed\n", "utf-8");
    markFileAsModified(rel, "test", undefined, contentRoot);
    const second = getFileUpdatedAtIso(rel, contentRoot);

    expect(second).not.toBe(first);
    expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
  });
});
