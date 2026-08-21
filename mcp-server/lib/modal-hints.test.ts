import { describe, expect, it } from "vitest";
import { hintsAfterAddModal, hintsAfterReplaceModals } from "./modal-hints";

describe("hintsAfterAddModal", () => {
  it("is silent when adding a non-modal", () => {
    const result = hintsAfterAddModal({
      newSection: { type: "hero" },
      existingSectionCount: 2,
      slug: "test",
      locale: "en",
    });
    expect(result.warnings).toEqual([]);
    expect(result.next_actions).toEqual([]);
  });

  it("is silent when modal already has section_id", () => {
    const result = hintsAfterAddModal({
      newSection: { type: "modal", section_id: "apply-modal" },
      existingSectionCount: 1,
      slug: "test",
      locale: "en",
    });
    expect(result.warnings).toEqual([]);
    expect(result.next_actions).toEqual([]);
  });

  it("warns when modal lacks section_id and points update_fields at insert index", () => {
    const result = hintsAfterAddModal({
      newSection: { type: "modal", heading: "Apply" },
      insertIndex: 2,
      existingSectionCount: 5,
      slug: "home",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toEqual(["modal_missing_section_id"]);
    const uf = result.next_actions.find((a) => a.tool === "update_fields");
    expect(uf?.priority).toBe("recommended");
    const updates = uf?.args_hint?.updates as Array<{ field_path: string }>;
    expect(updates?.[0]?.field_path).toBe("sections.2.section_id");
    expect(result.next_actions.some((a) => a.tool === "explain_site")).toBe(true);
  });

  it("uses append index when insertIndex omitted", () => {
    const result = hintsAfterAddModal({
      newSection: { type: "modal" },
      existingSectionCount: 3,
      slug: "home",
      locale: "es",
    });
    const uf = result.next_actions.find((a) => a.tool === "update_fields");
    const updates = uf?.args_hint?.updates as Array<{ field_path: string }>;
    expect(updates?.[0]?.field_path).toBe("sections.3.section_id");
  });
});

describe("hintsAfterReplaceModals", () => {
  it("is silent when no modals or all have ids", () => {
    expect(
      hintsAfterReplaceModals({
        sections: [{ type: "hero" }, { type: "modal", section_id: "x" }],
        slug: "t",
        locale: "en",
      }).warnings,
    ).toEqual([]);
  });

  it("warns once and emits update_fields per missing modal", () => {
    const result = hintsAfterReplaceModals({
      sections: [
        { type: "modal" },
        { type: "hero" },
        { type: "modal", section_id: "" },
      ],
      slug: "t",
      locale: "en",
    });
    expect(result.warnings.map((w) => w.code)).toEqual(["modal_missing_section_id"]);
    const uf = result.next_actions.filter((a) => a.tool === "update_fields");
    expect(uf).toHaveLength(2);
    expect(
      (uf[0]?.args_hint?.updates as Array<{ field_path: string }>)[0]?.field_path,
    ).toBe("sections.0.section_id");
    expect(
      (uf[1]?.args_hint?.updates as Array<{ field_path: string }>)[0]?.field_path,
    ).toBe("sections.2.section_id");
  });
});
