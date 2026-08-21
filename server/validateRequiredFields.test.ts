import { describe, it, expect } from "vitest";
import {
  validateRequiredFields,
  listRequiredEditorFields,
  isEmptyRequiredValue,
  satisfyRequiredEditorField,
  effectiveRequiredMode,
} from "@shared/validateRequiredFields";

const ctaSchema = {
  type: "object",
  required: ["title", "subtitle", "conversion_name"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    conversion_name: { type: "string" },
  },
  additionalProperties: true,
};

describe("validateRequiredFields", () => {
  it("lists required editor keys including attached when shared and not detached", () => {
    expect(
      listRequiredEditorFields(
        {
          title: { required: true },
          call_to_action: { required: "attached" },
          category: { type: "select" },
        },
        { isSharedLayout: true, isDetached: false },
      ),
    ).toEqual(["title", "call_to_action"]);
  });

  it("skips attached-required when detached", () => {
    expect(
      listRequiredEditorFields(
        {
          title: { required: true },
          call_to_action: { required: "attached" },
        },
        { isSharedLayout: true, isDetached: true },
      ),
    ).toEqual(["title"]);
  });

  it("treats attached as always required when not shared-layout", () => {
    expect(
      listRequiredEditorFields(
        { call_to_action: { required: "attached" } },
        { isSharedLayout: false, isDetached: false },
      ),
    ).toEqual(["call_to_action"]);
  });

  it("treats empty string and templates as empty", () => {
    expect(isEmptyRequiredValue("")).toBe(true);
    expect(isEmptyRequiredValue("  ")).toBe(true);
    expect(isEmptyRequiredValue("{{ single.title }}")).toBe(true);
    expect(isEmptyRequiredValue("Real title")).toBe(false);
    expect(isEmptyRequiredValue({})).toBe(true);
  });

  it("fails when a required field is empty with mode-aware message", () => {
    const result = validateRequiredFields(
      { title: { required: true }, description: { required: true } },
      { title: "Hello", description: "" },
      "publish",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].field).toBe("description");
      expect(result.errors[0].message).toContain("editor.required: true");
    }
  });

  it("passes when all required fields are set", () => {
    expect(
      validateRequiredFields(
        { title: { required: true }, description: { required: true } },
        { title: "Hello", description: "World" },
        "live_update",
      ),
    ).toEqual({ ok: true });
  });

  it("fails empty call_to_action object for attached mode", () => {
    const result = validateRequiredFields(
      {
        call_to_action: {
          type: "json",
          required: "attached",
          schema: ctaSchema,
        },
      },
      { call_to_action: {} },
      "publish",
      { isSharedLayout: true, isDetached: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain("editor.required: attached");
    }
  });

  it("fails partial call_to_action missing conversion_name via schema", () => {
    const errors = satisfyRequiredEditorField(
      "call_to_action",
      { title: "T", subtitle: "S" },
      { type: "json", required: "attached", schema: ctaSchema },
      "attached",
      { conversionNames: ["student_application"], crmTags: [] },
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field.includes("conversion_name"))).toBe(true);
  });

  it("passes valid call_to_action with known conversion_name", () => {
    const errors = satisfyRequiredEditorField(
      "call_to_action",
      {
        title: "T",
        subtitle: "S",
        conversion_name: "student_application",
      },
      { type: "json", required: "attached", schema: ctaSchema },
      "attached",
      { conversionNames: ["student_application"], crmTags: [] },
    );
    expect(errors).toEqual([]);
  });

  it("effectiveRequiredMode is null when detached and attached-required", () => {
    expect(
      effectiveRequiredMode(
        { required: "attached" },
        { isSharedLayout: true, isDetached: true },
      ),
    ).toBeNull();
  });
});
