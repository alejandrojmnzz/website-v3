import { describe, expect, it } from "vitest";
import { isDeclaredOrImplicitDefaultVariant } from "./section-variants";

describe("isDeclaredOrImplicitDefaultVariant", () => {
  it("allows default when schema declares no variants", () => {
    expect(isDeclaredOrImplicitDefaultVariant("default", [])).toBe(true);
  });

  it("rejects non-default when schema declares no variants", () => {
    expect(isDeclaredOrImplicitDefaultVariant("course", [])).toBe(false);
  });

  it("allows default when declared in variants map", () => {
    expect(isDeclaredOrImplicitDefaultVariant("default", ["default"])).toBe(true);
  });

  it("rejects variant not in declared keys", () => {
    expect(isDeclaredOrImplicitDefaultVariant("default", ["course", "orbit"])).toBe(
      false,
    );
    expect(isDeclaredOrImplicitDefaultVariant("orbit", ["course", "orbit"])).toBe(
      true,
    );
  });
});
