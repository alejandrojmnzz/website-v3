import { describe, expect, it, vi } from "vitest";

vi.mock("./content-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-types")>();
  return {
    ...actual,
    getHreflangsSource: vi.fn(),
    getContentTypeConfig: vi.fn(),
    resolveHreflangsFromRecord: vi.fn(),
    getFullFieldMapping: vi.fn(() => null),
  };
});

import { generateHreflangTags } from "./hreflang";
import {
  getContentTypeConfig,
  getHreflangsSource,
  resolveHreflangsFromRecord,
} from "./content-types";

describe("generateHreflangTags", () => {
  it("uses resolver URLs when ≥2 locales", () => {
    vi.mocked(getHreflangsSource).mockReturnValue("translations");
    const ci = {
      getLocaleUrls: () => ({
        en: "/en/how-to/how-to-foo",
        es: "/es/how-to/como-foo",
      }),
    } as any;

    const tags = generateHreflangTags("how-to", "how-to-foo", "en", undefined, undefined, ci);
    expect(tags.some((t) => t.includes('hreflang="en"') && t.includes("how-to-foo"))).toBe(true);
    expect(tags.some((t) => t.includes('hreflang="es"') && t.includes("como-foo"))).toBe(true);
    expect(tags.some((t) => t.includes('hreflang="x-default"'))).toBe(true);
  });

  it("does not invent same-slug alternates when _hreflangs is configured and map is incomplete", () => {
    vi.mocked(getHreflangsSource).mockReturnValue("translations");
    vi.mocked(resolveHreflangsFromRecord).mockReturnValue({ en: "how-to-foo" });
    vi.mocked(getContentTypeConfig).mockReturnValue({
      url_pattern: { en: "/en/how-to/:slug", es: "/es/how-to/:slug" },
    } as any);

    const ci = {
      getLocaleUrls: () => ({ en: "/en/how-to/how-to-foo" }),
    } as any;

    const tags = generateHreflangTags(
      "how-to",
      "how-to-foo",
      "en",
      { slug: "how-to-foo", translations: { us: "how-to-foo" } },
      undefined,
      ci,
    );
    expect(tags).toEqual([]);
  });
});
