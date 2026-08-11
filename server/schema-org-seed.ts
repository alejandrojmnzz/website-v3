/**
 * Seed helpers for schema_org LocalBusiness (and related) sections.
 * Shared by migrate-schema-org-to-sections and ensure/attach APIs.
 */

import { getLegacyLocalBusinessCatalog } from "./schema-org";

const MIAMI_ISH_REGIONS = new Set([
  "usa-canada",
  "latam",
  "online",
  "remote",
  "america",
  "north-america",
  "usa",
  "canada",
]);

export function pickSeedTemplateSlug(region: string | undefined): "miami-usa" | "madrid-spain" {
  const r = (region || "").toLowerCase().trim();
  if (!r) return "miami-usa";
  if (r === "europe" || r.includes("europe") || r.includes("eu")) return "madrid-spain";
  if (
    MIAMI_ISH_REGIONS.has(r) ||
    r.includes("usa") ||
    r.includes("canada") ||
    r.includes("latam") ||
    r.includes("america") ||
    r.includes("remote") ||
    r.includes("online")
  ) {
    return "miami-usa";
  }
  if (
    r.includes("spain") ||
    r.includes("germany") ||
    r.includes("italy") ||
    r.includes("portugal") ||
    r.includes("ireland")
  ) {
    return "madrid-spain";
  }
  return "miami-usa";
}

function titleCaseName(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutType(entry: Record<string, unknown>): Record<string, unknown> {
  const { type: _type, ...rest } = entry;
  return rest;
}

export function buildLocalBusinessProperties(opts: {
  locationSlug: string;
  locationName: string;
  region: string | undefined;
  catalog?: Record<string, Record<string, unknown>>;
  siteUrl: string;
  contentRoot?: string;
}): Record<string, unknown> {
  const { locationSlug, locationName, region, siteUrl, contentRoot } = opts;
  const catalog =
    opts.catalog ??
    (getLegacyLocalBusinessCatalog(contentRoot) as Record<string, Record<string, unknown>>);
  const baseUrl = siteUrl.replace(/\/$/, "");
  const display = titleCaseName(locationName || locationSlug);

  let props: Record<string, unknown>;
  if (catalog[locationSlug] && typeof catalog[locationSlug] === "object") {
    props = withoutType(deepClone(catalog[locationSlug]));
  } else {
    const seedSlug = pickSeedTemplateSlug(region);
    const seed = catalog[seedSlug] || catalog["miami-usa"] || catalog["madrid-spain"];
    if (!seed) {
      props = {
        additional_type: "EducationalOrganization",
        name: `4Geeks Academy ${display}`,
        url: `${baseUrl}/en/location/${locationSlug}`,
      };
    } else {
      props = withoutType(deepClone(seed));
      props.name = `4Geeks Academy ${display}`;
      props.url = `${baseUrl}/en/location/${locationSlug}`;
      if (props.locales && typeof props.locales === "object" && !Array.isArray(props.locales)) {
        const locales = props.locales as Record<string, Record<string, unknown>>;
        if (locales.es && typeof locales.es === "object") {
          locales.es = {
            ...locales.es,
            name: `4Geeks Academy ${display}`,
            url: `${baseUrl}/es/ubicacion/${locationSlug}`,
          };
        }
      }
    }
  }

  if (!props.parent_organization) {
    props.parent_organization = "@organization";
  }

  return props;
}

/** Build a leading schema_org LocalBusiness section for a location entry. */
export function buildLocalBusinessSection(opts: {
  locationSlug: string;
  locationName: string;
  region: string | undefined;
  siteUrl: string;
  contentRoot?: string;
  catalog?: Record<string, Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    type: "schema_org",
    version: "1.0",
    section_id: `schema-org-local-business-${opts.locationSlug}`,
    schema_type: "LocalBusiness",
    properties: buildLocalBusinessProperties(opts),
  };
}
