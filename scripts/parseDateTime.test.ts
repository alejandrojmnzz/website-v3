import { describe, expect, it } from "vitest";
import {
  isDateOnlyValue,
  isTimezoneAwareDate,
  parseStoredDateTime,
} from "@shared/parseDateTime";

describe("parseDateTime", () => {
  it("detects timezone-aware vs naive formats", () => {
    expect(isTimezoneAwareDate("2024-03-13T13:47:07.183000Z")).toBe(true);
    expect(isTimezoneAwareDate("2024-03-13T13:47:07-04:00")).toBe(true);
    expect(isTimezoneAwareDate("2024-03-13T13:47:07+0000")).toBe(true);
    expect(isTimezoneAwareDate("2024-03-13T13:47:07")).toBe(false);
    expect(isTimezoneAwareDate("2024-03-13")).toBe(false);
    expect(isDateOnlyValue("2024-03-13")).toBe(true);
    expect(isDateOnlyValue("2024-03-13T13:47:07Z")).toBe(false);
  });

  it("keeps date-only calendar day (no UTC day-shift)", () => {
    const d = parseStoredDateTime("2026-01-01");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(1);
    expect(d!.getHours()).toBe(0);
    expect(d!.getMinutes()).toBe(0);
  });

  it("treats naive datetime as local wall time", () => {
    const d = parseStoredDateTime("2024-03-13T13:47:07");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(13);
    expect(d!.getHours()).toBe(13);
    expect(d!.getMinutes()).toBe(47);
    expect(d!.getSeconds()).toBe(7);
  });

  it("parses UTC Z as an absolute instant", () => {
    const d = parseStoredDateTime("2024-03-13T13:47:07.183Z");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2024-03-13T13:47:07.183Z");
  });
});
