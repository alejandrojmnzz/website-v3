import { describe, it, expect } from "vitest";
import {
  validateRequiredFields,
  listRequiredEditorFields,
  isEmptyRequiredValue,
} from "@shared/validateRequiredFields";

describe("validateRequiredFields", () => {
  it("lists required editor keys", () => {
    expect(
      listRequiredEditorFields({
        title: { required: true },
        description: { required: true },
        category: { type: "select" },
      }),
    ).toEqual(["title", "description"]);
  });

  it("treats empty string and templates as empty", () => {
    expect(isEmptyRequiredValue("")).toBe(true);
    expect(isEmptyRequiredValue("  ")).toBe(true);
    expect(isEmptyRequiredValue("{{ single.title }}")).toBe(true);
    expect(isEmptyRequiredValue("Real title")).toBe(false);
  });

  it("fails when a required field is empty", () => {
    const result = validateRequiredFields(
      { title: { required: true }, description: { required: true } },
      { title: "Hello", description: "" },
      "publish",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].field).toBe("description");
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
});
