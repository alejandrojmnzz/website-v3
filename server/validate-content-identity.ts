/**
 * Server-side orchestration for section identity validation (conversion / CTA / ecommerce).
 */

import { validateDocumentSectionsIdentity } from "@shared/validateSectionIdentity";
import { getTrackingSettings } from "./settings";
import { loadAllFieldEditors, getComponentInfo } from "./component-registry";
import { ecommerceManager } from "./ecommerce/ecommerce-manager";
import { contentIndex } from "./content-index";

function makeProductResolver() {
  return (programId: string) => {
    const byCms = ecommerceManager.findProductByCmsEntry("program", programId);
    if (byCms) {
      return { product_id: byCms.product_id, active: byCms.active };
    }
    const bySlug = ecommerceManager.findProductByProgramId(programId);
    if (bySlug) return { product_id: bySlug.product_id, active: bySlug.active };
    const byId = ecommerceManager.getProduct(programId);
    if (byId) return { product_id: byId.product_id, active: byId.active };
    return undefined;
  };
}

export function validateDocIdentity(
  doc: Record<string, unknown>,
  opts: {
    contentType: string;
    contentSlug: string;
    skipIdentityIndexes?: Set<number>;
    /** Draft/variant section saves: only check these indexes. Live/publish omit. */
    onlyValidateIndexes?: Set<number>;
  },
): string | null {
  const conversionNames = getTrackingSettings().conversion_events.map((e) => e.name);
  const allFieldEditors = loadAllFieldEditors();
  return validateDocumentSectionsIdentity(doc, {
    fieldEditorsByType: allFieldEditors,
    hasEcommerceBehavior: (sectionType) =>
      Boolean(getComponentInfo(sectionType)?.behaviors?.includes("ecommerce")),
    contentType: opts.contentType,
    contentSlug: opts.contentSlug,
    conversionNames,
    resolveProduct: makeProductResolver(),
    skipIdentityIndexes: opts.skipIdentityIndexes,
    onlyValidateIndexes: opts.onlyValidateIndexes,
  });
}

/** Parse YAML string and validate identity fields. */
export function validateYamlIdentity(
  yamlText: string,
  opts: { contentType: string; contentSlug: string },
): string | null {
  const parsed = contentIndex.safeYamlLoad(yamlText) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    return "Invalid YAML content";
  }
  return validateDocIdentity(parsed, opts);
}
