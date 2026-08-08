import { describe, expect, it } from "vitest";
import { validateRequiredConversionName } from "@shared/validateFormSection";
import {
  resolveProductScope,
  validateProductScope,
} from "@shared/resolveProductScope";
import {
  validateDocumentSectionsIdentity,
  validateSectionIdentity,
} from "@shared/validateSectionIdentity";

const resolveProduct = (id: string) =>
  id === "full-stack"
    ? { product_id: "full-stack", active: true }
    : undefined;

describe("validateRequiredConversionName (null vs missing)", () => {
  it("fails when key is missing", () => {
    expect(
      validateRequiredConversionName({ type: "lead_form" }, ""),
    ).toMatch(/required/);
  });

  it("passes when conversion_name is null (explicit off)", () => {
    expect(
      validateRequiredConversionName(
        { type: "lead_form", conversion_name: null },
        "",
      ),
    ).toBeNull();
  });

  it("passes when a known-style name is set", () => {
    expect(
      validateRequiredConversionName(
        { type: "lead_form", conversion_name: "newsletter" },
        "",
      ),
    ).toBeNull();
  });

  it("fails when conversion_name is empty string", () => {
    expect(
      validateRequiredConversionName(
        { type: "lead_form", conversion_name: "" },
        "",
      ),
    ).toMatch(/empty/);
  });
});

describe("validateProductScope (null vs missing)", () => {
  const baseOpts = {
    hasEcommerceBehavior: true,
    ctaPaths: [] as string[],
    fieldEditors: {},
    resolveProduct,
    contentType: "page",
    contentSlug: "home",
  };

  it("fails when ecommerce_products is missing and not inherit", () => {
    expect(
      validateProductScope({ type: "pricing_plans" }, baseOpts),
    ).toMatch(/ecommerce_products is required/);
  });

  it("passes when ecommerce_products is null (explicit off)", () => {
    expect(
      validateProductScope(
        { type: "pricing_plans", ecommerce_products: null },
        baseOpts,
      ),
    ).toBeNull();
    expect(
      resolveProductScope({ ecommerce_products: null }).source,
    ).toBe("off");
  });

  it('passes when ecommerce_products is "all"', () => {
    expect(
      validateProductScope(
        { type: "pricing_plans", ecommerce_products: "all" },
        baseOpts,
      ),
    ).toBeNull();
  });

  it("passes when ecommerce_products lists an active product", () => {
    expect(
      validateProductScope(
        { type: "pricing_plans", ecommerce_products: ["full-stack"] },
        baseOpts,
      ),
    ).toBeNull();
  });

  it("passes on program page via inherit without ecommerce_products key", () => {
    expect(
      validateProductScope(
        { type: "hero" },
        {
          ...baseOpts,
          contentType: "program",
          contentSlug: "full-stack",
        },
      ),
    ).toBeNull();
  });
});

describe("validateDocumentSectionsIdentity (publish-shaped)", () => {
  const fieldEditorsByType = {
    lead_form: { ".": "form-settings" },
    pricing_plans: {},
  };

  it("rejects wiped draft YAML shape (missing identity)", () => {
    const err = validateDocumentSectionsIdentity(
      {
        sections: [
          { type: "lead_form", variant: "stacked" },
          { type: "pricing_plans" },
        ],
      },
      {
        fieldEditorsByType,
        hasEcommerceBehavior: (t) => t === "pricing_plans",
        contentType: "page",
        contentSlug: "home",
        resolveProduct,
      },
    );
    expect(err).toMatch(/conversion_name|ecommerce_products/);
  });

  it("accepts after null / real values are set", () => {
    const err = validateDocumentSectionsIdentity(
      {
        sections: [
          { type: "lead_form", variant: "stacked", conversion_name: null },
          { type: "pricing_plans", ecommerce_products: null },
        ],
      },
      {
        fieldEditorsByType,
        hasEcommerceBehavior: (t) => t === "pricing_plans",
        contentType: "page",
        contentSlug: "home",
        resolveProduct,
      },
    );
    expect(err).toBeNull();
  });

  it("validateSectionIdentity skips when skipIdentity", () => {
    expect(
      validateSectionIdentity(
        { type: "lead_form" },
        {
          fieldEditors: { ".": "form-settings" },
          hasEcommerceBehavior: false,
          resolveProduct,
          skipIdentity: true,
        },
      ),
    ).toBeNull();
  });
});
