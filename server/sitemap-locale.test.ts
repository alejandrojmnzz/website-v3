import { describe, expect, it } from "vitest";
import { filterSitemapUrlsByLocale } from "./sitemap-locale";

const enUs = { loc: "https://4geeks.com/us/full-stack", label: "Full Stack (EN)", locale: "en" };
const enPath = { loc: "https://4geeks.com/en/program-comparison", label: "Comparison (EN)", locale: "en" };
const es = { loc: "https://4geeks.com/es/full-stack", label: "Full Stack (ES)", locale: "es" };
const home = { loc: "https://4geeks.com/", label: "Home" };

describe("filterSitemapUrlsByLocale", () => {
  const urls = [enUs, enPath, es, home];

  it("returns all rows when locale is empty", () => {
    expect(filterSitemapUrlsByLocale(urls, undefined)).toEqual(urls);
    expect(filterSitemapUrlsByLocale(urls, "")).toEqual(urls);
    expect(filterSitemapUrlsByLocale(urls, "  ")).toEqual(urls);
  });

  it("keeps English rows including /us/ paths tagged locale en", () => {
    expect(filterSitemapUrlsByLocale(urls, "en")).toEqual([enUs, enPath, home]);
  });

  it("keeps Spanish rows and drops /us/ English pages", () => {
    expect(filterSitemapUrlsByLocale(urls, "es")).toEqual([es, home]);
  });

  it("keeps locale-less rows such as Home in every locale list", () => {
    expect(filterSitemapUrlsByLocale(urls, "es")).toContainEqual(home);
    expect(filterSitemapUrlsByLocale(urls, "en")).toContainEqual(home);
  });
});
