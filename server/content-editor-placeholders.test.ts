import { describe, expect, it } from "vitest";
import {
  restoreTemplatePlaceholders,
  sanitizeClearedTemplatePaths,
} from "./content-editor";

const original = {
  type: "hero",
  title: "{{ single.title | blog title }}",
  subtitle: "{{ single.description }}",
  image: {
    src: "{{ single.image | https://example.com/fallback.webp }}",
  },
  badge: "static-badge",
};

describe("restoreTemplatePlaceholders", () => {
  it("re-injects bindings by default when missing from incoming section", () => {
    const incoming = {
      type: "hero",
      badge: "static-badge",
      title: "resolved title",
    };
    const result = restoreTemplatePlaceholders(incoming, original);
    expect(result.title).toBe("{{ single.title | blog title }}");
    expect(result.subtitle).toBe("{{ single.description }}");
    expect((result.image as { src: string }).src).toBe(
      "{{ single.image | https://example.com/fallback.webp }}",
    );
    expect(result.badge).toBe("static-badge");
  });

  it("leaves allowlisted missing paths gone", () => {
    const incoming = {
      type: "hero",
      title: "{{ single.title | blog title }}",
      subtitle: "{{ single.description }}",
      badge: "static-badge",
    };
    const result = restoreTemplatePlaceholders(incoming, original, ["image.src"]);
    expect(result).not.toHaveProperty("image");
    expect(result.title).toBe("{{ single.title | blog title }}");
    expect(result.subtitle).toBe("{{ single.description }}");
  });

  it("still restores non-allowlisted missing paths", () => {
    const incoming = {
      type: "hero",
      badge: "x",
    };
    const result = restoreTemplatePlaceholders(incoming, original, ["image.src"]);
    expect(result).not.toHaveProperty("image");
    expect(result.title).toBe("{{ single.title | blog title }}");
    expect(result.subtitle).toBe("{{ single.description }}");
  });

  it("overwrites present literals with template expressions (unchanged)", () => {
    const incoming = {
      type: "hero",
      title: "literal title",
      subtitle: "literal subtitle",
      image: { src: "https://cdn.example.com/photo.jpg" },
    };
    const result = restoreTemplatePlaceholders(incoming, original);
    expect(result.title).toBe("{{ single.title | blog title }}");
    expect(result.subtitle).toBe("{{ single.description }}");
    expect((result.image as { src: string }).src).toBe(
      "{{ single.image | https://example.com/fallback.webp }}",
    );
  });
});

describe("sanitizeClearedTemplatePaths", () => {
  it("keeps only real bindings that are absent on incoming", () => {
    const incoming = {
      type: "hero",
      title: "{{ single.title | blog title }}",
      subtitle: "{{ single.description }}",
    };
    expect(
      sanitizeClearedTemplatePaths(
        ["image.src", "title", "not.a.binding", "subtitle"],
        incoming,
        original,
      ),
    ).toEqual(["image.src"]);
  });

  it("returns empty for undefined or empty requests", () => {
    expect(sanitizeClearedTemplatePaths(undefined, {}, original)).toEqual([]);
    expect(sanitizeClearedTemplatePaths([], {}, original)).toEqual([]);
  });
});
