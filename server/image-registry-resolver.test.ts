import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageRegistry } from "@shared/schema";
import type { SiteContext } from "./site-manager";

vi.mock("./site-manager", () => ({
  getSiteContextMap: vi.fn(),
  getDefaultSite: vi.fn(),
}));

import { getDefaultSite, getSiteContextMap } from "./site-manager";
import {
  getFallbackSiteContext,
  getMergedImageRegistry,
  mergeImageRegistries,
  resolveImageEntry,
} from "./image-registry-resolver";

const getSiteContextMapMock = vi.mocked(getSiteContextMap);
const getDefaultSiteMock = vi.mocked(getDefaultSite);

function makeSite(
  overrides: Partial<SiteContext> & {
    domain: string;
    contentFolder: string;
    contentRoot: string;
    registry?: ImageRegistry | null;
    fallbackContentFolder?: string;
  },
): SiteContext {
  const {
    domain,
    contentFolder,
    contentRoot,
    registry = null,
    fallbackContentFolder,
    ...rest
  } = overrides;
  return {
    config: {
      domain,
      contentFolder,
      ...(fallbackContentFolder ? { fallbackContentFolder } : {}),
    },
    contentRoot,
    contentRootName: contentFolder,
    mediaGallery: {
      getRegistry: () => registry,
    } as SiteContext["mediaGallery"],
    ...rest,
  } as SiteContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mergeImageRegistries", () => {
  it("lets primary overlay fallback on the same image id", () => {
    const fallback: ImageRegistry = {
      presets: { card: { aspect_ratio: "4:3", widths: [400], quality: 80, description: "f" } },
      images: {
        shared: { src: "/fallback/shared.png", alt: "fallback" },
        onlyFallback: { src: "/fallback/only.png", alt: "only fb" },
      },
    };
    const primary: ImageRegistry = {
      presets: { hero: { aspect_ratio: "16:9", widths: [800], quality: 85, description: "p" } },
      images: {
        shared: { src: "/primary/shared.png", alt: "primary" },
        onlyPrimary: { src: "/primary/only.png", alt: "only p" },
      },
    };

    const merged = mergeImageRegistries(fallback, primary);

    expect(merged.images.shared.src).toBe("/primary/shared.png");
    expect(merged.images.shared.alt).toBe("primary");
    expect(merged.images.onlyFallback.src).toBe("/fallback/only.png");
    expect(merged.images.onlyPrimary.src).toBe("/primary/only.png");
    expect(merged.presets.card).toBeDefined();
    expect(merged.presets.hero).toBeDefined();
  });

  it("treats array-shaped images/presets as empty maps", () => {
    const fallback: ImageRegistry = {
      presets: { card: { aspect_ratio: null, widths: [1], quality: 1, description: "x" } },
      images: { a: { src: "/a.png", alt: "a" } },
    };
    const primary = {
      presets: [] as unknown as ImageRegistry["presets"],
      images: [] as unknown as ImageRegistry["images"],
    };

    const merged = mergeImageRegistries(fallback, primary);
    expect(merged.images.a.src).toBe("/a.png");
    expect(merged.presets.card).toBeDefined();
  });
});

describe("getFallbackSiteContext", () => {
  it("returns null when current site is the default (self-fallback guard)", () => {
    const main = makeSite({
      domain: "main.example.com",
      contentFolder: "site_main",
      contentRoot: "/abs/site_main",
    });
    getDefaultSiteMock.mockReturnValue(main);
    getSiteContextMapMock.mockReturnValue(new Map([[main.config.domain, main]]));

    expect(getFallbackSiteContext(main)).toBeNull();
  });

  it("uses default site when fallback_content_folder is not set", () => {
    const main = makeSite({
      domain: "main.example.com",
      contentFolder: "site_main",
      contentRoot: "/abs/site_main",
    });
    const fl = makeSite({
      domain: "fl.example.com",
      contentFolder: "site_fl",
      contentRoot: "/abs/site_fl",
    });
    getDefaultSiteMock.mockReturnValue(main);
    getSiteContextMapMock.mockReturnValue(
      new Map([
        [main.config.domain, main],
        [fl.config.domain, fl],
      ]),
    );

    expect(getFallbackSiteContext(fl)).toBe(main);
  });

  it("uses explicit fallback_content_folder when set", () => {
    const main = makeSite({
      domain: "main.example.com",
      contentFolder: "site_main",
      contentRoot: "/abs/site_main",
    });
    const other = makeSite({
      domain: "other.example.com",
      contentFolder: "site_other",
      contentRoot: "/abs/site_other",
    });
    const fl = makeSite({
      domain: "fl.example.com",
      contentFolder: "site_fl",
      contentRoot: "/abs/site_fl",
      fallbackContentFolder: "site_other",
    });
    getDefaultSiteMock.mockReturnValue(main);
    getSiteContextMapMock.mockReturnValue(
      new Map([
        [main.config.domain, main],
        [other.config.domain, other],
        [fl.config.domain, fl],
      ]),
    );

    expect(getFallbackSiteContext(fl)).toBe(other);
  });
});

describe("getMergedImageRegistry / resolveImageEntry", () => {
  it("returns primary only when there is no fallback site", () => {
    const primaryReg: ImageRegistry = {
      presets: {},
      images: { local: { src: "/local.png", alt: "local" } },
    };
    const main = makeSite({
      domain: "main.example.com",
      contentFolder: "site_main",
      contentRoot: "/abs/site_main",
      registry: primaryReg,
    });
    getDefaultSiteMock.mockReturnValue(main);
    getSiteContextMapMock.mockReturnValue(new Map([[main.config.domain, main]]));

    expect(getMergedImageRegistry(main)).toEqual(primaryReg);
  });

  it("merges fallback when primary registry is empty / missing entries", () => {
    const fallbackReg: ImageRegistry = {
      presets: {},
      images: { hero: { src: "/main/hero.png", alt: "hero" } },
    };
    const main = makeSite({
      domain: "main.example.com",
      contentFolder: "site_main",
      contentRoot: "/abs/site_main",
      registry: fallbackReg,
    });
    const fl = makeSite({
      domain: "fl.example.com",
      contentFolder: "site_fl",
      contentRoot: "/abs/site_fl",
      registry: { presets: {}, images: {} },
      fallbackContentFolder: "site_main",
    });
    getDefaultSiteMock.mockReturnValue(main);
    getSiteContextMapMock.mockReturnValue(
      new Map([
        [main.config.domain, main],
        [fl.config.domain, fl],
      ]),
    );

    const merged = getMergedImageRegistry(fl);
    expect(merged?.images.hero.src).toBe("/main/hero.png");
    expect(resolveImageEntry(fl, "hero")?.src).toBe("/main/hero.png");
    expect(resolveImageEntry(fl, "missing")).toBeNull();
  });

  it("returns primary only when fallback registry is missing", () => {
    const primaryReg: ImageRegistry = {
      presets: {},
      images: { local: { src: "/local.png", alt: "l" } },
    };
    const main = makeSite({
      domain: "main.example.com",
      contentFolder: "site_main",
      contentRoot: "/abs/site_main",
      registry: null,
    });
    const fl = makeSite({
      domain: "fl.example.com",
      contentFolder: "site_fl",
      contentRoot: "/abs/site_fl",
      registry: primaryReg,
      fallbackContentFolder: "site_main",
    });
    getDefaultSiteMock.mockReturnValue(main);
    getSiteContextMapMock.mockReturnValue(
      new Map([
        [main.config.domain, main],
        [fl.config.domain, fl],
      ]),
    );

    expect(getMergedImageRegistry(fl)).toEqual(primaryReg);
  });
});
