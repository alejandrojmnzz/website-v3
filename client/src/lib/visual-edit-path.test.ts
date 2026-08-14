import { describe, expect, it } from "vitest";
import { buildPrivatePreviewHref, isPrivatePreviewPath, isVisualEditPath } from "./visual-edit-path";

describe("isVisualEditPath", () => {
  it("allows public content pages", () => {
    expect(isVisualEditPath("/")).toBe(true);
    expect(isVisualEditPath("/en/coding-bootcamp")).toBe(true);
    expect(isVisualEditPath("/es/us/miami")).toBe(true);
  });

  it("allows the visual preview route", () => {
    expect(isVisualEditPath("/private/preview")).toBe(true);
    expect(isVisualEditPath("/private/preview/page/home")).toBe(true);
    expect(isVisualEditPath("/private/preview/program/ai-engineering")).toBe(true);
  });

  it("hides edit chrome on admin private pages", () => {
    expect(isVisualEditPath("/private")).toBe(false);
    expect(isVisualEditPath("/private/diagnostics")).toBe(false);
    expect(isVisualEditPath("/private/diagnostics/runtime-issues")).toBe(false);
    expect(isVisualEditPath("/private/settings")).toBe(false);
    expect(isVisualEditPath("/private/media-gallery")).toBe(false);
    expect(isVisualEditPath("/private/type/blog")).toBe(false);
  });
});

describe("isPrivatePreviewPath", () => {
  it("matches the visual preview route only", () => {
    expect(isPrivatePreviewPath("/private/preview")).toBe(true);
    expect(isPrivatePreviewPath("/private/preview/page/apply")).toBe(true);
    expect(isPrivatePreviewPath("/en/apply")).toBe(false);
    expect(isPrivatePreviewPath("/private/settings")).toBe(false);
  });
});

describe("buildPrivatePreviewHref", () => {
  it("maps a public locale path to /private/preview/{type}/{slug}", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "apply",
        pathname: "/en/apply",
      }),
    ).toBe("/private/preview/page/apply?locale=en");
  });

  it("uses the path locale over fallback", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "apply",
        pathname: "/es/apply",
        fallbackLocale: "en",
      }),
    ).toBe("/private/preview/page/apply?locale=es");
  });

  it("keeps variant (or force_variant) from the current search", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "apply",
        pathname: "/en/apply",
        search: "?force_variant=draft-a&utm_source=nav",
      }),
    ).toBe("/private/preview/page/apply?locale=en&variant=draft-a");
  });

  it("returns null when already on private preview", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "apply",
        pathname: "/private/preview/page/apply",
        search: "?locale=en",
      }),
    ).toBeNull();
  });

  it("uses fallback locale when the public path has none", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "home",
        pathname: "/",
        fallbackLocale: "es",
      }),
    ).toBe("/private/preview/page/home?locale=es");
  });
});
