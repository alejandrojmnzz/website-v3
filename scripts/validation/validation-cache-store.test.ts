import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ValidationCacheService } from "../../server/services/validationCacheService";
import { buildIssueId } from "../../server/services/validationCacheMerge";
import {
  getValidatorRunClass,
  isCrossEntryValidator,
  isEntryLocalValidator,
} from "./shared/runClass";
import { buildEntryKey } from "./shared/entryKey";
import type { ContentFile, ValidatorResult } from "./shared/types";

function makeFile(
  overrides: Partial<ContentFile> & Pick<ContentFile, "slug" | "type" | "locale" | "filePath">,
): ContentFile {
  return {
    title: overrides.slug,
    url: `/${overrides.locale}/${overrides.slug}`,
    ...overrides,
  };
}

function metaResult(file: ContentFile, missing: boolean): ValidatorResult {
  return {
    name: "meta",
    description: "meta",
    status: missing ? "failed" : "passed",
    duration: 1,
    category: "seo",
    errors: missing
      ? [
          {
            type: "error",
            code: "MISSING_PAGE_TITLE",
            message: "Missing page_title",
            file: file.filePath,
            validator: "meta",
          },
        ]
      : [],
    warnings: [],
  };
}

function redirectsConflict(
  fileA: ContentFile,
  fileB: ContentFile,
): ValidatorResult {
  return {
    name: "redirects",
    description: "redirects",
    status: "failed",
    duration: 1,
    category: "integrity",
    errors: [
      {
        type: "error",
        code: "REDIRECT_CONFLICT",
        message: `Redirect conflict: "/bootcamp/ai" is claimed by both "${fileA.filePath}" and "${fileB.filePath}"`,
        file: fileA.filePath,
        validator: "redirects",
      },
    ],
    warnings: [],
  };
}

describe("validation issue store v5", () => {
  let tmp: string;
  let cache: ValidationCacheService;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "val-cache-"));
    cache = new ValidationCacheService(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("classifies run classes", () => {
    expect(isEntryLocalValidator("meta")).toBe(true);
    expect(isCrossEntryValidator("redirects")).toBe(true);
    expect(getValidatorRunClass("images")).toBe("media");
    expect(getValidatorRunClass("database-health")).toBe("database");
  });

  it("stable issue ids sort targets", () => {
    const a = buildIssueId("redirects", "REDIRECT_CONFLICT", [
      { type: "entry", entryKey: "program/b/en" },
      { type: "entry", entryKey: "program/a/en" },
      { type: "redirect", from: "/x" },
    ]);
    const b = buildIssueId("redirects", "REDIRECT_CONFLICT", [
      { type: "redirect", from: "/x" },
      { type: "entry", entryKey: "program/a/en" },
      { type: "entry", entryKey: "program/b/en" },
    ]);
    expect(a).toBe(b);
  });

  it("entry-local meta on A does not clear B; re-run meta clears obsolete codes", () => {
    const fileA = makeFile({
      type: "program",
      slug: "alpha",
      locale: "en",
      filePath: "/tmp/programs/alpha/en.yml",
      url: "/en/alpha",
    });
    const fileB = makeFile({
      type: "program",
      slug: "beta",
      locale: "en",
      filePath: "/tmp/programs/beta/en.yml",
      url: "/en/beta",
    });

    cache.applyValidatorResults([metaResult(fileA, true)], {
      contentFiles: [fileA, fileB],
      entryKeys: [buildEntryKey("program", "alpha", "en")],
    });
    cache.applyValidatorResults([metaResult(fileB, true)], {
      contentFiles: [fileA, fileB],
      entryKeys: [buildEntryKey("program", "beta", "en")],
    });

    expect(cache.getIssuesByEntryKey("program/alpha/en").some((i) => i.code === "MISSING_PAGE_TITLE")).toBe(
      true,
    );
    expect(cache.getIssuesByEntryKey("program/beta/en").some((i) => i.code === "MISSING_PAGE_TITLE")).toBe(
      true,
    );

    // Clear meta on A only
    cache.applyValidatorResults([metaResult(fileA, false)], {
      contentFiles: [fileA, fileB],
      entryKeys: [buildEntryKey("program", "alpha", "en")],
    });

    expect(cache.getIssuesByEntryKey("program/alpha/en").some((i) => i.code === "MISSING_PAGE_TITLE")).toBe(
      false,
    );
    expect(cache.getIssuesByEntryKey("program/beta/en").some((i) => i.code === "MISSING_PAGE_TITLE")).toBe(
      true,
    );
  });

  it("redirects fan-out to both parties; meta re-run keeps redirects", () => {
    const fileA = makeFile({
      type: "program",
      slug: "ai-engineering",
      locale: "en",
      filePath: "/tmp/programs/ai-engineering/en.yml",
      url: "/en/ai-engineering",
    });
    const fileB = makeFile({
      type: "program",
      slug: "ai-engineering-devs",
      locale: "en",
      filePath: "/tmp/programs/ai-engineering-devs/en.yml",
      url: "/en/ai-engineering-devs",
    });

    cache.applyValidatorResults([redirectsConflict(fileA, fileB)], {
      contentFiles: [fileA, fileB],
      markSiteWide: true,
    });

    const onA = cache.getIssuesByEntryKey("program/ai-engineering/en");
    const onB = cache.getIssuesByEntryKey("program/ai-engineering-devs/en");
    expect(onA.some((i) => i.code === "REDIRECT_CONFLICT")).toBe(true);
    expect(onB.some((i) => i.code === "REDIRECT_CONFLICT")).toBe(true);

    cache.applyValidatorResults([metaResult(fileA, true)], {
      contentFiles: [fileA, fileB],
      entryKeys: ["program/ai-engineering/en"],
    });

    expect(
      cache.getIssuesByEntryKey("program/ai-engineering/en").some((i) => i.code === "REDIRECT_CONFLICT"),
    ).toBe(true);
    expect(
      cache.getIssuesByEntryKey("program/ai-engineering/en").some((i) => i.code === "MISSING_PAGE_TITLE"),
    ).toBe(true);
  });

  it("cross-entry redirects clear site-wide when re-run clean", () => {
    const fileA = makeFile({
      type: "program",
      slug: "ai-engineering",
      locale: "en",
      filePath: "/tmp/programs/ai-engineering/en.yml",
      url: "/en/ai-engineering",
    });
    const fileB = makeFile({
      type: "program",
      slug: "ai-engineering-devs",
      locale: "en",
      filePath: "/tmp/programs/ai-engineering-devs/en.yml",
      url: "/en/ai-engineering-devs",
    });

    cache.applyValidatorResults([redirectsConflict(fileA, fileB)], {
      contentFiles: [fileA, fileB],
      markSiteWide: true,
    });

    cache.applyValidatorResults(
      [
        {
          name: "redirects",
          description: "redirects",
          status: "passed",
          duration: 1,
          category: "integrity",
          errors: [],
          warnings: [],
        },
      ],
      { contentFiles: [fileA, fileB], markSiteWide: true },
    );

    expect(cache.getAllIssues().filter((i) => i.validator === "redirects")).toHaveLength(0);
  });
});
