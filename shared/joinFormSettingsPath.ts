/**
 * Join a form-settings base path with a relative property path.
 *
 * - `null` / `undefined` callers should treat as "no form" (empty Conversion tab).
 * - `""` or `"."` means settings live at the section root (lead_form).
 * - `"form"` (etc.) means nested settings (hero/apply_form embeds).
 */
export function joinFormSettingsPath(
  base: string | null | undefined,
  relative: string,
): string {
  const rel = relative.replace(/^\./, "");
  if (base == null || base === "" || base === ".") return rel;
  return `${base}.${rel}`;
}

/** Normalize field-editors sentinel `"."` to root (`""`). */
export function normalizeFormSettingsPath(path: string): string {
  return path === "." ? "" : path;
}
