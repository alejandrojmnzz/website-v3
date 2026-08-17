import { describe, expect, it } from "vitest";
import { resolveDatabaseBackedRedirectDestination } from "./debug-redirect-db-dest";

describe("resolveDatabaseBackedRedirectDestination", () => {
  const known = new Set(["/en/how-to/ask", "/es/how-to/ask"]);
  const isKnownUrl = (url: string) => known.has(url);

  it("returns ok:false when no known URL matches", () => {
    const result = resolveDatabaseBackedRedirectDestination({
      destUrl: "/how-to/missing",
      allLanguages: true,
      builtUrl: "/en/how-to/missing",
      alternateUrls: {},
      isKnownUrl,
    });
    expect(result).toEqual({ ok: false });
  });

  it("uses locale map when allLanguages and multiple alternates exist", () => {
    const alts = {
      en: "/en/how-to/ask",
      es: "/es/how-to/ask",
    };
    const result = resolveDatabaseBackedRedirectDestination({
      destUrl: "/how-to/ask",
      allLanguages: true,
      builtUrl: "/en/how-to/ask",
      alternateUrls: alts,
      isKnownUrl,
    });
    expect(result).toEqual({ ok: true, to: alts });
  });

  it("uses single alternate when allLanguages and only one exists", () => {
    const result = resolveDatabaseBackedRedirectDestination({
      destUrl: "/how-to/ask",
      allLanguages: true,
      builtUrl: "/en/how-to/ask",
      alternateUrls: { en: "/en/how-to/ask" },
      isKnownUrl,
    });
    expect(result).toEqual({ ok: true, to: "/en/how-to/ask" });
  });

  it("keeps destUrl when it is already a known URL and allLanguages is off", () => {
    const result = resolveDatabaseBackedRedirectDestination({
      destUrl: "/es/how-to/ask",
      allLanguages: false,
      builtUrl: "/en/how-to/ask",
      alternateUrls: {
        en: "/en/how-to/ask",
        es: "/es/how-to/ask",
      },
      isKnownUrl,
    });
    expect(result).toEqual({ ok: true, to: "/es/how-to/ask" });
  });

  it("falls back to builtUrl when destUrl is stripped but known via build", () => {
    const result = resolveDatabaseBackedRedirectDestination({
      destUrl: "/how-to/ask",
      allLanguages: false,
      builtUrl: "/en/how-to/ask",
      alternateUrls: {},
      isKnownUrl,
    });
    expect(result).toEqual({ ok: true, to: "/en/how-to/ask" });
  });
});
