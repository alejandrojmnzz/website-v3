import { describe, expect, it } from "vitest";
import { resolveSeoMonitoringConfig } from "./seo-monitoring";

describe("seo-monitoring", () => {
  it("treats omitted config as disabled", () => {
    expect(resolveSeoMonitoringConfig(undefined)).toEqual({
      enabled: false,
      require_cluster: false,
    });
    expect(resolveSeoMonitoringConfig(null)).toEqual({
      enabled: false,
      require_cluster: false,
    });
    expect(resolveSeoMonitoringConfig({})).toEqual({
      enabled: false,
      require_cluster: false,
    });
  });

  it("enables when enabled true", () => {
    expect(resolveSeoMonitoringConfig({ enabled: true })).toEqual({
      enabled: true,
      require_cluster: false,
    });
    expect(resolveSeoMonitoringConfig({ enabled: true, require_cluster: true })).toEqual({
      enabled: true,
      require_cluster: true,
    });
  });
});
