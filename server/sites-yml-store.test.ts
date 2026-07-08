import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSitesYmlLocalPath,
  loadSitesYmlFromBucket,
  readSitesYmlLocal,
  renameSiteDomain,
  saveSitesYml,
  writeSitesYmlLocal,
} from "./sites-yml-store";
import { getSiteConfigs, hasMultipleSites, resetSiteConfigs, SitesYmlRequiredError } from "./site-config";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sites-yml-store-test-"));
  process.chdir(tempDir);
  resetSiteConfigs();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  resetSiteConfigs();
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("sites-yml-store", () => {
  it("readSitesYmlLocal returns null when file is missing", () => {
    expect(readSitesYmlLocal()).toBeNull();
  });

  it("writeSitesYmlLocal and readSitesYmlLocal round-trip", () => {
    const content = "example.com:\n  content_folder: site_example\n";
    writeSitesYmlLocal(content);
    expect(readSitesYmlLocal()).toBe(content);
    expect(getSitesYmlLocalPath()).toBe(path.join(tempDir, "sites.yml"));
  });

  it("saveSitesYml writes local file in development", () => {
    process.env.NODE_ENV = "development";
    const content = "example.com:\n  content_folder: site_example\n";
    saveSitesYml(content);
    expect(fs.readFileSync(path.join(tempDir, "sites.yml"), "utf-8")).toBe(content);
  });

  it("loadSitesYmlFromBucket requires local file in development", async () => {
    process.env.NODE_ENV = "development";
    await expect(loadSitesYmlFromBucket()).rejects.toThrow(SitesYmlRequiredError);
  });

  it("loadSitesYmlFromBucket succeeds in development when local file exists", async () => {
    process.env.NODE_ENV = "development";
    writeSitesYmlLocal("example.com:\n  content_folder: site_example\n");
    await expect(loadSitesYmlFromBucket()).resolves.toBeUndefined();
  });

  it("loadSitesYmlFromBucket clears stale site-config cache after resolving sites.yml", async () => {
    process.env.NODE_ENV = "development";
    writeSitesYmlLocal(`old.example.com:
  content_folder: site_old
`);
    expect(getSiteConfigs()).toHaveLength(1);
    expect(hasMultipleSites()).toBe(false);

    writeSitesYmlLocal(`a.example.com:
  content_folder: site_a
b.example.com:
  content_folder: site_b
`);
    await loadSitesYmlFromBucket();

    expect(getSiteConfigs()).toHaveLength(2);
    expect(hasMultipleSites()).toBe(true);
  });

  it("renameSiteDomain updates the domain key and preserves nested fields", () => {
    const content = [
      "# header comment",
      "bucket_name: test-bucket",
      "",
      "example.com:",
      "  content_folder: site_example",
      "  github_repo_url: https://github.com/org/repo",
    ].join("\n");
    writeSitesYmlLocal(content);

    renameSiteDomain("example.com", "new-example.com");

    const updated = readSitesYmlLocal();
    expect(updated).toContain("# header comment");
    expect(updated).toContain("new-example.com:");
    expect(updated).not.toMatch(/^example\.com:/m);
    expect(updated).toContain("content_folder: site_example");
    expect(updated).toContain("github_repo_url: https://github.com/org/repo");
  });
});
