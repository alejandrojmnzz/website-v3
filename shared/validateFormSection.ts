import { resolveFormDefaults, type ConversionEventDefaults } from "./resolveFormDefaults";

/**
 * Resolves a form section's effective settings by merging conversion event defaults.
 * Form-level YAML values always win; missing fields fall back to the event definition.
 *
 * Use this as the canonical entry point before rendering or validating any form
 * section — ensures automations, tags, consent, and webhook are consistently derived
 * across the editor UI, live render path, and submission handling.
 *
 * @param section       The raw parsed section object from YAML.
 * @param conversionEvent The matching ConversionEventEntry (or null/undefined).
 * @param formSettingsPath Dot-path to the form settings object within the section (default "form").
 */
export function resolveFormSection(
  section: Record<string, unknown>,
  conversionEvent: ConversionEventDefaults | null | undefined,
  formSettingsPath: string = "form"
): Record<string, unknown> {
  return resolveFormDefaults(section, conversionEvent, formSettingsPath);
}

function getFormSettingsObject(
  section: Record<string, unknown>,
  formSettingsPath: string,
): Record<string, unknown> | null {
  if (!formSettingsPath) {
    return section;
  }
  const parts = formSettingsPath.split(".").filter(Boolean);
  let current: unknown = section;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;
  return current as Record<string, unknown>;
}

/** Collect non-empty conversion_name from form root and routes[].conversion_name. */
export function collectConversionNames(form: Record<string, unknown>): string[] {
  const names: string[] = [];
  const rootName = form.conversion_name;
  if (typeof rootName === "string" && rootName.trim()) {
    names.push(rootName.trim());
  }
  const routes = form.routes;
  if (Array.isArray(routes)) {
    for (const route of routes) {
      if (!route || typeof route !== "object" || Array.isArray(route)) continue;
      const routeName = (route as Record<string, unknown>).conversion_name;
      if (typeof routeName === "string" && routeName.trim()) {
        names.push(routeName.trim());
      }
    }
  }
  return names;
}

/**
 * When a section has a form-settings bind, require at least one conversion_name
 * (form root or any route). Used on save/publish after duplicate wipe.
 *
 * @param formSettingsPath "" = settings on section root (lead_form); "form" = nested.
 */
export function validateRequiredConversionName(
  section: Record<string, unknown>,
  formSettingsPath: string | null | undefined,
): string | null {
  if (formSettingsPath == null) return null;
  const form = getFormSettingsObject(section, formSettingsPath);
  if (!form) {
    return `form-settings path "${formSettingsPath || "."}" is missing; conversion_name is required`;
  }
  if (collectConversionNames(form).length > 0) return null;
  const label = formSettingsPath ? `${formSettingsPath}.conversion_name` : "conversion_name";
  return (
    `${label} is required (or set conversion_name on a form route). ` +
    `Duplicating clears conversion names — set a new one before saving.`
  );
}

/**
 * Validates a section's `form` config.
 *
 * Returns null if the section has no `form` key or the config is valid.
 * When a name is set (root or any route), it must be in `conversionNames` if that list is provided.
 * Use {@link validateRequiredConversionName} to require a name when form-settings is bound.
 */
export function validateFormSection(
  section: Record<string, unknown>,
  conversionNames?: string[]
): string | null {
  if (!("form" in section)) return null;

  const form = section.form as Record<string, unknown> | null | undefined;

  if (!form || typeof form !== "object") {
    return "section.form must be an object";
  }

  // Only validate CMS form components — identified by having a `variant` field
  // (e.g. "stacked", "inline"). Sections that use `form:` for label/config
  // objects (e.g. apply_form, hero signup labels) don't need conversion_name.
  if (!("variant" in form)) return null;

  const namesToCheck = collectConversionNames(form);

  if (!conversionNames?.length) return null;

  for (const name of namesToCheck) {
    if (!conversionNames.includes(name)) {
      return `conversion_name "${name}" is not valid. Valid values: ${conversionNames.join(", ")}`;
    }
  }

  return null;
}
