import { buildBreadcrumbListSchema, type BreadcrumbSection } from "../ssr-schema";
import type { SchemaComponentContributor } from "./types";

/** Emits one BreadcrumbList document per breadcrumb section with labeled items. */
export const contributeBreadcrumb: SchemaComponentContributor = (section, context) => {
  const bc = section as unknown as BreadcrumbSection;
  const items = (bc.items || []).filter((item) => item && item.label);
  if (items.length === 0) return [];
  return [{ kind: "document", schema: buildBreadcrumbListSchema(items, context.baseUrl) }];
};
