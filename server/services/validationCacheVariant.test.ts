import { describe, expect, it } from "vitest";
import { issueToStored } from "./validationCacheMerge";
import type { ContentFile, ValidationIssue } from "../../scripts/validation/shared/types";

describe("issueToStored variant entry keys", () => {
  const live: ContentFile = {
    slug: "foo",
    title: "Foo",
    type: "landing",
    locale: "es",
    filePath: "site_x/landings/foo/es.yml",
    url: "/landing/foo",
  };
  const variant: ContentFile = {
    ...live,
    variant: "draft",
    filePath: "site_x/landings/foo/draft.es.yml",
  };

  it("maps variant file issues to @variant entry keys", () => {
    const issue: ValidationIssue = {
      type: "error",
      code: "MISSING_META",
      message: "missing",
      file: variant.filePath,
    };
    const stored = issueToStored(issue, "meta", new Date().toISOString(), [
      live,
      variant,
    ]);
    const entry = stored.targets.find((t) => t.type === "entry");
    expect(entry && "entryKey" in entry ? entry.entryKey : null).toBe(
      "landing/foo/es@draft",
    );
  });

  it("heuristic path draft.es.yml includes @variant", () => {
    const issue: ValidationIssue = {
      type: "warning",
      code: "X",
      message: "x",
      file: "/abs/site/landings/foo/draft.es.yml",
    };
    const stored = issueToStored(issue, "meta", new Date().toISOString(), []);
    const entry = stored.targets.find((t) => t.type === "entry");
    expect(entry && "entryKey" in entry ? entry.entryKey : null).toBe(
      "landing/foo/es@draft",
    );
  });
});
