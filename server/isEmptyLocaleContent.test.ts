import { describe, expect, it } from "vitest";
import { isEmptyDetachedLocale, isEmptyLocaleContent } from "@shared/isEmptyLocaleContent";
import { skipEmptyLocaleGateForForceVariant } from "./empty-locale";

describe("isEmptyLocaleContent", () => {
  it("treats null/undefined as empty", () => {
    expect(isEmptyLocaleContent(null)).toBe(true);
    expect(isEmptyLocaleContent(undefined)).toBe(true);
  });

  it("treats sections: [] with no content as empty", () => {
    expect(isEmptyLocaleContent({ sections: [] })).toBe(true);
    expect(isEmptyLocaleContent({ sections: [], content: "" })).toBe(true);
    expect(isEmptyLocaleContent({ sections: [], content: "   " })).toBe(true);
  });

  it("treats missing sections with no content as empty", () => {
    expect(isEmptyLocaleContent({ title: "x" })).toBe(true);
  });

  it("is not empty when sections exist", () => {
    expect(isEmptyLocaleContent({ sections: [{ type: "hero" }] })).toBe(false);
  });

  it("is not empty when body content exists (classic blog)", () => {
    expect(isEmptyLocaleContent({ sections: [], content: "Hello world" })).toBe(false);
    expect(isEmptyLocaleContent({ content: "Body only" })).toBe(false);
  });
});

describe("isEmptyDetachedLocale", () => {
  it("never empty when not detached", () => {
    expect(
      isEmptyDetachedLocale({ detached: false, merged: { sections: [] } }),
    ).toBe(false);
  });

  it("empty when detached and no sections/content", () => {
    expect(
      isEmptyDetachedLocale({ detached: true, merged: { sections: [] } }),
    ).toBe(true);
  });

  it("not empty when detached but has content", () => {
    expect(
      isEmptyDetachedLocale({
        detached: true,
        merged: { sections: [], content: "Post body" },
      }),
    ).toBe(false);
  });
});

describe("skipEmptyLocaleGateForForceVariant", () => {
  it("skips the public empty-locale 404 when previewing a named variant", () => {
    expect(skipEmptyLocaleGateForForceVariant("draft")).toBe(true);
    expect(skipEmptyLocaleGateForForceVariant("v2")).toBe(true);
  });

  it("enforces the public 404 when no variant is forced", () => {
    expect(skipEmptyLocaleGateForForceVariant(undefined)).toBe(false);
    expect(skipEmptyLocaleGateForForceVariant("")).toBe(false);
    expect(skipEmptyLocaleGateForForceVariant(null)).toBe(false);
  });
});
