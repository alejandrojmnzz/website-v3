import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSitesYmlLocalPath,
  loadSitesYmlFromBucket,
  readSitesYmlLocal,
  saveSitesYml,
  writeSitesYmlLocal,
} from "./sites-yml-store";
import { SitesYmlRequiredError } from "./site-config";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sites-yml-store-test-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
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
});
