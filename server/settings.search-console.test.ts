import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import {
  getSearchConsoleSettings,
  normalizeSearchConsoleSiteUrl,
  resetSettings,
  updateSearchConsoleSettings,
} from "./settings";

describe("normalizeSearchConsoleSiteUrl", () => {
  it("normalizes URL-prefix properties with a trailing slash", () => {
    expect(normalizeSearchConsoleSiteUrl("https://example.com")).toBe("https://example.com/");
    expect(normalizeSearchConsoleSiteUrl("https://www.example.com/")).toBe("https://www.example.com/");
  });

  it("normalizes sc-domain properties", () => {
    expect(normalizeSearchConsoleSiteUrl("sc-domain:Example.com")).toBe("sc-domain:example.com");
  });

  it("rejects empty, localhost, and http", () => {
    expect(() => normalizeSearchConsoleSiteUrl("")).toThrow(/required/i);
    expect(() => normalizeSearchConsoleSiteUrl("https://localhost/")).toThrow(/localhost/i);
    expect(() => normalizeSearchConsoleSiteUrl("https://127.0.0.1/")).toThrow(/localhost/i);
    expect(() => normalizeSearchConsoleSiteUrl("sc-domain:localhost")).toThrow(/localhost/i);
    expect(() => normalizeSearchConsoleSiteUrl("http://example.com/")).toThrow(/https/i);
  });
});

describe("search_console settings.yml", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-settings-"));
    resetSettings(tmp);
  });

  afterEach(() => {
    resetSettings(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("loads empty YAML as not saved", () => {
    fs.writeFileSync(path.join(tmp, "settings.yml"), "i18n: {}\n", "utf-8");
    resetSettings(tmp);
    expect(getSearchConsoleSettings(tmp)).toEqual({ site_url: null });
  });

  it("saves a URL-prefix property and reloads it", () => {
    fs.writeFileSync(path.join(tmp, "settings.yml"), "i18n: {}\n", "utf-8");
    const updated = updateSearchConsoleSettings({ site_url: "https://4geeks.com" }, tmp);
    expect(updated.site_url).toBe("https://4geeks.com/");
    resetSettings(tmp);
    expect(getSearchConsoleSettings(tmp).site_url).toBe("https://4geeks.com/");
    const parsed = yaml.load(fs.readFileSync(path.join(tmp, "settings.yml"), "utf-8")) as {
      search_console?: { site_url?: string };
    };
    expect(parsed.search_console?.site_url).toBe("https://4geeks.com/");
  });

  it("saves an sc-domain property", () => {
    const updated = updateSearchConsoleSettings({ site_url: "sc-domain:4geeks.com" }, tmp);
    expect(updated.site_url).toBe("sc-domain:4geeks.com");
    resetSettings(tmp);
    expect(getSearchConsoleSettings(tmp).site_url).toBe("sc-domain:4geeks.com");
  });

  it("rejects localhost on save", () => {
    expect(() => updateSearchConsoleSettings({ site_url: "https://localhost:5000/" }, tmp)).toThrow(
      /localhost/i,
    );
  });
});
