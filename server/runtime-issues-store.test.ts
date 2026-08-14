import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetRuntimeIssuesForTests,
  listRuntimeIssues,
  recordPublicNotFound,
  resetRuntimeIssuesForSite,
  saveIssueProbe,
} from "./runtime-issues-store";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("runtime-issues-store", () => {
  let tmp: string;

  afterEach(() => {
    _resetRuntimeIssuesForTests();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function root() {
    tmp = mkdtempSync(path.join(os.tmpdir(), "runtime-issues-"));
    return tmp;
  }

  it("records Googlebot page 404s with byHour and search_crawler", () => {
    const contentRoot = root();
    const ts = Date.UTC(2026, 7, 14, 15, 0, 0);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/es/blog/foo",
        userAgent: "Googlebot/2.1",
        ts,
      }),
    ).toBe(true);
    const listed = listRuntimeIssues("site_test", { hideBots: true, contentRoot });
    expect(listed.issues).toHaveLength(1);
    expect(listed.issues[0].sources).toContain("search_crawler");
    expect(listed.issues[0].uaBucket).toBe("search_crawler");
    expect(listed.issues[0].likelyBot).toBeFalsy();
    expect(listed.issues[0].byHour?.["2026-08-14T15"]?.total).toBe(1);
    expect(listed.issues[0].byHour?.["2026-08-14T15"]?.search_crawler).toBe(1);
  });

  it("drops curl and hashed JS", () => {
    const contentRoot = root();
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/es/blog/foo",
        userAgent: "curl/8.0",
      }),
    ).toBe(false);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/FooterDefault-BzTB3rd2.js",
        userAgent: CHROME,
        referrer: "https://4geeks.com/",
      }),
    ).toBe(false);
    expect(listRuntimeIssues("site_test", { hideBots: false, contentRoot }).issues).toHaveLength(0);
  });

  it("keeps a 4Geeks-referrer gif and tags internal", () => {
    const contentRoot = root();
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/static/images/loader.gif",
        userAgent: CHROME,
        referrer: "https://classrecordings.4geeks.com/",
      }),
    ).toBe(true);
    const listed = listRuntimeIssues("site_test", { hideBots: true, contentRoot });
    expect(listed.issues[0].sources).toContain("internal");
  });

  it("resetRuntimeIssuesForSite empties the store", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/es/blog/foo",
      userAgent: CHROME,
    });
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(1);
    const empty = resetRuntimeIssuesForSite("site_test", contentRoot);
    expect(Object.keys(empty.issues)).toHaveLength(0);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(0);
  });

  it("saveIssueProbe persists lastProbe and a later 404 keeps it", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/hello",
      userAgent: CHROME,
    });
    const listed = listRuntimeIssues("site_test", { contentRoot });
    const fp = listed.issues[0].fingerprint;
    const saved = saveIssueProbe(
      "site_test",
      fp,
      {
        at: 1_700_000_000_000,
        status: "redirect",
        destination: "/us/page",
        chained: false,
        hops: ["/hello", "/us/page"],
        httpStatus: 200,
        matchType: "exact",
      },
      contentRoot,
    );
    expect(saved?.lastProbe?.status).toBe("redirect");
    expect(saved?.lastProbe?.destination).toBe("/us/page");

    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/hello",
      userAgent: CHROME,
      ts: Date.now(),
    });
    const again = listRuntimeIssues("site_test", { contentRoot }).issues[0];
    expect(again.lastProbe?.status).toBe("redirect");
    expect(again.lastProbe?.destination).toBe("/us/page");
  });

  it("saveIssueProbe returns null for an unknown fingerprint", () => {
    expect(saveIssueProbe("site_test", "missing", { at: 1, status: "not_found" }, root())).toBeNull();
  });
});
