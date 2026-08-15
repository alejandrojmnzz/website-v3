import { describe, expect, it } from "vitest";
import {
  TEMPLATE_VERSIONING_SLUG,
  isPreviewListingSharedTemplate,
} from "./sharedLayoutEntry";

describe("isPreviewListingSharedTemplate", () => {
  it("is true for attached shared-layout with versioningSlug single", () => {
    expect(
      isPreviewListingSharedTemplate({
        isSharedLayout: true,
        detached: false,
        versioningSlug: TEMPLATE_VERSIONING_SLUG,
      }),
    ).toBe(true);
  });

  it("is false when detached or not shared", () => {
    expect(
      isPreviewListingSharedTemplate({
        isSharedLayout: true,
        detached: true,
        versioningSlug: TEMPLATE_VERSIONING_SLUG,
      }),
    ).toBe(false);
    expect(
      isPreviewListingSharedTemplate({
        isSharedLayout: false,
        versioningSlug: TEMPLATE_VERSIONING_SLUG,
      }),
    ).toBe(false);
    expect(
      isPreviewListingSharedTemplate({
        isSharedLayout: true,
        detached: false,
        versioningSlug: "my-post",
      }),
    ).toBe(false);
  });
});
