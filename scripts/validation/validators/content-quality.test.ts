import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dump } from "js-yaml";
import type { ContentFile, ValidationContext } from "../shared/types";

vi.mock("../../../server/redirects", () => ({
  createPublicUrlResolver: () => ({
    test: () => ({ pageExists: false }),
    isLive: (raw: string) => {
      const pathOnly = (raw.split(/[?#]/)[0] ?? raw).trim();
      return pathOnly === "/en/payment-component" || pathOnly === "/en/apply";
    },
  }),
}));

import { contentQualityValidator } from "./content-quality";

function tempYaml(data: Record<string, unknown>): { filePath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "content-quality-"));
  const filePath = join(dir, "en.yml");
  writeFileSync(filePath, dump(data));
  return { filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function context(file: ContentFile): ValidationContext {
  return {
    contentFiles: [file],
    redirectMap: new Map(),
    validUrls: new Set(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };
}

describe("contentQualityValidator BROKEN_INTERNAL_LINK", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("does not flag a known path with query or hash", async () => {
    const { filePath, cleanup } = tempYaml({
      sections: [
        {
          type: "hero",
          cta: { url: "/en/payment-component?program=ai-fluency" },
        },
      ],
    });
    cleanups.push(cleanup);

    const file: ContentFile = {
      slug: "apply",
      title: "Apply",
      type: "page",
      locale: "en",
      filePath,
    };

    const result = await contentQualityValidator.run(context(file));
    expect(result.errors.filter((e) => e.code === "BROKEN_INTERNAL_LINK")).toEqual([]);
  });

  it("does not flag /en/apply (folder slug vs locale slug)", async () => {
    const { filePath, cleanup } = tempYaml({
      sections: [{ type: "hero", cta: { url: "/en/apply" } }],
    });
    cleanups.push(cleanup);

    const file: ContentFile = {
      slug: "payment-component",
      title: "Pay",
      type: "page",
      locale: "en",
      filePath,
    };

    const result = await contentQualityValidator.run(context(file));
    expect(result.errors.filter((e) => e.code === "BROKEN_INTERNAL_LINK")).toEqual([]);
  });

  it("still flags a path that does not resolve", async () => {
    const { filePath, cleanup } = tempYaml({
      sections: [
        {
          type: "hero",
          cta: { url: "/en/missing-page-xyz-not-real?program=ai-fluency" },
        },
      ],
    });
    cleanups.push(cleanup);

    const file: ContentFile = {
      slug: "apply",
      title: "Apply",
      type: "page",
      locale: "en",
      filePath,
    };

    const result = await contentQualityValidator.run(context(file));
    expect(result.errors.some((e) => e.code === "BROKEN_INTERNAL_LINK")).toBe(true);
  });
});
