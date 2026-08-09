import { describe, expect, it } from "vitest";
import {
  applyPreviewPropMappings,
  buildPreviewPropsHashPayload,
  formatMissingPreviewPropsMessage,
  isBlockedPreviewSource,
  isBrandPreviewSource,
  materializeOgPreviewReadingTime,
  resolvePreviewSourceValue,
} from "@shared/entry-preview-props";
import { hashPreviewProps } from "./entry-preview-manager";
import { resolveAllTemplateVars } from "./resolve-template-vars";

describe("resolvePreviewSourceValue", () => {
  const ctx = {
    entry: { title: "Hello", slug: "hello" },
    meta: { page_title: "SEO Title", description: "Desc" },
    brand: { "brand.title": "4Geeks", "brand.logo": "logo-id" },
  };

  it("resolves plain entry fields", () => {
    expect(resolvePreviewSourceValue("title", ctx)).toBe("Hello");
  });

  it("resolves meta.* from meta bag (reserved prefix)", () => {
    expect(resolvePreviewSourceValue("meta.page_title", ctx)).toBe("SEO Title");
    // Not a dotted path into entry
    expect(resolvePreviewSourceValue("meta.page_title", { entry: { "meta.page_title": "wrong" } })).toBe(
      undefined,
    );
  });

  it("resolves brand.* from brand bag (reserved prefix)", () => {
    expect(resolvePreviewSourceValue("brand.logo", ctx)).toBe("logo-id");
    expect(resolvePreviewSourceValue("brand.logo", { entry: { "brand.logo": "wrong" } })).toBe(undefined);
  });

  it("blocks circular image sources", () => {
    for (const s of ["_image", "image", "og_image", "meta.og_image"]) {
      expect(isBlockedPreviewSource(s)).toBe(true);
      expect(resolvePreviewSourceValue(s, ctx)).toBe(undefined);
    }
  });
});

describe("applyPreviewPropMappings", () => {
  it("applies entry, meta, and brand sources", () => {
    const data: Record<string, unknown> = {};
    const { missing } = applyPreviewPropMappings(
      data,
      {
        heading: "title",
        logo: "brand.logo",
        subtitle: "meta.page_title",
      },
      {
        entry: { title: "T" },
        meta: { page_title: "M" },
        brand: { "brand.logo": "L" },
      },
    );
    expect(missing).toEqual([]);
    expect(data).toEqual({ heading: "T", logo: "L", subtitle: "M" });
  });

  it("reports missing / unusable mapped sources", () => {
    const data: Record<string, unknown> = {};
    const { missing } = applyPreviewPropMappings(
      data,
      {
        a: "title",
        b: "meta.description",
        c: "brand.logo",
        d: "meta.og_image",
      },
      {
        entry: { title: "ok" },
        meta: { description: "{{ single.x }}" },
        brand: { "brand.logo": "" },
      },
    );
    expect(data).toEqual({ a: "ok" });
    expect(missing.sort()).toEqual(["b", "c", "d"]);
  });

  it("does not treat long article bodies with code braces as unusable", () => {
    const data: Record<string, unknown> = {};
    const body = "Intro\n\n```js\nconst x = {{notATemplate}}\n```\n\n".repeat(20);
    const { missing } = applyPreviewPropMappings(
      data,
      { content: "content" },
      { entry: { content: body } },
    );
    expect(missing).toEqual([]);
    expect(data.content).toBe(body);
  });

  it("still accepts a bare entry bag for backward compatibility", () => {
    const data: Record<string, unknown> = {};
    applyPreviewPropMappings(data, { heading: "title" }, { title: "Legacy" });
    expect(data.heading).toBe("Legacy");
  });

  it("uses meta after expanding {{ single.* }} templates", () => {
    const rawMeta = { page_title: "{{ single.title }}" };
    const resolvedMeta = resolveAllTemplateVars(rawMeta, {
      singleEntry: { title: "Bootcamp", slug: "bootcamp" },
      skipSiteVars: true,
    }) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const { missing } = applyPreviewPropMappings(
      data,
      { heading: "meta.page_title" },
      {
        entry: { title: "Bootcamp", slug: "bootcamp" },
        meta: resolvedMeta,
      },
    );
    expect(missing).toEqual([]);
    expect(data.heading).toBe("Bootcamp");
  });
});

describe("materializeOgPreviewReadingTime", () => {
  it("converts content body to reading_time and drops the body", () => {
    const data: Record<string, unknown> = {
      content: "word ".repeat(400),
    };
    materializeOgPreviewReadingTime(data, { content: "content" }, {});
    expect(data.content).toBeUndefined();
    expect(data.reading_time).toMatch(/^\d+ min read$/);
  });

  it("falls back to entry reading_minutes when body was stripped", () => {
    const data: Record<string, unknown> = {};
    materializeOgPreviewReadingTime(data, { content: "content" }, { reading_minutes: 7 });
    expect(data.reading_time).toBe("7 min read");
  });

  it("combines all article section bodies for split pages", () => {
    const data: Record<string, unknown> = {
      content: "word ".repeat(50),
    };
    const entry = {
      sections: [
        { type: "article", content: "word ".repeat(200) },
        { type: "cta_banner", title: "x" },
        { type: "article", content: "word ".repeat(200) },
      ],
    };
    materializeOgPreviewReadingTime(data, { content: "content" }, entry);
    // 400 words → 2 min at 200 wpm; mapped data.content alone would be 1 min.
    expect(data.reading_time).toBe("2 min read");
    expect(data.content).toBeUndefined();
  });
});

describe("formatMissingPreviewPropsMessage", () => {
  it("explains empty list sources in plain language", () => {
    const msg = formatMissingPreviewPropsMessage(
      ["category"],
      { category: "tags" },
      { entry: { tags: [] } },
    );
    expect(msg).toContain("category");
    expect(msg).toContain("tags");
    expect(msg).toMatch(/empty list/i);
    expect(msg).not.toMatch(/unusable/i);
  });
});

describe("propsHash ignores brand", () => {
  it("buildPreviewPropsHashPayload omits brand.* sources", () => {
    const payload = buildPreviewPropsHashPayload(
      { logo: "brand.logo", title: "title", seo: "meta.page_title" },
      {
        entry: { title: "T" },
        meta: { page_title: "M" },
        brand: { "brand.logo": "L1" },
      },
    );
    expect(payload).toEqual({ title: "T", seo: "M" });
    expect(isBrandPreviewSource("brand.logo")).toBe(true);
  });

  it("hashPreviewProps unchanged when only brand values change", () => {
    const props = { logo: "brand.logo", title: "title" };
    const base = {
      entry: { title: "T" },
      meta: {},
      brand: { "brand.logo": "A" },
    };
    const changedBrand = {
      ...base,
      brand: { "brand.logo": "B" },
    };
    expect(hashPreviewProps(props, base)).toBe(hashPreviewProps(props, changedBrand));
  });

  it("hashPreviewProps changes when meta or entry sources change", () => {
    const props = { seo: "meta.page_title", title: "title" };
    const a = {
      entry: { title: "T" },
      meta: { page_title: "M1" },
      brand: {},
    };
    const b = {
      entry: { title: "T" },
      meta: { page_title: "M2" },
      brand: {},
    };
    const c = {
      entry: { title: "T2" },
      meta: { page_title: "M1" },
      brand: {},
    };
    expect(hashPreviewProps(props, a)).not.toBe(hashPreviewProps(props, b));
    expect(hashPreviewProps(props, a)).not.toBe(hashPreviewProps(props, c));
  });
});
