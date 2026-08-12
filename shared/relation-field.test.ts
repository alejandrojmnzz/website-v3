import { describe, expect, it } from "vitest";
import {
  coerceRelationFieldInput,
  deslugifyLabel,
  normalizeRelationPointers,
} from "@shared/relation-field";

describe("relation-field", () => {
  it("deslugifyLabel title-cases hyphenated slugs", () => {
    expect(deslugifyLabel("ada-lovelace")).toBe("Ada Lovelace");
  });

  it("rejects Person objects", () => {
    const r = normalizeRelationPointers({ name: "Ada", "@type": "Person" });
    expect(r.ok).toBe(false);
  });

  it("multiple always returns string[]", () => {
    const r = coerceRelationFieldInput("ada", { type: "relation", multiple: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["ada"]);
  });

  it("required fails on empty array", () => {
    const r = coerceRelationFieldInput([], {
      type: "relation",
      multiple: true,
      required: true,
    });
    expect(r.ok).toBe(false);
  });

  it("preserves primary order", () => {
    const r = coerceRelationFieldInput(["bob", "ada"], {
      type: "relation",
      multiple: true,
      required: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["bob", "ada"]);
  });
});
