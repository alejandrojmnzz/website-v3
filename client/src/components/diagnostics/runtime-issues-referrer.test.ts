import { describe, expect, it } from "vitest";
import { referrerDisplayHost } from "./runtime-issues-referrer";

describe("referrerDisplayHost", () => {
  it("strips protocol and path from http(s) URLs", () => {
    expect(referrerDisplayHost("https://www.google.com/search?q=4geeks")).toBe("www.google.com");
    expect(referrerDisplayHost("http://4geeks.com/es")).toBe("4geeks.com");
  });

  it("keeps a non-default port", () => {
    expect(referrerDisplayHost("https://localhost:5000/private")).toBe("localhost:5000");
  });

  it("treats protocol-less host paths as a domain", () => {
    expect(referrerDisplayHost("google.com/search")).toBe("google.com");
  });

  it("leaves relative paths unchanged", () => {
    expect(referrerDisplayHost("/us/blog/foo")).toBe("/us/blog/foo");
  });

  it("trims whitespace", () => {
    expect(referrerDisplayHost("  https://4geeks.com/  ")).toBe("4geeks.com");
  });
});
