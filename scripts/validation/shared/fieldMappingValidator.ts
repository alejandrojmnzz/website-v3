import path from "path";
import { contentIndex, type ContentType } from "../../../server/content-index";

export interface MissingEntry {
  slug: string;
  files: string[];
}

export interface FieldValidationResult {
  valid: boolean;
  total: number;
  found: number;
  missing: MissingEntry[];
  /** Identity schema key present on no entries yet — warn, do not block save. */
  isNewField?: boolean;
}

export interface MappingValidationResult {
  results: Record<string, FieldValidationResult>;
  allValid: boolean;
}

export function extractByDotPath(obj: unknown, dotPath: string): unknown {
  let current = obj;
  const segments = dotPath.split(".");
  for (const key of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const PROJECT_ROOT = process.cwd();

function toRelative(absPath: string): string {
  return path.relative(PROJECT_ROOT, absPath);
}

function isTransformerValue(value: string): boolean {
  return value.startsWith("function:");
}

function isOptionalSource(value: string): boolean {
  return value.startsWith("?");
}

export function validateFieldSource(
  contentType: string,
  source: string
): FieldValidationResult {
  const optional = isOptionalSource(source);
  const effectiveSource = optional ? source.slice(1) : source;

  const slugs = contentIndex.listContentSlugs(contentType as ContentType);

  if (slugs.length === 0) {
    return { valid: true, total: 0, found: 0, missing: [] };
  }

  let found = 0;
  const missing: MissingEntry[] = [];

  for (const slug of slugs) {
    const locales = contentIndex.getAvailableLocalesOrVariants(
      contentType as ContentType,
      slug
    );
    const locale = locales.includes("en") ? "en" : locales[0];
    if (!locale) {
      if (!optional) {
        const commonPath = toRelative(contentIndex.getCommonFilePath(contentType, slug));
        const localePath = toRelative(contentIndex.getContentFilePath(contentType, slug, "en"));
        missing.push({ slug, files: [commonPath, localePath] });
      }
      continue;
    }

    const { data } = contentIndex.loadMergedContent(
      contentType,
      slug,
      locale
    );

    if (!data) {
      if (!optional) {
        const commonPath = toRelative(contentIndex.getCommonFilePath(contentType, slug));
        const localePath = toRelative(contentIndex.getContentFilePath(contentType, slug, locale));
        missing.push({ slug, files: [commonPath, localePath] });
      }
      continue;
    }

    const value = extractByDotPath(data, effectiveSource);
    if (value !== undefined) {
      found++;
    } else if (!optional) {
      const commonPath = toRelative(contentIndex.getCommonFilePath(contentType, slug));
      const localePath = toRelative(contentIndex.getContentFilePath(contentType, slug, locale));
      missing.push({ slug, files: [commonPath, localePath] });
    }
  }

  return {
    valid: missing.length === 0,
    total: slugs.length,
    found,
    missing,
  };
}

/** Strip optional `?` prefix from a mapping source string. */
export function stripOptionalPrefix(value: string): string {
  return isOptionalSource(value) ? value.slice(1) : value;
}

/**
 * Identity mapping (key === source) is a static schema declaration — the key need not
 * exist in every entry YAML yet. Values are filled later via Fields (static root keys / DB field_overrides).
 * When *no* entry has the key, mark isNewField (warning only; still valid).
 */
export function isIdentityFieldMapping(key: string, value: string): boolean {
  if (isTransformerValue(value)) return false;
  return stripOptionalPrefix(value) === key;
}

export function validateFieldMapping(
  contentType: string,
  fieldMapping: Record<string, string>
): MappingValidationResult {
  const results: Record<string, FieldValidationResult> = {};
  let allValid = true;

  for (const [key, value] of Object.entries(fieldMapping)) {
    if (key.startsWith("_")) continue;
    if (typeof value !== "string" || !value) continue;
    if (isTransformerValue(value)) continue;
    if (isOptionalSource(value)) continue;

    if (isIdentityFieldMapping(key, value)) {
      const presence = validateFieldSource(contentType, value);
      // Identity is always valid for save; warn when no entry has the key yet
      results[key] = {
        ...presence,
        valid: true,
        isNewField: presence.total > 0 && presence.found === 0,
        missing: presence.found === 0 ? [] : presence.missing,
      };
      continue;
    }

    const result = validateFieldSource(contentType, value);
    results[key] = result;
    if (!result.valid) {
      allValid = false;
    }
  }

  return { results, allValid };
}
