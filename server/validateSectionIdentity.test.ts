import { describe, expect, it } from "vitest";
import { validateRequiredConversionName } from "@shared/validateFormSection";
import {
  resolveProductScope,
  validateProductScope,
} from "@shared/resolveProductScope";
import {
  collectTouchedSectionIndexes,
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

  it("passes when nested form-settings object is absent (CTA-only hero)", () => {
    expect(
      validateRequiredConversionName(
        {
          type: "hero",
          variant: "course",
          signup_card: {
            cta_button: { text: "Details", url: "#modal-x", tracking: "none" },
          },
        },
        "signup_card.form",
      ),
    ).toBeNull();
  });
});

describe("validateProductScope (page funnel)", () => {
  const baseOpts = {
    hasEcommerceBehavior: true,
    ctaPaths: [] as string[],
    fieldEditors: {},
    resolveProduct,
    contentType: "page",
    contentSlug: "home",
  };

  it("fails when funnel.products is missing and not inherit", () => {
    expect(
      validateProductScope({ type: "pricing_plans" }, baseOpts),
    ).toMatch(/funnel\.products/);
  });

  it("passes when funnel.products is all", () => {
    expect(
      validateProductScope(
        { type: "pricing_plans" },
        { ...baseOpts, funnel: { products: "all", stage: "awareness" } },
      ),
    ).toBeNull();
  });

  it("passes when funnel.products lists an active product", () => {
    expect(
      validateProductScope(
        { type: "pricing_plans" },
        { ...baseOpts, funnel: { products: ["full-stack"], stage: "decision" } },
      ),
    ).toBeNull();
  });

  it("passes on program page via effective self-union without funnel key", () => {
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
    expect(
      resolveProductScope({ type: "hero" }, {
        contentType: "program",
        contentSlug: "full-stack",
      }).source,
    ).toBe("funnel.products");
  });
});

describe("collectTouchedSectionIndexes", () => {
  it("collects update_section and sections.N field paths", () => {
    const touched = collectTouchedSectionIndexes([
      { action: "update_section", index: 0 },
      { action: "update_field", path: "sections.2.form.conversion_name" },
    ]);
    expect(touched).toEqual(new Set([0, 2]));
  });

  it("returns null for whole-document section rewrites", () => {
    expect(
      collectTouchedSectionIndexes([{ action: "replace_all_sections" }]),
    ).toBeNull();
    expect(
      collectTouchedSectionIndexes([
        { action: "reorder_sections", from: 0, to: 1 },
      ]),
    ).toBeNull();
  });
});

describe("validateDocumentSectionsIdentity (publish-shaped)", () => {
  const fieldEditorsByType = {
    lead_form: { ".": "form-settings" },
    pricing_plans: {},
    sticky_cta: { form: "form-settings" },
    hero: { "productShowcase:form": "form-settings" },
  };

  const baseDocOpts = {
    fieldEditorsByType,
    hasEcommerceBehavior: (t: string) => t === "pricing_plans",
    contentType: "page",
    contentSlug: "home",
    resolveProduct,
  };

  it("rejects wiped draft YAML shape (missing identity)", () => {
    const err = validateDocumentSectionsIdentity(
      {
        sections: [
          { type: "lead_form", variant: "stacked" },
          { type: "pricing_plans" },
        ],
      },
      baseDocOpts,
    );
    expect(err).toMatch(/conversion_name|funnel\.products/);
  });

  it("accepts after funnel.products is set on page", () => {
    const err = validateDocumentSectionsIdentity(
      {
        sections: [
          { type: "lead_form", variant: "stacked", conversion_name: null },
          { type: "pricing_plans" },
        ],
      },
      {
        ...baseDocOpts,
        funnel: { products: ["full-stack"], stage: "decision" },
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

  it("onlyValidateIndexes ignores broken siblings (draft section-save shape)", () => {
    const doc = {
      sections: [
        {
          type: "hero",
          variant: "productShowcase",
          form: {
            variant: "stacked",
            conversion_name: "request_more_info",
            fields: { email: { visible: true } },
          },
        },
        {
          type: "sticky_cta",
          form: {
            variant: "inline",
            fields: { email: { visible: true } },
          },
        },
      ],
    };
    expect(
      validateDocumentSectionsIdentity(doc, {
        ...baseDocOpts,
        onlyValidateIndexes: new Set([0]),
      }),
    ).toBeNull();
    expect(
      validateDocumentSectionsIdentity(doc, {
        ...baseDocOpts,
        onlyValidateIndexes: new Set([1]),
      }),
    ).toMatch(/sections\[1\].*conversion_name/);
    expect(validateDocumentSectionsIdentity(doc, baseDocOpts)).toMatch(
      /sections\[1\].*conversion_name/,
    );
  });

  it("onlyValidateIndexes still fails the touched section when it is invalid", () => {
    const err = validateDocumentSectionsIdentity(
      {
        sections: [
          {
            type: "hero",
            variant: "productShowcase",
            form: { variant: "stacked", fields: { email: { visible: true } } },
          },
          {
            type: "sticky_cta",
            form: {
              variant: "inline",
              conversion_name: "request_more_info",
              fields: { email: { visible: true } },
            },
          },
        ],
      },
      {
        ...baseDocOpts,
        onlyValidateIndexes: new Set([0]),
      },
    );
    expect(err).toMatch(/sections\[0\].*conversion_name/);
  });
});
