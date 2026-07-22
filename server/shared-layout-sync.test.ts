import { describe, it, expect } from "vitest";
import {
  sectionIsTemplateExpressionsOnly,
  prepareSiblingMirroredSection,
  HIDDEN_LOCATION_SENTINEL,
  isHiddenViaSentinel,
  reorderSectionsByIds,
  removeSectionById,
  isAllowlistedSectionFieldPath,
  applyAllowlistedLayout,
  stripSectionLabels,
} from "./shared-layout-sync";

describe("shared-layout-sync", () => {
  it("detects template-expression-only sections", () => {
    expect(
      sectionIsTemplateExpressionsOnly({
        type: "hero",
        version: "1.0",
        section_id: "hero-1",
        title: "{{ single.title }}",
        subtitle: "{{ single.description | x }}",
      }),
    ).toBe(true);

    expect(
      sectionIsTemplateExpressionsOnly({
        type: "hero",
        section_id: "hero-1",
        title: "Hardcoded English",
      }),
    ).toBe(false);
  });

  it("mirrors new sections with label + hide when content needs locale work", () => {
    const source = {
      type: "cta",
      section_id: "cta-1",
      title: "Join now",
      paddingY: { desktop: "sm" },
    };
    const mirrored = prepareSiblingMirroredSection(source, "jane.doe");
    expect(mirrored.section_id).toBe("cta-1");
    expect(mirrored.title).toBe("Join now");
    expect((mirrored._label as { needs: string; requester: string }).needs).toBe("edit");
    expect((mirrored._label as { requester: string }).requester).toBe("jane.doe");
    expect(isHiddenViaSentinel(mirrored)).toBe(true);
    expect(mirrored.showOnLocations).toEqual([HIDDEN_LOCATION_SENTINEL]);
  });

  it("skips label+hide when section is only template expressions", () => {
    const source = {
      type: "hero",
      section_id: "hero-1",
      title: "{{ single.title }}",
    };
    const mirrored = prepareSiblingMirroredSection(source, "jane.doe");
    expect(mirrored._label).toBeUndefined();
    expect(isHiddenViaSentinel(mirrored)).toBe(false);
  });

  it("allowlists layout field paths but not content props", () => {
    expect(isAllowlistedSectionFieldPath("showOn")).toBe(true);
    expect(isAllowlistedSectionFieldPath("paddingY.desktop")).toBe(true);
    expect(isAllowlistedSectionFieldPath("title")).toBe(false);
    expect(isAllowlistedSectionFieldPath("cta.text")).toBe(false);
  });

  it("applies allowlisted layout without copying type/variant", () => {
    const target: Record<string, unknown> = {
      type: "hero",
      variant: "old",
      section_id: "h1",
      title: "ES title",
    };
    applyAllowlistedLayout(target, {
      type: "hero",
      variant: "new",
      section_id: "h1",
      showOn: "desktop",
      title: "EN title",
    });
    expect(target.variant).toBe("old");
    expect(target.title).toBe("ES title");
    expect(target.showOn).toBe("desktop");
  });

  it("reorders by section ids preserving content", () => {
    const sections = [
      { section_id: "a", title: "A" },
      { section_id: "b", title: "B" },
      { section_id: "c", title: "C" },
    ];
    const reordered = reorderSectionsByIds(sections, ["c", "a", "b"]);
    expect(reordered.map((s) => s.section_id)).toEqual(["c", "a", "b"]);
    expect(reordered[0].title).toBe("C");
  });

  it("removes by section id", () => {
    const { sections, removed } = removeSectionById(
      [{ section_id: "a" }, { section_id: "b" }],
      "a",
    );
    expect(removed).toBe(true);
    expect(sections).toHaveLength(1);
    expect(sections[0].section_id).toBe("b");
  });

  it("strips _label from nested data", () => {
    const stripped = stripSectionLabels({
      sections: [{ type: "hero", _label: { needs: "edit" }, title: "x" }],
    });
    expect((stripped.sections as Record<string, unknown>[])[0]._label).toBeUndefined();
    expect((stripped.sections as Record<string, unknown>[])[0].title).toBe("x");
  });
});
