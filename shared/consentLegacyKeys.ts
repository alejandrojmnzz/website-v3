/**
 * Shared helper for detecting obsolete consent keys at runtime.
 *
 * Used by:
 *  - server/content-editor.ts  (blocks saves at the API layer)
 *  - scripts/validation/validators/consent-legacy-keys.ts  (static CI validator)
 */

const OBSOLETE_KEYS = ["marketing_text", "sms_text"] as const;

export interface ConsentKeyViolation {
  breadcrumb: string;
  keys: string[];
}

/**
 * Recursively walks a parsed YAML object and returns every `consent:` block
 * that contains the obsolete `marketing_text` or `sms_text` keys.
 */
export function findObsoleteConsentKeys(
  value: unknown,
  breadcrumb = "",
  hits: ConsentKeyViolation[] = []
): ConsentKeyViolation[] {
  if (Array.isArray(value)) {
    value.forEach((item, idx) =>
      findObsoleteConsentKeys(item, `${breadcrumb}[${idx}]`, hits)
    );
    return hits;
  }

  if (!value || typeof value !== "object") {
    return hits;
  }

  const obj = value as Record<string, unknown>;

  if (breadcrumb.endsWith(".consent") || breadcrumb === "consent") {
    const found = OBSOLETE_KEYS.filter((k) =>
      Object.prototype.hasOwnProperty.call(obj, k)
    );
    if (found.length > 0) {
      hits.push({ breadcrumb, keys: found as unknown as string[] });
    }
  }

  for (const [key, child] of Object.entries(obj)) {
    const childPath = breadcrumb ? `${breadcrumb}.${key}` : key;
    findObsoleteConsentKeys(child, childPath, hits);
  }

  return hits;
}

/**
 * Returns an error message string if the object contains obsolete consent keys,
 * or `null` if no violations are found.
 */
export function getConsentKeyError(obj: unknown): string | null {
  const hits = findObsoleteConsentKeys(obj);
  if (hits.length === 0) return null;

  const paths = hits.flatMap((h) =>
    h.keys.map((k) => `\`${h.breadcrumb}.${k}\``)
  );
  const listed = paths.join(", ");
  return (
    `Obsolete consent keys detected: ${listed} ` +
    `are no longer used — remove them or use ` +
    `\`reserved.consent_marketing\` / \`reserved.consent_sms\`.`
  );
}
