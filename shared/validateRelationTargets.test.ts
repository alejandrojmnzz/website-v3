import { describe, expect, it } from "vitest";
import {
  collectIdsFromItems,
  relationIndexKey,
  relationTargetMissing,
} from "./validateRelationTargets";

describe("relation target index", () => {
  it("builds a set from value path with slug fallback", () => {
    const ids = collectIdsFromItems(
      [
        { slug: "ada-lovelace", name: "Ada" },
        { bc_slug: "alan-turing" },
        { custom: "x", slug: "ignored-if-custom" },
      ],
      "slug",
    );
    expect(ids.has("ada-lovelace")).toBe(true);
    expect(ids.has("alan-turing")).toBe(true);
  });

  it("uses a custom value path", () => {
    const ids = collectIdsFromItems([{ uid: "a1", slug: "ada" }], "uid");
    expect(ids.has("a1")).toBe(true);
    expect(relationTargetMissing("ada", ids)).toBe(true);
    expect(relationTargetMissing("a1", ids)).toBe(false);
  });

  it("unions locales into one set (fallback)", () => {
    const en = collectIdsFromItems([{ slug: "ada" }], "slug");
    const es = collectIdsFromItems([{ slug: "ada" }, { slug: "only-es" }], "slug");
    const union = new Set([...en, ...es]);
    expect(relationTargetMissing("ada", union)).toBe(false);
    expect(relationTargetMissing("only-es", union)).toBe(false);
    expect(relationTargetMissing("missing", union)).toBe(true);
  });

  it("keys index by source and value path", () => {
    expect(relationIndexKey("authors", "slug")).toBe("authors::slug");
    expect(relationIndexKey("authors", "")).toBe("authors::slug");
  });
});
