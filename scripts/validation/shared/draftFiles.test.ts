import { describe, expect, it } from "vitest";
import { isVariantLayerFile, skipLiveVariantOverlay } from "./draftFiles";
import type { ContentFile } from "./types";

function file(overrides: Partial<ContentFile> & Pick<ContentFile, "filePath">): ContentFile {
  return {
    slug: "ai-engineering-bootcamp-chile",
    title: "AI",
    type: "program",
    locale: "es",
    ...overrides,
  };
}

describe("isVariantLayerFile", () => {
  it("treats draft.en.yml and v2.es.yml as variant layers", () => {
    expect(isVariantLayerFile("site/programs/foo/draft.en.yml")).toBe(true);
    expect(isVariantLayerFile("site/programs/foo/v2.es.yml")).toBe(true);
  });

  it("does not treat live locale or single templates as variant layers", () => {
    expect(isVariantLayerFile("site/programs/foo/en.yml")).toBe(false);
    expect(isVariantLayerFile("site/blog/single.en.yml")).toBe(false);
  });
});

describe("skipLiveVariantOverlay", () => {
  it("skips variant overlays of live pages", () => {
    expect(skipLiveVariantOverlay(file({ filePath: "site/programs/foo/v2.en.yml" }))).toBe(true);
  });

  it("does not skip unpublished draft-only entries", () => {
    expect(
      skipLiveVariantOverlay(file({ filePath: "site/programs/foo/draft.es.yml", isDraft: true })),
    ).toBe(false);
  });
});
