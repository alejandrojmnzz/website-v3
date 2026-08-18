import { describe, it, expect } from "vitest";
import {
  effectiveProducts,
  enrollmentIdsOutsideFunnel,
  funnelHasProductsWithoutStage,
  normalizeFunnelBlock,
  scopeIncludesProduct,
} from "./funnel";

describe("effectiveProducts (1B)", () => {
  it("unions program slug with explicit list", () => {
    const funnel = normalizeFunnelBlock({ products: ["ai-flex"] });
    expect(effectiveProducts(funnel, { contentType: "program", contentSlug: "full-stack" })).toEqual([
      "ai-flex",
      "full-stack",
    ]);
  });

  it("returns self when program has no products key", () => {
    expect(effectiveProducts({}, { contentType: "program", contentSlug: "full-stack" })).toEqual([
      "full-stack",
    ]);
  });

  it("passes through non-program funnel products", () => {
    const funnel = normalizeFunnelBlock({ products: ["a", "b"] });
    expect(effectiveProducts(funnel, { contentType: "landing", contentSlug: "x" })).toEqual(["a", "b"]);
  });
});

describe("scopeIncludesProduct", () => {
  it("all includes any slug", () => {
    expect(scopeIncludesProduct("all", "anything")).toBe(true);
  });
});

describe("funnelHasProductsWithoutStage (3C)", () => {
  it("warns when products set without stage", () => {
    expect(funnelHasProductsWithoutStage({ products: ["x"] })).toBe(true);
    expect(funnelHasProductsWithoutStage({ products: "all" })).toBe(true);
    expect(funnelHasProductsWithoutStage({ stage: "awareness", products: ["x"] })).toBe(false);
  });
});

describe("enrollmentIdsOutsideFunnel (5B)", () => {
  it("flags card ids not in effective products", () => {
    const funnel = normalizeFunnelBlock({ products: ["a"] });
    expect(
      enrollmentIdsOutsideFunnel(["a", "b"], funnel, { contentType: "landing", contentSlug: "lp" }),
    ).toEqual(["b"]);
  });
});
