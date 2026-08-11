import { describe, expect, it } from "vitest";
import {
  clampSchemaOrgSectionsLeading,
  isSchemaOrgSection,
  schemaOrgInsertIndex,
  countSchemaOrgOfType,
} from "@shared/schema-org-sections";

describe("schema-org-sections helpers", () => {
  it("detects schema_org sections", () => {
    expect(isSchemaOrgSection({ type: "schema_org", schema_type: "Course" })).toBe(true);
    expect(isSchemaOrgSection({ type: "hero" })).toBe(false);
  });

  it("clamps schema_org sections to a leading contiguous block", () => {
    const sections = [
      { type: "hero" },
      { type: "schema_org", schema_type: "Course" },
      { type: "faq" },
      { type: "schema_org", schema_type: "WebSite" },
    ];
    const clamped = clampSchemaOrgSectionsLeading(sections);
    expect(clamped.map((s) => s.type)).toEqual([
      "schema_org",
      "schema_org",
      "hero",
      "faq",
    ]);
    expect(clamped[0].schema_type).toBe("Course");
    expect(clamped[1].schema_type).toBe("WebSite");
  });

  it("inserts new schema_org after existing leading ones", () => {
    const sections = [
      { type: "schema_org", schema_type: "Course" },
      { type: "hero" },
    ];
    expect(schemaOrgInsertIndex(sections)).toBe(1);
  });

  it("counts schema_org by schema_type", () => {
    const sections = [
      { type: "schema_org", schema_type: "Course" },
      { type: "schema_org", schema_type: "LocalBusiness" },
      { type: "schema_org", schema_type: "Course" },
    ];
    expect(countSchemaOrgOfType(sections, "Course")).toBe(2);
    expect(countSchemaOrgOfType(sections, "WebSite")).toBe(0);
  });
});
