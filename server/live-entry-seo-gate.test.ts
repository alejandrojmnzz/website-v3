import { describe, it, expect, vi } from "vitest";

vi.mock("./single-resolver", () => ({
  resolveSingleVars: (page: unknown) => page,
}));
vi.mock("./build-single-entry", () => ({
  buildSingleEntryFromContent: () => ({}),
}));
vi.mock("./content-types", () => ({
  finalizeSingleEntryForTemplates: (x: unknown) => x,
  getContentTypeConfig: () => ({
    editor: {
      title: { required: true },
      description: { required: true },
    },
  }),
  getFolder: () => "blog",
}));
vi.mock("./draft-entry", () => ({
  isDraftEntry: () => false,
}));
vi.mock("./shared-layout-entry", () => ({
  isEntryDetached: () => false,
  isSharedLayoutType: () => false,
}));
vi.mock("./database-single-loader", () => ({
  mergeSingleTemplate: () => null,
}));
vi.mock("./utils/deepMerge", () => ({
  deepMerge: (a: object, b: object) => ({ ...a, ...b }),
}));
vi.mock("./site-config", () => ({
  getDefaultContentRoot: () => "/tmp",
}));
vi.mock("./content-index", () => ({
  contentIndex: {
    loadMergedContent: () => ({ data: null }),
  },
}));
vi.mock("./schema-org-requirements", () => ({
  formatSchemaOrgCompanionGateError: () => null,
}));

import { evaluateLiveEntrySeoAndRequiredFields } from "./live-entry-seo-gate";
import { LIVE_REQUIRED_FIELDS_CODE } from "@shared/liveSeoGate";

describe("evaluateLiveEntrySeoAndRequiredFields", () => {
  it("returns missing_fields for both meta and editor.required gaps together", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "blog",
      slug: "how-to-pay-a-coding-bootcamp-2022",
      locale: "en",
      pageData: {
        meta: { page_title: "", description: "" },
        title: "",
        description: "",
      },
      isDraftWrite: false,
    });
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe(LIVE_REQUIRED_FIELDS_CODE);
    expect(failure?.missing_fields).toEqual([
      "meta.page_title",
      "meta.description",
      "title",
      "description",
    ]);
    expect(failure?.message).toContain("CIRCULAR_REQUIRED_FIELDS");
    expect(failure?.message).toContain("batch_update_fields");
  });

  it("passes when meta and required fields are populated", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "blog",
      slug: "ok-post",
      locale: "en",
      pageData: {
        meta: {
          page_title: "How to pay",
          description: "A helpful overview of financing options.",
        },
        title: "How to pay",
        description: "A helpful overview of financing options.",
      },
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });
});
