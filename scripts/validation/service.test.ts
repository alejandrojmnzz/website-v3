import { describe, expect, it } from "vitest";
import { mapSitemapUrlsToEntries, sitemapLocToPath } from "./service";

describe("sitemapLocToPath", () => {
  it("strips origin from absolute sitemap locs", () => {
    expect(sitemapLocToPath("https://4geeks.com/en/home")).toBe("/en/home");
    expect(sitemapLocToPath("https://4geeks.com/es/inicio/")).toBe("/es/inicio");
  });

  it("keeps path-only locs", () => {
    expect(sitemapLocToPath("/en/apply")).toBe("/en/apply");
  });
});

describe("mapSitemapUrlsToEntries", () => {
  it("maps content_type to type and normalizes loc", () => {
    expect(
      mapSitemapUrlsToEntries([
        {
          loc: "https://example.com/en/home",
          content_type: "page",
          slug: "home",
          locale: "en",
        },
        { loc: "https://example.com/" },
      ]),
    ).toEqual([
      { loc: "/en/home", type: "page", slug: "home", locale: "en" },
      { loc: "/", type: "static" },
    ]);
  });
});
