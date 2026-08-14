import { describe, expect, it } from "vitest";
import { isVisualEditPath } from "./visual-edit-path";

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
