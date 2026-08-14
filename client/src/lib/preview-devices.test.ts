import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_BREAKPOINT_KEY,
  PREVIEW_DEVICE_KEY,
  clearStoredPreviewSelection,
  persistPreviewSelection,
  shouldAllowDeviceEmbedHref,
} from "./preview-devices";

describe("shouldAllowDeviceEmbedHref", () => {
  it("allows in-page hashes and inline section modals", () => {
    expect(shouldAllowDeviceEmbedHref("#pricing")).toBe(true);
    expect(shouldAllowDeviceEmbedHref("#top")).toBe(true);
    expect(shouldAllowDeviceEmbedHref("#bottom")).toBe(true);
    expect(shouldAllowDeviceEmbedHref("#pricing?cohort=x")).toBe(true);
    expect(shouldAllowDeviceEmbedHref("inline#signup")).toBe(true);
  });

  it("blocks paths, query-only changes, and off-page URLs", () => {
    expect(shouldAllowDeviceEmbedHref("/en/coding-bootcamp")).toBe(false);
    expect(shouldAllowDeviceEmbedHref("/us/program/ai-engineering")).toBe(false);
    expect(shouldAllowDeviceEmbedHref("/private/preview/page/home?locale=en")).toBe(false);
    expect(shouldAllowDeviceEmbedHref("?utm_source=nav")).toBe(false);
    expect(shouldAllowDeviceEmbedHref("https://4geeks.com/us/foo")).toBe(false);
    expect(shouldAllowDeviceEmbedHref("mailto:hello@4geeks.com")).toBe(false);
    expect(shouldAllowDeviceEmbedHref("tel:+15551212")).toBe(false);
  });
});

describe("preview selection storage", () => {
  const store = new Map<string, string>();

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  function stubStorage() {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  }

  it("persists a phone and clears both keys on desktop / explicit clear", () => {
    stubStorage();
    persistPreviewSelection("mobile", "iphone-se");
    expect(store.get(PREVIEW_BREAKPOINT_KEY)).toBe("mobile");
    expect(store.get(PREVIEW_DEVICE_KEY)).toBe("iphone-se");

    persistPreviewSelection("desktop", "iphone-se");
    expect(store.has(PREVIEW_BREAKPOINT_KEY)).toBe(false);
    expect(store.has(PREVIEW_DEVICE_KEY)).toBe(false);

    persistPreviewSelection("mobile", "ipad-mini");
    clearStoredPreviewSelection();
    expect(store.has(PREVIEW_BREAKPOINT_KEY)).toBe(false);
    expect(store.has(PREVIEW_DEVICE_KEY)).toBe(false);
  });
});
