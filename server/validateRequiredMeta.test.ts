import { describe, it, expect } from "vitest";
import {
  validateRequiredMeta,
  formatMetaValidationErrors,
} from "@shared/validateRequiredMeta";

describe("validateRequiredMeta", () => {
  it("passes when both fields are non-empty resolved strings", () => {
    expect(
      validateRequiredMeta({
        page_title: "Hello",
        description: "A solid meta description for SEO.",
      }),
    ).toEqual({ ok: true });
  });

  it("fails on missing, empty, or unresolved templates", () => {
    const missing = validateRequiredMeta({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.map((e) => e.field)).toEqual([
        "meta.page_title",
        "meta.description",
      ]);
    }

    expect(validateRequiredMeta({ page_title: "  ", description: "x" }).ok).toBe(
      false,
    );
    expect(
      validateRequiredMeta({
        page_title: "{{ single.title }}",
        description: "ok",
      }).ok,
    ).toBe(false);
  });

  it("formats errors for API responses", () => {
    const result = validateRequiredMeta({});
    const msg = formatMetaValidationErrors(result);
    expect(msg).toContain("meta.page_title");
    expect(msg).toContain("meta.description");
  });
});
