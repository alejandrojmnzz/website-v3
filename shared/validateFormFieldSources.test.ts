import { describe, expect, it } from "vitest";
import {
  validateFormFieldSources,
  formatFormFieldSourceErrors,
} from "./validateFormFieldSources";

const editor = {
  programs: {
    type: "relation" as const,
    source: "program",
    value: "slug",
    multiple: true,
    required: true,
  },
};

describe("validateFormFieldSources", () => {
  it("blocks relation + slugs", () => {
    const issues = validateFormFieldSources({
      singleEntry: { programs: ["ai-engineering"] },
      editor,
      formObjects: [
        {
          form: {
            fields: {
              program: {
                source: { related_field: "programs", value_path: "slug", label_path: "title" },
                slugs: ["ai-engineering"],
              },
            },
          },
        },
      ],
      mode: "publish",
    });
    expect(issues.some((i) => i.code === "relation_and_slugs")).toBe(true);
  });

  it("hard-fails empty relation on publish", () => {
    const issues = validateFormFieldSources({
      singleEntry: { programs: [] },
      editor,
      sections: [
        {
          type: "lead_form",
          fields: { program: { source: { related_field: "programs", value_path: "slug", label_path: "title" } } },
        },
      ],
      mode: "publish",
    });
    expect(issues.some((i) => i.code === "relation_empty" && i.severity === "error")).toBe(
      true,
    );
    expect(formatFormFieldSourceErrors(issues)).toMatch(/programs/);
    expect(issues[0]?.formPath).toContain("fields.program.source.related_field");
  });

  it("soft-warns empty relation on draft", () => {
    const issues = validateFormFieldSources({
      singleEntry: { programs: [] },
      editor,
      formObjects: [
        {
          form: {
            fields: { program: { source: { related_field: "programs", value_path: "slug", label_path: "title" } } },
          },
        },
      ],
      mode: "draft",
    });
    expect(issues.some((i) => i.code === "relation_empty" && i.severity === "warning")).toBe(
      true,
    );
    expect(formatFormFieldSourceErrors(issues)).toBeNull();
  });

  it("fails missing CT field", () => {
    const issues = validateFormFieldSources({
      singleEntry: {},
      editor: {},
      formObjects: [
        {
          form: {
            fields: { program: { source: { related_field: "programs", value_path: "slug", label_path: "title" } } },
          },
        },
      ],
      mode: "draft",
    });
    expect(issues.some((i) => i.code === "relation_missing_field" && i.severity === "error")).toBe(
      true,
    );
  });

  it("allows empty catalog source on publish", () => {
    const issues = validateFormFieldSources({
      singleEntry: {},
      editor,
      formObjects: [
        {
          form: {
            fields: { program: { source: { content_type: "program", value_path: "bc_slug", label_path: "title" } } },
          },
        },
      ],
      mode: "publish",
    });
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("detects broken pointer when catalog provided", () => {
    const catalog = new Map([["ai-engineering", { label: "AI", bc_slug: "ai-engineering" }]]);
    const issues = validateFormFieldSources({
      singleEntry: { programs: ["no-such-program"] },
      editor,
      catalogsByRelationField: new Map([["programs", catalog]]),
      formObjects: [
        {
          form: {
            fields: { program: { source: { related_field: "programs", value_path: "slug", label_path: "title" } } },
          },
        },
      ],
      mode: "publish",
    });
    expect(issues.some((i) => i.code === "relation_broken_pointer")).toBe(true);
  });
});
