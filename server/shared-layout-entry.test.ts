import { describe, expect, it } from "vitest";
import {
  TEMPLATE_VERSIONING_SLUG,
  isTemplateVersioningSlug,
  stripStructuralOverlayKeys,
  attachedOverlayStructureError,
} from "./shared-layout-entry";
import { applyPerEntryLayer } from "./section-merge";
import { buildHtmlCacheKey } from "./html-page-cache";

describe("shared-layout-entry helpers", () => {
  it("recognizes template versioning slug", () => {
    expect(TEMPLATE_VERSIONING_SLUG).toBe("single");
    expect(isTemplateVersioningSlug("single")).toBe(true);
    expect(isTemplateVersioningSlug("my-post")).toBe(false);
  });

  it("strips sections and layout for re-attach", () => {
    const stripped = stripStructuralOverlayKeys({
      title: "Hi",
      sections: [{ type: "hero" }],
      layout: { menu: { top: "nav" } },
      meta: { page_title: "t" },
    });
    expect(stripped).toEqual({ title: "Hi", meta: { page_title: "t" } });
  });

  it("flags attached overlay structure", () => {
    expect(attachedOverlayStructureError({ title: "ok" })).toBeNull();
    expect(attachedOverlayStructureError({ sections: [{ type: "x" }] })).toMatch(/sections/);
    expect(attachedOverlayStructureError({ layout: {} })).toMatch(/layout/);
  });
});

describe("applyPerEntryLayer dataOnly", () => {
  it("ignores sections and layout when dataOnly", () => {
    const base = {
      title: "template",
      sections: [{ type: "hero", section_id: "h1" }],
      layout: { menu: { top: "default" } },
    };
    const overlay = {
      title: "entry",
      sections: [{ section_id: "h1", _remove: true }],
      layout: { menu: { top: "custom" } },
      meta: { description: "d" },
    };
    const merged = applyPerEntryLayer(base, overlay, undefined, undefined, true);
    expect(merged.title).toBe("entry");
    expect(merged.meta).toEqual({ description: "d" });
    expect(merged.sections).toEqual(base.sections);
    expect(merged.layout).toEqual(base.layout);
  });

  it("applies sections when not dataOnly", () => {
    const base = {
      sections: [{ type: "hero", section_id: "h1", heading: "A" }],
    };
    const overlay = {
      sections: [{ section_id: "h1", heading: "B" }],
    };
    const merged = applyPerEntryLayer(base, overlay, undefined, undefined, false);
    expect((merged.sections as Record<string, unknown>[])[0].heading).toBe("B");
  });
});

describe("html-page-cache variant keys", () => {
  it("includes variant in cache key", () => {
    expect(buildHtmlCacheKey("site", "/blog/post")).toBe("site::/blog/post::live");
    expect(buildHtmlCacheKey("site", "/blog/post", "draft")).toBe("site::/blog/post::draft");
    expect(buildHtmlCacheKey("site", "/blog/post?x=1", "default")).toBe("site::/blog/post::live");
  });
});
