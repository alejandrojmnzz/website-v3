import { describe, expect, it } from "vitest";
import {
  formatDurationMs,
  formatRunAgo,
} from "./diagnosticsJobService";

describe("diagnostics confirm helpers", () => {
  it("formatDurationMs humanizes", () => {
    expect(formatDurationMs(null)).toBe("unknown");
    expect(formatDurationMs(45000)).toBe("45s");
    expect(formatDurationMs(260000)).toBe("4m 20s");
    expect(formatDurationMs(3600000)).toBe("1h");
    expect(formatDurationMs(3900000)).toBe("1h 5m");
  });

  it("formatRunAgo humanizes", () => {
    expect(formatRunAgo(null)).toBe("never");
    expect(formatRunAgo(Date.now() - 30_000)).toMatch(/s ago$/);
    expect(formatRunAgo(Date.now() - 3 * 60 * 60 * 1000)).toMatch(/hour/);
  });
});
