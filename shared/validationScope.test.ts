import { describe, it, expect } from "vitest";
import {
  isCommonOperationalOnly,
  resolveMicroValidationFlags,
  shouldSkipLiveGate,
} from "./validationScope";

describe("validationScope", () => {
  it("skips gate for locations-only micro writes", () => {
    expect(shouldSkipLiveGate("micro", ["locations"])).toBe(true);
    expect(isCommonOperationalOnly(["locations"])).toBe(true);
  });

  it("does not skip gate for empty touched paths (backward compat full gate)", () => {
    expect(shouldSkipLiveGate("micro", [])).toBe(false);
  });

  it("visibility-only micro write skips meta validation", () => {
    const flags = resolveMicroValidationFlags({
      intent: "micro",
      touchedPaths: ["meta.robots"],
    });
    expect(flags.metaKeys).toEqual([]);
    expect(flags.bodyKeys).toEqual([]);
    expect(flags.runSchemaOrgCompanion).toBe(false);
  });

  it("publish runs full validation", () => {
    const flags = resolveMicroValidationFlags({ intent: "publish", touchedPaths: [] });
    expect(flags.runFull).toBe(true);
    expect(flags.metaKeys).toBeNull();
  });
});
