import { describe, expect, it } from "vitest";
import { lookupValidationSummary } from "./validationSummaryLookup";

const summary = {
  "program/ai-engineering-bootcamp-chile/es": { errorCount: 2, warningCount: 1 },
  "/es/coding-bootcamps/ai-engineering-bootcamp-chile": { errorCount: 2, warningCount: 1 },
};

describe("lookupValidationSummary", () => {
  it("prefers entryKey so draft preview URLs still match", () => {
    expect(
      lookupValidationSummary(summary, {
        contentType: "program",
        slug: "ai-engineering-bootcamp-chile",
        locale: "es",
        path: "/private/preview/program/ai-engineering-bootcamp-chile?locale=es",
        pathOnly: "/private/preview/program/ai-engineering-bootcamp-chile",
      }),
    ).toEqual({ errorCount: 2, warningCount: 1 });
  });

  it("falls back to public path when entryKey is absent", () => {
    expect(
      lookupValidationSummary(
        { "/es/coding-bootcamps/ai-engineering-bootcamp-chile": { errorCount: 1, warningCount: 0 } },
        {
          path: "/es/coding-bootcamps/ai-engineering-bootcamp-chile",
          pathOnly: "/es/coding-bootcamps/ai-engineering-bootcamp-chile",
        },
      ),
    ).toEqual({ errorCount: 1, warningCount: 0 });
  });
});
