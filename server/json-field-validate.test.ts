import { describe, expect, it } from "vitest";
import {
  jsonFieldFailureHttpBody,
  validateAndCoerceJsonFields,
  validateEditorHintsHaveJsonSchemas,
} from "./json-field-validate";

const schema = {
  type: "array",
  items: {
    type: "object",
    required: ["question", "answer"],
    properties: {
      question: { type: "string" },
      answer: { type: "string" },
    },
  },
};

describe("validateEditorHintsHaveJsonSchemas", () => {
  it("requires schema for json type", () => {
    const r = validateEditorHintsHaveJsonSchemas({
      faq_entries: { type: "json" },
    });
    expect(r.ok).toBe(false);
  });

  it("accepts compilable schema", () => {
    expect(
      validateEditorHintsHaveJsonSchemas({
        faq_entries: { type: "json", schema },
      }).ok,
    ).toBe(true);
  });
});

describe("validateAndCoerceJsonFields", () => {
  it("coerces string JSON and validates", () => {
    const r = validateAndCoerceJsonFields(
      {
        title: "x",
        faq_entries: JSON.stringify([{ question: "Q?", answer: "A." }]),
      },
      { faq_entries: { type: "json", schema } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.faq_entries).toEqual([{ question: "Q?", answer: "A." }]);
      expect(r.fields.title).toBe("x");
    }
  });

  it("returns schema on failure for MCP", () => {
    const r = validateAndCoerceJsonFields(
      { faq_entries: [{ question: "Q?" }] },
      { faq_entries: { type: "json", schema } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const body = jsonFieldFailureHttpBody(r.failures);
      expect(body.schema).toBeTruthy();
      expect(body.details[0].field).toBe("faq_entries");
    }
  });
});
