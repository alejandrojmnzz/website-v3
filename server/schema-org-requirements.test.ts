import { describe, expect, it } from "vitest";
import {
  getSchemaOrgRequirementGaps,
  validateHeroCourseCompanions,
  formatSchemaOrgCompanionGateError,
  isSchemaOrgSiteTemplateOverride,
} from "./schema-org-requirements";
import { pickSeedTemplateSlug } from "./schema-org-seed";

describe("validateHeroCourseCompanions", () => {
  it("errors when hero course lacks Course schema_org", () => {
    const gaps = validateHeroCourseCompanions(
      [
        { type: "hero", variant: "course" },
        { type: "faq" },
      ],
      { contentType: "program", slug: "full-stack", locale: "en" },
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.message).toContain("hero variant course requires companion schema_org Course section");
    expect(gaps[0]!.message).toContain("program");
    expect(gaps[0]!.message).toContain("full-stack");
  });

  it("passes when Course companion exists", () => {
    const gaps = validateHeroCourseCompanions([
      { type: "schema_org", schema_type: "Course", properties: { name: "X" } },
      { type: "hero", variant: "course" },
    ]);
    expect(gaps).toHaveLength(0);
  });
});

describe("getSchemaOrgRequirementGaps", () => {
  it("reports missing LocalBusiness when CT requires it", () => {
    // location CT is configured in site content; use a stub via contentRoot that may not load —
    // instead verify helper against empty requirements when type unknown.
    const gapsUnknown = getSchemaOrgRequirementGaps([], "page", "site_4geeks-com", {
      slug: "home",
    });
    expect(gapsUnknown).toHaveLength(0);

    const gaps = getSchemaOrgRequirementGaps(
      [{ type: "hero", variant: "singleColumn" }],
      "location",
      "site_4geeks-com",
      { slug: "remote" },
    );
    expect(gaps.some((g) => g.schema_type === "LocalBusiness")).toBe(true);
    expect(gaps[0]!.message).toContain("location");
    expect(gaps[0]!.message).toContain("LocalBusiness");
    expect(gaps[0]!.message).toContain("remote");
  });

  it("passes when LocalBusiness present", () => {
    const gaps = getSchemaOrgRequirementGaps(
      [{ type: "schema_org", schema_type: "LocalBusiness", properties: {} }],
      "location",
      "site_4geeks-com",
      { slug: "miami-usa" },
    );
    expect(gaps).toHaveLength(0);
  });
});

describe("formatSchemaOrgCompanionGateError", () => {
  it("prefers hero companion message", () => {
    const err = formatSchemaOrgCompanionGateError({
      sections: [{ type: "hero", variant: "course" }],
      contentType: "program",
      slug: "ai",
      locale: "en",
      contentRoot: "site_4geeks-com",
    });
    expect(err).toContain("hero variant course");
  });
});

describe("isSchemaOrgSiteTemplateOverride", () => {
  it("detects WebSite and Organization", () => {
    expect(isSchemaOrgSiteTemplateOverride({ type: "schema_org", schema_type: "WebSite" })).toBe(
      "WebSite",
    );
    expect(
      isSchemaOrgSiteTemplateOverride({ type: "schema_org", schema_type: "Organization" }),
    ).toBe("Organization");
    expect(isSchemaOrgSiteTemplateOverride({ type: "schema_org", schema_type: "Course" })).toBeNull();
  });
});

describe("pickSeedTemplateSlug", () => {
  it("picks miami for usa/remote and madrid for europe", () => {
    expect(pickSeedTemplateSlug("usa-canada")).toBe("miami-usa");
    expect(pickSeedTemplateSlug("remote")).toBe("miami-usa");
    expect(pickSeedTemplateSlug("europe")).toBe("madrid-spain");
  });
});
