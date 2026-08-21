import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./sync-state", () => ({
  markFileAsModified: vi.fn(),
}));

import { insertCustomRedirect, loadCustomRedirectsYaml, moveCustomRedirect } from "./custom-redirects-yml";

const tmpDirs: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-redirects-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("insertCustomRedirect / moveCustomRedirect", () => {
  it("inserts before_from immediately above the target rule", () => {
    const contentRoot = makeRoot();
    const first = insertCustomRedirect({
      contentRoot,
      contentRootName: "site_test",
      from: "/a",
      to: "/en/a",
      statusCode: 301,
      priority: "before",
    });
    expect(first.ok).toBe(true);
    const second = insertCustomRedirect({
      contentRoot,
      contentRootName: "site_test",
      from: "/b",
      to: "/en/b",
      statusCode: 301,
      priority: "before",
    });
    expect(second.ok).toBe(true);

    const inserted = insertCustomRedirect({
      contentRoot,
      contentRootName: "site_test",
      from: "/new",
      to: "/en/new",
      statusCode: 301,
      priority: "before",
      beforeFrom: "/b",
    });
    expect(inserted.ok).toBe(true);
    if (inserted.ok) expect(inserted.index).toBe(1);

    const entries = loadCustomRedirectsYaml(contentRoot);
    expect(entries.map((e) => e.from)).toEqual(["/a", "/new", "/b"]);
  });

  it("returns 409 on duplicate from", () => {
    const contentRoot = makeRoot();
    insertCustomRedirect({
      contentRoot,
      contentRootName: "site_test",
      from: "/dup",
      to: "/en/a",
      statusCode: 301,
      priority: "before",
    });
    const dup = insertCustomRedirect({
      contentRoot,
      contentRootName: "site_test",
      from: "/dup",
      to: "/en/b",
      statusCode: 301,
      priority: "before",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.status).toBe(409);
  });

  it("returns before_from_not_found for unknown before_from", () => {
    const contentRoot = makeRoot();
    insertCustomRedirect({
      contentRoot,
      contentRootName: "site_test",
      from: "/a",
      to: "/en/a",
      statusCode: 301,
      priority: "before",
    });
    const missing = insertCustomRedirect({
      contentRoot,
      contentRootName: "site_test",
      from: "/b",
      to: "/en/b",
      statusCode: 301,
      priority: "before",
      beforeFrom: "/missing",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.status).toBe(404);
      expect(missing.code).toBe("before_from_not_found");
    }
  });

  it("moves a rule immediately above before_from", () => {
    const contentRoot = makeRoot();
    for (const from of ["/a", "/b", "/c"]) {
      insertCustomRedirect({
        contentRoot,
        contentRootName: "site_test",
        from,
        to: `/en${from}`,
        statusCode: 301,
        priority: "before",
      });
    }
    const moved = moveCustomRedirect({
      contentRoot,
      contentRootName: "site_test",
      from: "/c",
      beforeFrom: "/a",
    });
    expect(moved.ok).toBe(true);
    expect(loadCustomRedirectsYaml(contentRoot).map((e) => e.from)).toEqual(["/c", "/a", "/b"]);
  });
});
