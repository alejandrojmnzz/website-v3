/**
 * Wipe conversion / ecommerce identity fields when duplicating a page or section.
 * Driven by field-editor bindings (form-settings, cta-tracking, ecommerce-products)
 * plus recursive deletion of any `conversion_name` key under the section.
 */

import { normalizeFormSettingsPath } from "./joinFormSettingsPath";
import { resolveBoundCtaPaths } from "./validateCtaTracking";

export type ClearedField = {
  sectionType: string;
  path: string;
  sectionIndex?: number;
  file?: string;
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Resolve form-settings bind path for the active variant ("" = section root). */
export function resolveBoundFormSettingsPath(
  fieldEditors: Record<string, string>,
  variant?: string,
): string | null {
  let globalPath: string | null = null;
  for (const [fieldPath, editorType] of Object.entries(fieldEditors)) {
    if (String(editorType).split(":")[0] !== "form-settings") continue;
    const colonIndex = fieldPath.indexOf(":");
    if (colonIndex > 0 && !fieldPath.startsWith("color-picker:")) {
      const variantPrefix = fieldPath.substring(0, colonIndex);
      const actual = normalizeFormSettingsPath(fieldPath.substring(colonIndex + 1));
      if (variant && variantPrefix === variant) return actual;
    } else if (globalPath === null) {
      globalPath = normalizeFormSettingsPath(fieldPath);
    }
  }
  return globalPath;
}

/** Paths bound to ecommerce-products for the active variant. */
export function resolveBoundEcommerceProductsPaths(
  fieldEditors: Record<string, string>,
  variant?: string,
): string[] {
  const paths: string[] = [];
  for (const [fieldPath, editorType] of Object.entries(fieldEditors)) {
    if (String(editorType).split(":")[0] !== "ecommerce-products") continue;
    const colonIndex = fieldPath.indexOf(":");
    if (colonIndex > 0 && !fieldPath.startsWith("color-picker:")) {
      const variantPrefix = fieldPath.substring(0, colonIndex);
      const actual = fieldPath.substring(colonIndex + 1);
      if (!variant || variant === variantPrefix) paths.push(actual);
    } else {
      paths.push(fieldPath);
    }
  }
  return paths;
}

function deleteConversionNames(
  value: unknown,
  pathPrefix: string,
  cleared: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => deleteConversionNames(item, `${pathPrefix}[${i}]`, cleared));
    return;
  }
  const obj = asRecord(value);
  if (!obj) return;
  if ("conversion_name" in obj) {
    delete obj.conversion_name;
    cleared.push(pathPrefix ? `${pathPrefix}.conversion_name` : "conversion_name");
  }
  for (const [key, child] of Object.entries(obj)) {
    if (key === "conversion_name") continue;
    const next = pathPrefix ? `${pathPrefix}.${key}` : key;
    deleteConversionNames(child, next, cleared);
  }
}

function getByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.replace(/\[\]/g, ".$").split(".").filter(Boolean);
  return walkGet(obj, parts);
}

function walkGet(current: unknown, parts: string[]): unknown {
  if (parts.length === 0) return current;
  const [head, ...rest] = parts;
  if (head === "$") {
    if (!Array.isArray(current)) return undefined;
    return current.map((item) => walkGet(item, rest));
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
  return walkGet((current as Record<string, unknown>)[head!], rest);
}

function deleteKeyAtPath(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return false;
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!current || typeof current !== "object" || Array.isArray(current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  const last = parts[parts.length - 1]!;
  if (!(last in (current as Record<string, unknown>))) return false;
  delete (current as Record<string, unknown>)[last];
  return true;
}

function flattenCtaTargets(
  value: unknown,
): Array<{ pathHint: string; cta: Record<string, unknown> }> {
  const out: Array<{ pathHint: string; cta: Record<string, unknown> }> = [];
  const visit = (v: unknown, hint: string) => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, `${hint}[${i}]`));
      return;
    }
    const o = asRecord(v);
    if (!o) return;
    if (typeof o.url === "string" && typeof o.text === "string") {
      out.push({ pathHint: hint, cta: o });
      return;
    }
    for (const [k, child] of Object.entries(o)) {
      visit(child, hint ? `${hint}.${k}` : k);
    }
  };
  visit(value, "");
  return out;
}

function deleteCtaTrackingAtPath(
  section: Record<string, unknown>,
  ctaPath: string,
  cleared: string[],
): void {
  const raw = getByPath(section, ctaPath);
  if (raw === undefined) return;
  for (const { pathHint, cta } of flattenCtaTargets(raw)) {
    if (!("tracking" in cta)) continue;
    delete cta.tracking;
    cleared.push(`${ctaPath}${pathHint}.tracking`);
  }
}

/**
 * Deep-clone a section and wipe conversion/ecommerce identity fields.
 * Does not wipe programs[].id (v1).
 */
export function wipeSectionOnDuplicate(
  section: Record<string, unknown>,
  fieldEditors: Record<string, string> = {},
): { section: Record<string, unknown>; cleared: string[] } {
  const next = deepClone(section);
  const cleared: string[] = [];
  const sectionType = String(next.type ?? "");
  const variant = typeof next.variant === "string" ? next.variant : undefined;

  deleteConversionNames(next, "", cleared);

  for (const epPath of resolveBoundEcommerceProductsPaths(fieldEditors, variant)) {
    if (deleteKeyAtPath(next, epPath)) {
      cleared.push(epPath);
    }
  }

  for (const ctaPath of resolveBoundCtaPaths(fieldEditors, variant)) {
    deleteCtaTrackingAtPath(next, ctaPath, cleared);
  }

  // Deduplicate paths (recursive conversion_name may overlap)
  const unique = [...new Set(cleared)];
  return { section: next, cleared: unique.map((path) => path) };
}

/** Wipe every section in a locale/content document. */
export function wipeDocumentSectionsOnDuplicate(
  doc: Record<string, unknown>,
  fieldEditorsByType: Record<string, Record<string, string>>,
  meta?: { file?: string },
): ClearedField[] {
  const sections = doc.sections;
  if (!Array.isArray(sections)) return [];
  const allCleared: ClearedField[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (!sec || typeof sec !== "object" || Array.isArray(sec)) continue;
    const record = sec as Record<string, unknown>;
    const sectionType = String(record.type ?? "");
    const editors = fieldEditorsByType[sectionType] ?? {};
    const { section: wiped, cleared } = wipeSectionOnDuplicate(record, editors);
    sections[i] = wiped;
    for (const path of cleared) {
      allCleared.push({
        sectionType,
        path,
        sectionIndex: i,
        file: meta?.file,
      });
    }
  }
  return allCleared;
}
