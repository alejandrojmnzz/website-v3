import { mkdtempSync, rmSync } from "fs";
import os from "os";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetRuntimeIssuesIgnoreForTests,
  addIgnoreRules,
  isPathIgnored,
  listIgnoreRules,
  removeIgnoreRules,
} from "./runtime-issues-ignore-store";

describe("runtime-issues-ignore-store", () => {
  let tmp: string;

  afterEach(() => {
    _resetRuntimeIssuesIgnoreForTests();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function root() {
    tmp = mkdtempSync(os.tmpdir() + "/runtime-issues-ignore-");
    return tmp;
  }

  it("adds a locales rule and matches both locales", () => {
    const contentRoot = root();
    addIgnoreRules(
      "site_test",
      [{ kind: "locales", locales: ["us", "es"], rest: "/gone", label: "twins" }],
      { contentRoot },
    );
    expect(isPathIgnored("site_test", "/us/gone", contentRoot)).toBe(true);
    expect(isPathIgnored("site_test", "/es/gone", contentRoot)).toBe(true);
    expect(isPathIgnored("site_test", "/us/keep", contentRoot)).toBe(false);
    expect(listIgnoreRules("site_test", contentRoot)).toHaveLength(1);
  });

  it("removes by id", () => {
    const contentRoot = root();
    const { ignored } = addIgnoreRules(
      "site_test",
      [{ kind: "exact", path: "/us/old" }],
      { contentRoot },
    );
    expect(ignored).toHaveLength(1);
    removeIgnoreRules("site_test", [ignored[0]!.id], contentRoot);
    expect(listIgnoreRules("site_test", contentRoot)).toHaveLength(0);
    expect(isPathIgnored("site_test", "/us/old", contentRoot)).toBe(false);
  });
});
