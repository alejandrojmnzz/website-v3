/**
 * Resolve LeadForm route outcomes from submitted field values.
 *
 * When `routes` is present, the first entry whose `conditions` all match
 * (AND) wins. No match → null; the caller keeps root form props as fallback.
 * Presence of `routes` enables resolution — there is no separate advanced flag.
 */

export interface LeadFormRouteCondition {
  field_property_slug: string;
  value: unknown;
}

export interface LeadFormRouteSuccess {
  url?: string;
  message?: string;
}

export interface LeadFormRouteWebhook {
  url: string;
  method?: "POST" | "GET";
}

/** Fields a matched route may override on the form. New keys pass through automatically. */
export interface LeadFormRouteOutcome {
  conversion_name?: string;
  success?: LeadFormRouteSuccess;
  /** Same shape as form root: comma-separated string (e.g. "ai-lead" or "a,b"). */
  tags?: string;
  automations?: string;
  webhook?: LeadFormRouteWebhook;
  [key: string]: unknown;
}

export interface LeadFormRoute extends LeadFormRouteOutcome {
  conditions: LeadFormRouteCondition[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Returns the first matching route's outcome fields (everything except
 * `conditions`), or null if none match / routes is empty/absent.
 * Empty `conditions` never matches (root form is fallback).
 */
export function resolveLeadFormRoute(
  values: Record<string, unknown>,
  routes: LeadFormRoute[] | null | undefined,
): LeadFormRouteOutcome | null {
  if (!routes?.length) return null;

  for (const route of routes) {
    const { conditions, ...outcome } = route;
    if (!conditions?.length) continue;

    const matches = conditions.every(
      (c) =>
        String(values[c.field_property_slug] ?? "") === String(c.value ?? ""),
    );
    if (!matches) continue;

    return Object.fromEntries(
      Object.entries(outcome).filter(([, v]) => v !== undefined),
    ) as LeadFormRouteOutcome;
  }

  return null;
}

/** Normalize tags to a comma-separated string for the lead payload. */
export function normalizeLeadFormTags(
  tags: string | string[] | null | undefined,
  fallback = "website-lead",
): string {
  if (Array.isArray(tags) && tags.length > 0) {
    return tags.map(String).filter(Boolean).join(",");
  }
  if (typeof tags === "string" && tags.trim()) return tags.trim();
  return fallback;
}

/**
 * Merge a route outcome onto form settings. Defined route keys win;
 * plain objects (e.g. success, webhook) are shallow-merged with existing form values.
 */
export function applyLeadFormRouteOutcome<T extends Record<string, unknown>>(
  formData: T,
  route: LeadFormRouteOutcome | null,
): T {
  if (!route) return formData;

  const next: Record<string, unknown> = { ...formData };
  for (const [key, value] of Object.entries(route)) {
    if (value === undefined) continue;
    const prev = next[key];
    next[key] =
      isPlainObject(value) && isPlainObject(prev) ? { ...prev, ...value } : value;
  }
  return next as T;
}
