import { describe, expect, it } from "vitest";
import { originPathFromInput } from "./AddRedirectDialog";

describe("originPathFromInput", () => {
  it("extracts the path from a full URL and drops query and hash", () => {
    expect(
      originPathFromInput(
        "https://4geeks.com/us/coding-bootcamp?utm_source=google#hero",
      ),
    ).toBe("/us/coding-bootcamp");
  });

  it("strips query and hash from a path-only value", () => {
    expect(originPathFromInput("/es/old-page?foo=bar&x=1#section")).toBe(
      "/es/old-page",
    );
  });

  it("handles protocol-relative and host-without-scheme URLs", () => {
    expect(originPathFromInput("//4geeks.com/es/programa?ref=ad")).toBe(
      "/es/programa",
    );
    expect(originPathFromInput("www.4geeks.com/us/page?utm=1")).toBe("/us/page");
  });

  it("keeps regex patterns intact, including ?", () => {
    expect(originPathFromInput("/us/old-path/(.*)")).toBe("/us/old-path/(.*)");
    expect(originPathFromInput("/blog/(.*)?")).toBe("/blog/(.*)?");
  });

  it("replaces spaces with hyphens on plain paths", () => {
    expect(originPathFromInput("/us/old page")).toBe("/us/old-page");
  });

  it("returns empty for blank input", () => {
    expect(originPathFromInput("   ")).toBe("");
  });
});
