import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatSitesYmlRequiredError,
  getDefaultContentFolder,
  getSiteConfigs,
  hasMultipleSites,
  resetSiteConfigs,
  SitesYmlRequiredError,
} from "./site-config";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-config-test-"));
  process.chdir(tempDir);
  resetSiteConfigs();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetSiteConfigs();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("site-config", () => {
  it("throws when sites.yml is missing", () => {
    expect(() => getSiteConfigs()).toThrow(SitesYmlRequiredError);
    try {
      getSiteConfigs();
    } catch (err) {
      expect(err).toBeInstanceOf(SitesYmlRequiredError);
      expect((err as Error).message).toContain("sites.yml is required");
      expect((err as Error).message).toContain("Expected format:");
    }
  });

  it("throws when sites.yml has no site entries", () => {
    fs.writeFileSync(path.join(tempDir, "sites.yml"), "bucket_name: test-bucket\n", "utf-8");
    expect(() => getSiteConfigs()).toThrow(/no site entries/);
  });

  it("loads one site from sites.yml", () => {
    fs.writeFileSync(
      path.join(tempDir, "sites.yml"),
      `4geeks.com:
  content_folder: site_4geeks-com
  github_repo_url: https://github.com/org/content
`,
      "utf-8",
    );
    const configs = getSiteConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].domain).toBe("4geeks.com");
    expect(configs[0].contentFolder).toBe("site_4geeks-com");
    expect(getDefaultContentFolder()).toBe("site_4geeks-com");
    expect(hasMultipleSites()).toBe(false);
  });

  it("hasMultipleSites is true for two sites", () => {
    fs.writeFileSync(
      path.join(tempDir, "sites.yml"),
      `a.example.com:
  content_folder: site_a
b.example.com:
  content_folder: site_b
`,
      "utf-8",
    );
    resetSiteConfigs();
    expect(getSiteConfigs()).toHaveLength(2);
    expect(hasMultipleSites()).toBe(true);
  });

  it("formatSitesYmlRequiredError includes reason and example", () => {
    const msg = formatSitesYmlRequiredError("test reason");
    expect(msg).toContain("test reason");
    expect(msg).toContain("content_folder:");
  });
});
