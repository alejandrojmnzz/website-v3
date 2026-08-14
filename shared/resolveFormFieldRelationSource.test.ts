import { describe, expect, it } from "vitest";
import {
  parseFormFieldSource,
  parseFormFieldSourceStrict,
  buildQueryOptionsUrl,
} from "./parseFormFieldSource";
import {
  applyChoiceCardinality,
  extractRelationOptionItems,
  resolveFormFieldRelationSource,
  resolveSubmitValueFromOptions,
} from "./resolveFormFieldRelationSource";
import { buildRelationSystemHints, buildEditorSystemHints } from "./editorSystemHints";

describe("parseFormFieldSourceStrict", () => {
  it("parses catalog string shorthand", () => {
    expect(parseFormFieldSourceStrict("program")).toEqual({
      ok: true,
      config: { content_type: "program", name: "program" },
    });
  });

  it("parses content_type object", () => {
    expect(
      parseFormFieldSourceStrict({
        content_type: "program",
        query: "purchasable=true",
      }),
    ).toEqual({
      ok: true,
      config: {
        content_type: "program",
        name: "program",
        query: "purchasable=true",
      },
    });
  });

  it("parses relation object", () => {
    expect(
      parseFormFieldSourceStrict({ relation: "programs", value: "slug" }),
    ).toEqual({
      ok: true,
      config: { relation: "programs", value: "slug" },
    });
  });

  it("rejects content_type + relation", () => {
    const r = parseFormFieldSourceStrict({
      content_type: "program",
      relation: "programs",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects name + relation", () => {
    const r = parseFormFieldSourceStrict({
      name: "program",
      relation: "programs",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty object", () => {
    const r = parseFormFieldSourceStrict({});
    expect(r.ok).toBe(false);
  });
});

describe("buildQueryOptionsUrl", () => {
  it("requires content_type or database", () => {
    expect(() =>
      buildQueryOptionsUrl({ relation: "programs" }),
    ).toThrow(/content_type or source.database/);
  });

  it("emits content_type and keeps source for callers", () => {
    expect(
      buildQueryOptionsUrl({ content_type: "program", query: "purchasable=true" }),
    ).toBe("/api/query-options?content_type=program&source=program&purchasable=true");
  });
});

describe("extractRelationOptionItems", () => {
  it("reads pointer arrays", () => {
    const r = extractRelationOptionItems(["ai-engineering", "full-stack"], "slug");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items.map((i) => i.pointer)).toEqual([
        "ai-engineering",
        "full-stack",
      ]);
    }
  });

  it("reads hydrated objects", () => {
    const r = extractRelationOptionItems(
      [
        { slug: "ai-engineering", title: "AI Engineering", bc_slug: "aie" },
      ],
      "slug",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items[0]).toMatchObject({
        pointer: "ai-engineering",
        label: "AI Engineering",
        bc_slug: "aie",
      });
    }
  });

  it("treats empty string as empty", () => {
    const r = extractRelationOptionItems("", "slug");
    expect(r.ok && r.items).toEqual([]);
  });
});

describe("resolveFormFieldRelationSource", () => {
  const hint = {
    type: "relation" as const,
    source: "program",
    value: "slug",
    multiple: true,
    required: true,
  };

  it("resolves pointers from singleEntry", () => {
    const r = resolveFormFieldRelationSource({
      formFieldName: "program",
      relationField: "programs",
      singleEntry: { programs: ["ai-engineering"] },
      editorHint: hint,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.options).toHaveLength(1);
      expect(r.options[0]!.value).toBe("ai-engineering");
    }
  });

  it("fails empty with staff message citing both paths", () => {
    const r = resolveFormFieldRelationSource({
      formFieldName: "program",
      relationField: "programs",
      singleEntry: { programs: [] },
      editorHint: hint,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("empty");
      expect(r.error).toContain("fields.program.source.relation");
      expect(r.error).toContain("programs");
      expect(r.staffMessage.length).toBeGreaterThan(20);
    }
  });

  it("fails missing hint", () => {
    const r = resolveFormFieldRelationSource({
      formFieldName: "program",
      relationField: "programs",
      singleEntry: {},
      editorHint: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_hint");
  });

  it("fails broken pointer when requireCatalogHit", () => {
    const r = resolveFormFieldRelationSource({
      formFieldName: "program",
      relationField: "programs",
      singleEntry: { programs: ["nope"] },
      editorHint: hint,
      catalogByPointer: new Map([["ai-engineering", { label: "AI" }]]),
      requireCatalogHit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("broken_pointer");
      expect(r.badPointer).toBe("nope");
    }
  });

  it("works for arbitrary relation field names (authors)", () => {
    const r = resolveFormFieldRelationSource({
      formFieldName: "author",
      relationField: "authors",
      singleEntry: { authors: ["ada-lovelace"] },
      editorHint: {
        type: "relation",
        source: "authors",
        value: "slug",
        multiple: true,
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe("applyChoiceCardinality", () => {
  it("single → hide + default", () => {
    const c = applyChoiceCardinality(
      { visible: true, required: true, default: "x" },
      [{ value: "ai-engineering", label: "AI", bc_slug: "aie" }],
    );
    expect(c.mode).toBe("single");
    expect(c.visible).toBe(false);
    expect(c.default).toBe("aie");
  });

  it("multi → show required", () => {
    const c = applyChoiceCardinality(
      { visible: false },
      [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    );
    expect(c.mode).toBe("multi");
    expect(c.visible).toBe(true);
    expect(c.required).toBe(true);
    expect(c.default).toBe("");
  });
});

describe("resolveSubmitValueFromOptions", () => {
  it("prefers bc_slug", () => {
    expect(
      resolveSubmitValueFromOptions("ai-engineering", [
        { value: "ai-engineering", label: "AI", bc_slug: "aie" },
      ]),
    ).toBe("aie");
  });
});

describe("buildRelationSystemHints", () => {
  it("substitutes field name without hardcoding program", () => {
    const hints = buildRelationSystemHints("authors", {
      type: "relation",
      source: "authors",
      value: "slug",
      multiple: true,
      required: true,
    });
    expect(hints.some((h) => h.includes('"authors"'))).toBe(true);
    expect(hints.some((h) => h.includes("source.relation: \"authors\""))).toBe(
      true,
    );
    expect(hints.every((h) => !h.toLowerCase().includes("crm"))).toBe(true);
  });

  it("buildEditorSystemHints returns undefined for non-relation", () => {
    expect(buildEditorSystemHints("title", { type: "text" })).toBeUndefined();
  });
});

describe("parseFormFieldSource compat", () => {
  it("still parses catalog strings", () => {
    expect(parseFormFieldSource("program:slug=a")).toEqual({
      content_type: "program",
      name: "program",
      query: "slug=a",
    });
  });
});
