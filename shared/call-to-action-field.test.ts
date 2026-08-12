import { describe, expect, it } from "vitest";
import { validateCallToActionSemantics } from "./call-to-action-field";

const base = {
  title: "T",
  subtitle: "S",
  conversion_name: "student_application",
};

describe("validateCallToActionSemantics", () => {
  it("allows null / omit", () => {
    expect(
      validateCallToActionSemantics(null, {
        conversionNames: ["student_application"],
        crmTags: ["website-lead"],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects unknown conversion_name", () => {
    const r = validateCallToActionSemantics(
      { ...base, conversion_name: "nope" },
      { conversionNames: ["student_application"], crmTags: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("nope");
  });

  it("rejects tags when CRM allowlist is empty", () => {
    const r = validateCallToActionSemantics(
      { ...base, tags: "website-lead" },
      { conversionNames: ["student_application"], crmTags: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/leads_expected_tags is empty/i);
  });

  it("rejects unknown CRM tags", () => {
    const r = validateCallToActionSemantics(
      { ...base, tags: "website-lead, invented-tag" },
      {
        conversionNames: ["student_application"],
        crmTags: ["website-lead"],
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("invented-tag");
  });

  it("allows known CRM tags and omitted tags", () => {
    expect(
      validateCallToActionSemantics(
        { ...base, tags: "website-lead" },
        {
          conversionNames: ["student_application"],
          crmTags: ["website-lead", "contact-us"],
        },
      ),
    ).toEqual({ ok: true });
    expect(
      validateCallToActionSemantics(base, {
        conversionNames: ["student_application"],
        crmTags: [],
      }),
    ).toEqual({ ok: true });
  });
});
