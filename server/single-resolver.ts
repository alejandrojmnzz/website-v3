import { parsePipeFallback } from "@shared/json-field";

const SINGLE_VAR_PATTERN = /\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;
const EXACT_SINGLE_VAR_PATTERN = /^\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([\s\S]*?))?\s*\}\}$/;

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveString(str: string, singleItem: Record<string, unknown>): unknown {
  const exactMatch = str.match(EXACT_SINGLE_VAR_PATTERN);
  if (exactMatch) {
    const fieldPath = exactMatch[1];
    // Group 2 is present only when `| fallback` was written (may be empty string).
    const hasFallback = exactMatch[2] !== undefined;
    const fallback = exactMatch[2]?.trim();
    const value = getNestedValue(singleItem, fieldPath);
    if (value !== undefined && value !== null) return value;
    if (hasFallback) return parsePipeFallback(fallback ?? "");
    return null;
  }

  if (!SINGLE_VAR_PATTERN.test(str)) return str;
  SINGLE_VAR_PATTERN.lastIndex = 0;

  return str.replace(SINGLE_VAR_PATTERN, (_match, fieldPath: string, fallback?: string) => {
    const value = getNestedValue(singleItem, fieldPath);
    if (value !== undefined && value !== null) {
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }
    if (fallback !== undefined) return fallback.trim();
    return "";
  });
}

/**
 * `item_template` uses `{{ single.* }}` to mean each *list item*, not the page
 * entry. Delivery-time resolveSingleVars must leave it untouched so editors
 * don't bake page values (e.g. title: "Blog") back into YAML on save.
 * resolveDynamicEntries applies the template against each queried row.
 */
function shouldPreserveTemplateSubtree(key: string): boolean {
  return key === "item_template" || key.startsWith("_");
}

export function resolveSingleVars(data: unknown, singleItem: Record<string, unknown>): unknown {
  if (typeof data === "string") {
    return resolveString(data, singleItem);
  }

  if (Array.isArray(data)) {
    return data.map((item) => resolveSingleVars(item, singleItem));
  }

  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      // Preserve runtime metadata (_variableFields) and listing item_template.
      if (shouldPreserveTemplateSubtree(key)) {
        result[key] = value;
        continue;
      }
      result[key] = resolveSingleVars(value, singleItem);
    }
    return result;
  }

  return data;
}
