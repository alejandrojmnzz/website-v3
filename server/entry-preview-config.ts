import { loadSchema } from "./component-registry";
import type { ContentTypePreviewConfig } from "./content-types";
import {
  collectMappablePropsFromSchema,
  type PreviewPropDef,
} from "@shared/entry-preview-props";

export type PreviewMappingValidation = {
  ok: boolean;
  error?: string;
  mappableCount: number;
  mappedCount: number;
  missingRequired: string[];
};

/**
 * Preview capture requires a component with at least one mappable scalar prop
 * (top-level or dotted nested object path), every required top-level scalar mapped,
 * and at least one mapping overall.
 */
export function validatePreviewPropMappings(
  preview: Pick<ContentTypePreviewConfig, "component" | "variant" | "version" | "props">,
): PreviewMappingValidation {
  const component = preview.component?.trim();
  if (!component) {
    return {
      ok: false,
      error: "preview.component is required",
      mappableCount: 0,
      mappedCount: 0,
      missingRequired: [],
    };
  }

  const version = preview.version?.trim() || "1.0";
  const variant = preview.variant?.trim() || "default";
  const schema = loadSchema(component, version);
  if (!schema) {
    return {
      ok: false,
      error: `Schema not found for ${component}@${version}`,
      mappableCount: 0,
      mappedCount: 0,
      missingRequired: [],
    };
  }

  const mappable = collectMappablePropsFromSchema(
    schema as {
      props?: Record<string, PreviewPropDef>;
      base_props?: Record<string, PreviewPropDef>;
      variant_props?: Record<string, Record<string, PreviewPropDef>>;
    },
    variant,
  );
  const props = preview.props || {};
  const mappedEntries = Object.entries(props).filter(
    ([k, v]) => k && typeof v === "string" && v.trim().length > 0,
  );
  const mappedCount = mappedEntries.length;
  const missingRequired = mappable
    .filter((p) => p.required && !props[p.key]?.trim())
    .map((p) => p.key);

  if (mappable.length === 0) {
    return {
      ok: false,
      error:
        "This component/variant has no simple fields to map. Choose a component with text/number/boolean props (including nested paths like left.heading).",
      mappableCount: 0,
      mappedCount,
      missingRequired: [],
    };
  }

  if (missingRequired.length > 0) {
    return {
      ok: false,
      error: `Map required properties before saving: ${missingRequired.join(", ")}`,
      mappableCount: mappable.length,
      mappedCount,
      missingRequired,
    };
  }

  if (mappedCount === 0) {
    return {
      ok: false,
      error: "Map at least one component property to a content-type field before saving.",
      mappableCount: mappable.length,
      mappedCount: 0,
      missingRequired: [],
    };
  }

  return {
    ok: true,
    mappableCount: mappable.length,
    mappedCount,
    missingRequired: [],
  };
}

export function isPreviewCaptureReady(
  preview: ContentTypePreviewConfig | null | undefined,
): boolean {
  if (!preview?.component?.trim()) return false;
  return validatePreviewPropMappings(preview).ok;
}
