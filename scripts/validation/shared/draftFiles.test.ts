import { describe, expect, it } from "vitest";
import {
  isLiveRedirectSource,
  isPublishedVariantFile,
  isVariantLayerFile,
  skipCrossEntryVariantRow,
  skipLiveVariantOverlay,
} from "./draftFiles";
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

  it("treats template single.draft.es.yml as variant layer", () => {
    expect(isVariantLayerFile("site/how-to/single.draft.es.yml")).toBe(true);
  });

  it("does not treat live locale or single templates as variant layers", () => {
    expect(isVariantLayerFile("site/programs/foo/en.yml")).toBe(false);
    expect(isVariantLayerFile("site/blog/single.en.yml")).toBe(false);
  });
});

describe("skipLiveVariantOverlay", () => {
  it("skips path-based overlays without file.variant", () => {
    expect(skipLiveVariantOverlay(file({ filePath: "site/programs/foo/v2.en.yml" }))).toBe(true);
  });

  it("does not skip published-variant ContentFiles", () => {
    expect(
      skipLiveVariantOverlay(
        file({ filePath: "site/programs/foo/draft.es.yml", variant: "draft" }),
      ),
    ).toBe(false);
  });

  it("does not skip unpublished draft-only entries", () => {
    expect(
      skipLiveVariantOverlay(file({ filePath: "site/programs/foo/draft.es.yml", isDraft: true })),
    ).toBe(false);
  });
});

describe("isLiveRedirectSource", () => {
  it("allows live locale files", () => {
    expect(isLiveRedirectSource(file({ filePath: "site/landings/foo/es.yml" }))).toBe(true);
  });

  it("rejects published variants and draft-only", () => {
    expect(
      isLiveRedirectSource(
        file({ filePath: "site/landings/foo/draft.es.yml", variant: "draft" }),
      ),
    ).toBe(false);
    expect(
      isLiveRedirectSource(
        file({ filePath: "site/landings/foo/draft.es.yml", isDraft: true, variant: "draft" }),
      ),
    ).toBe(false);
  });
});

describe("skipCrossEntryVariantRow", () => {
  it("skips rows with variant set", () => {
    expect(skipCrossEntryVariantRow(file({ filePath: "x", variant: "draft" }))).toBe(true);
    expect(isPublishedVariantFile(file({ filePath: "x", variant: "draft" }))).toBe(true);
    expect(skipCrossEntryVariantRow(file({ filePath: "site/x/es.yml" }))).toBe(false);
  });
});
