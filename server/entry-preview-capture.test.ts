import { describe, expect, it } from "vitest";
import {
  signEntryPreviewCaptureToken,
  verifyEntryPreviewCaptureToken,
  stripOgCacheBust,
} from "./entry-preview-capture-auth";
import {
  buildOgImageYamlValue,
  isPreviousGeneratedOgUrl,
  shouldWriteGeneratedOgToYaml,
} from "./entry-preview-og-yaml";
import { isSiteUrlPubliclyReachable, cloudflareBrowserConfigError, resolveCloudflareAccountId, resolveCloudflareApiToken, resolveEntryPreviewCaptureSecret } from "./cloudflare-browser";
import { resetSettings } from "./settings";
import fs from "fs";
import os from "os";
import path from "path";

describe("entry-preview-capture-auth", () => {
  it("signs and verifies capture tokens", () => {
    process.env.ENTRY_PREVIEW_CAPTURE_SECRET = "test-secret-for-hmac";
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = signEntryPreviewCaptureToken({
      contentType: "blog",
      slug: "hello",
      locale: "en",
      exp,
    });
    expect(
      verifyEntryPreviewCaptureToken({
        contentType: "blog",
        slug: "hello",
        locale: "en",
        exp,
        token,
      }).ok,
    ).toBe(true);
    expect(
      verifyEntryPreviewCaptureToken({
        contentType: "blog",
        slug: "other",
        locale: "en",
        exp,
        token,
      }).ok,
    ).toBe(false);
  });

  it("stripOgCacheBust removes t param", () => {
    expect(stripOgCacheBust("https://cdn.example.com/a.webp?t=123")).toBe(
      "https://cdn.example.com/a.webp",
    );
    expect(stripOgCacheBust("/site_x/images/entry-previews/a.webp?t=99")).toContain(
      "entry-previews",
    );
  });
});

describe("entry-preview-og-yaml policy", () => {
  const generated = "https://storage.googleapis.com/bucket/entry-previews/blog/x/en/1200.webp";

  it("writes when og_image empty", () => {
    expect(
      shouldWriteGeneratedOgToYaml({
        entry: { meta: {} },
        previousGeneratedUrl: null,
      }).write,
    ).toBe(true);
  });

  it("writes when og_image is previous generated (ignore ?t=)", () => {
    expect(
      isPreviousGeneratedOgUrl(`${generated}?t=1`, generated),
    ).toBe(true);
    expect(
      shouldWriteGeneratedOgToYaml({
        entry: { meta: { og_image: `${generated}?t=111` } },
        previousGeneratedUrl: generated,
      }).write,
    ).toBe(true);
  });

  it("skips distinct editorial og_image", () => {
    const r = shouldWriteGeneratedOgToYaml({
      entry: { meta: { og_image: "https://cdn.example.com/gallery/hero.webp" } },
      previousGeneratedUrl: generated,
    });
    expect(r.write).toBe(false);
    if (!r.write) expect(r.reason).toBe("editorial_image");
  });

  it("skips when _image is distinct editorial", () => {
    const r = shouldWriteGeneratedOgToYaml({
      entry: { _image: "https://cdn.example.com/gallery/hero.webp", meta: {} },
      previousGeneratedUrl: generated,
    });
    expect(r.write).toBe(false);
  });

  it("buildOgImageYamlValue adds ?t=", () => {
    const capturedAt = new Date("2026-01-15T12:00:00.000Z").toISOString();
    const v = buildOgImageYamlValue(generated, capturedAt);
    expect(v.startsWith(generated)).toBe(true);
    expect(v).toContain("t=");
  });
});

describe("cloudflare-browser config helpers", () => {
  it("rejects localhost SITE_URL as not publicly reachable", () => {
    const prev = process.env.SITE_URL;
    process.env.SITE_URL = "http://localhost:5000";
    expect(isSiteUrlPubliclyReachable()).toBe(false);
    process.env.SITE_URL = prev;
  });

  it("reports missing credentials", () => {
    const a = process.env.CLOUDFLARE_ACCOUNT_ID;
    const t = process.env.CLOUDFLARE_API_TOKEN;
    const s = process.env.SITE_URL;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    process.env.SITE_URL = "https://www.example.com";
    expect(cloudflareBrowserConfigError()).toMatch(/CLOUDFLARE/);
    process.env.CLOUDFLARE_ACCOUNT_ID = a;
    process.env.CLOUDFLARE_API_TOKEN = t;
    process.env.SITE_URL = s;
  });

  it("ignores legacy settings.yml entry_preview and uses env only", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ep-settings-"));
    fs.writeFileSync(
      path.join(tmp, "settings.yml"),
      [
        "entry_preview:",
        "  cloudflare_account_id: settings-account",
        "  cloudflare_api_token: settings-token",
        "  capture_secret: settings-capture-secret",
        "",
      ].join("\n"),
      "utf-8",
    );
    resetSettings(tmp);

    const prevA = process.env.CLOUDFLARE_ACCOUNT_ID;
    const prevT = process.env.CLOUDFLARE_API_TOKEN;
    const prevC = process.env.ENTRY_PREVIEW_CAPTURE_SECRET;
    process.env.CLOUDFLARE_ACCOUNT_ID = "env-account";
    process.env.CLOUDFLARE_API_TOKEN = "env-token";
    process.env.ENTRY_PREVIEW_CAPTURE_SECRET = "env-capture";

    expect(resolveCloudflareAccountId()).toEqual({
      value: "env-account",
      source: "env",
    });
    expect(resolveCloudflareApiToken()).toEqual({
      value: "env-token",
      source: "env",
    });
    expect(resolveEntryPreviewCaptureSecret()).toEqual({
      value: "env-capture",
      source: "env",
    });

    process.env.CLOUDFLARE_ACCOUNT_ID = prevA;
    process.env.CLOUDFLARE_API_TOKEN = prevT;
    process.env.ENTRY_PREVIEW_CAPTURE_SECRET = prevC;
    resetSettings(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves account id from env", () => {
    const prevA = process.env.CLOUDFLARE_ACCOUNT_ID;
    process.env.CLOUDFLARE_ACCOUNT_ID = "env-only-account";
    expect(resolveCloudflareAccountId()).toEqual({
      value: "env-only-account",
      source: "env",
    });
    process.env.CLOUDFLARE_ACCOUNT_ID = prevA;
  });
});
