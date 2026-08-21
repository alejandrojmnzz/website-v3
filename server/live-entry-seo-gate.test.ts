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
    expect(failure?.message).toContain("update_fields");
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

  it("passes after meta.robots patch when title and description remain on meta", () => {
    const pageData = {
      slug: "ai-engineering-program-ad-mx",
      title: "Programa de Ingeniería de IA en MX",
      description: "Landing program description for gate.",
      meta: {
        page_title: "Ingeniería en IA | Programa en México con 4Geeks",
        description:
          "Desarrolla soluciones de IA con mentoría y comunidad profesional en 4Geeks Academy.",
        robots: "index, follow",
        change_frequency: "weekly",
      },
    };
    pageData.meta.robots = "noindex, nofollow";

    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData,
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("micro save with meta.robots only passes when snippet meta empty on merged page", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData: {
        slug: "ai-engineering-program-ad-mx",
        meta: {
          robots: "noindex, nofollow",
          change_frequency: "weekly",
        },
      },
      intent: "micro",
      touchedPaths: ["meta.robots"],
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("micro save with locations only skips required meta", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData: {
        slug: "ai-engineering-program-ad-mx",
        locations: ["mexicocity-mexico"],
        meta: {},
      },
      intent: "micro",
      touchedPaths: ["locations"],
      isDraftWrite: false,
    });
    expect(failure).toBeNull();
  });

  it("publish intent fails when meta missing", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData: {
        slug: "ai-engineering-program-ad-mx",
        meta: { robots: "index, follow" },
        title: "",
        description: "",
      },
      intent: "publish",
      isDraftWrite: false,
    });
    expect(failure).not.toBeNull();
    expect(failure?.missing_fields).toEqual(
      expect.arrayContaining(["meta.page_title", "meta.description"]),
    );
  });

  it("fails when full meta replace drops title and description (legacy broken path)", () => {
    const failure = evaluateLiveEntrySeoAndRequiredFields({
      contentType: "landing",
      slug: "ai-engineering-program-ad-mx",
      locale: "es",
      pageData: {
        slug: "ai-engineering-program-ad-mx",
        meta: {
          robots: "noindex, nofollow",
          change_frequency: "weekly",
        },
      },
      isDraftWrite: false,
    });
    expect(failure).not.toBeNull();
    expect(failure?.missing_fields).toEqual(
      expect.arrayContaining(["meta.page_title", "meta.description"]),
    );
  });
});
