import { describe, expect, it } from "vitest";
import {
  normalizeFlexibleDate,
  parseFlexibleDate,
  toSitemapLastmod,
} from "@shared/normalizeFlexibleDate";

describe("normalizeFlexibleDate", () => {
  it("parses ISO date-only to UTC midnight ISO", () => {
    expect(normalizeFlexibleDate("2024-03-15")).toBe("2024-03-15T00:00:00.000Z");
  });

  it("parses ISO datetime with Z", () => {
    expect(normalizeFlexibleDate("2024-03-15T12:30:00Z")).toBe("2024-03-15T12:30:00.000Z");
  });

  it("parses unix seconds", () => {
    expect(normalizeFlexibleDate(1710502200)).toBe("2024-03-15T11:30:00.000Z");
  });

  it("parses unix milliseconds", () => {
    expect(normalizeFlexibleDate(1710502200000)).toBe("2024-03-15T11:30:00.000Z");
  });

  it("parses numeric string as unix seconds", () => {
    expect(normalizeFlexibleDate("1710502200")).toBe("2024-03-15T11:30:00.000Z");
  });

  it("accepts Date instances", () => {
    const d = new Date("2024-03-15T12:30:00.000Z");
    expect(normalizeFlexibleDate(d)).toBe("2024-03-15T12:30:00.000Z");
  });

  it("rejects ambiguous slash dates", () => {
    expect(normalizeFlexibleDate("01/02/2024")).toBeNull();
    expect(normalizeFlexibleDate("15-03-2024")).toBeNull();
  });

  it("rejects empty / null", () => {
    expect(normalizeFlexibleDate(null)).toBeNull();
    expect(normalizeFlexibleDate("")).toBeNull();
    expect(normalizeFlexibleDate(undefined)).toBeNull();
  });
});

describe("toSitemapLastmod", () => {
  it("returns YYYY-MM-DD from ISO", () => {
    expect(toSitemapLastmod("2024-03-15T12:30:00.000Z")).toBe("2024-03-15");
  });

  it("falls back to today when invalid", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(toSitemapLastmod("not-a-date")).toBe(today);
  });

  it("can skip fallback", () => {
    expect(toSitemapLastmod("not-a-date", false)).toBe("");
  });
});

describe("parseFlexibleDate", () => {
  it("returns null for garbage", () => {
    expect(parseFlexibleDate("hello")).toBeNull();
  });
});
