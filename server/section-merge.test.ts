import { describe, it, expect } from "vitest";
import { applyPerEntryLayer } from "./section-merge";
import { canonicalSectionId, sectionIdCandidates, sectionMatchesId } from "./utils/sectionIdentity";

const base = () => ({
  sections: [
    { type: "hero", section_id: "hero-aaa" },
    { type: "faq", section_id: "faq-bbb", title: "FAQ" },
    // Legacy template section not yet migrated: carries both fields
    { type: "cta", section_id: "cta-ccc", id: "cta-legacy" },
  ],
});

describe("canonicalSectionId helpers", () => {
  it("prefers section_id over legacy id", () => {
    expect(canonicalSectionId({ section_id: "a", id: "b" })).toBe("a");
    expect(canonicalSectionId({ id: "b" })).toBe("b");
    expect(canonicalSectionId({})).toBeUndefined();
  });

  it("candidates include both fields, canonical first", () => {
    expect(sectionIdCandidates({ section_id: "a", id: "b" })).toEqual(["a", "b"]);
    expect(sectionIdCandidates({ section_id: "a", id: "a" })).toEqual(["a"]);
  });

  it("matches either identity field", () => {
    expect(sectionMatchesId({ section_id: "a", id: "b" }, "b")).toBe(true);
    expect(sectionMatchesId({ section_id: "a" }, "b")).toBe(false);
  });
});

describe("applyPerEntryLayer identity matching", () => {
  it("patches a base section by section_id", () => {
    const result = applyPerEntryLayer(base(), {
      sections: [{ section_id: "faq-bbb", title: "Custom FAQ" }],
    });
    const sections = result.sections as Record<string, unknown>[];
    expect(sections).toHaveLength(3);
    expect(sections[1].title).toBe("Custom FAQ");
    expect(sections[1]._perEntryPatched).toBe(true);
  });

  it("patches a legacy base section referenced by its old internal id", () => {
    const result = applyPerEntryLayer(base(), {
      sections: [{ id: "cta-legacy", label: "patched" }],
    });
    const sections = result.sections as Record<string, unknown>[];
    expect(sections).toHaveLength(3);
    expect(sections[2].label).toBe("patched");
    expect(sections[2]._perEntryPatched).toBe(true);
  });

  it("removes a base section via _remove keyed by section_id", () => {
    const result = applyPerEntryLayer(base(), {
      sections: [{ section_id: "faq-bbb", _remove: true }],
    });
    const sections = result.sections as Record<string, unknown>[];
    expect(sections.map((s) => s.type)).toEqual(["hero", "cta"]);
  });

  it("removes a legacy base section via _remove keyed by old internal id", () => {
    const result = applyPerEntryLayer(base(), {
      sections: [{ id: "cta-legacy", _remove: true }],
    });
    const sections = result.sections as Record<string, unknown>[];
    expect(sections.map((s) => s.type)).toEqual(["hero", "faq"]);
  });

  it("treats unmatched sections as per-entry additions and honors _insertAfterSectionId", () => {
    const result = applyPerEntryLayer(base(), {
      sections: [
        { section_id: "new-xyz", type: "banner", _insertAfterSectionId: "hero-aaa" },
      ],
    });
    const sections = result.sections as Record<string, unknown>[];
    expect(sections.map((s) => s.type)).toEqual(["hero", "banner", "faq", "cta"]);
    expect(sections[1]._perEntrySource).toBe(true);
  });

  it("resolves anchors written against a legacy internal id", () => {
    const result = applyPerEntryLayer(base(), {
      sections: [
        { section_id: "new-xyz", type: "banner", _insertAfterSectionId: "cta-legacy" },
      ],
    });
    const sections = result.sections as Record<string, unknown>[];
    expect(sections.map((s) => s.type)).toEqual(["hero", "faq", "cta", "banner"]);
  });
});
