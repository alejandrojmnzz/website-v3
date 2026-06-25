import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { child } from "./logger";
const log = child({ module: "schema-org" });



interface SchemaLocales {
  [locale: string]: Record<string, unknown>;
}

interface BaseSchema {
  type: string;
  locales?: SchemaLocales;
  [key: string]: unknown;
}

interface SchemaOrgConfig {
  organization?: BaseSchema;
  website?: BaseSchema;
  courses?: Record<string, BaseSchema>;
  item_lists?: Record<string, BaseSchema>;
  local_business?: Record<string, BaseSchema>;
}

interface SchemaReference {
  include?: string[];
  overrides?: Record<string, Record<string, unknown>>;
}

let schemaCache: SchemaOrgConfig | null = null;

function loadSchemaConfig(): SchemaOrgConfig {
  if (schemaCache) {
    return schemaCache;
  }

  const schemaPath = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", "schema-org.yml");
  
  if (!fs.existsSync(schemaPath)) {
    log.warn("[SchemaOrg] schema-org.yml not found");
    return {};
  }

  try {
    const content = fs.readFileSync(schemaPath, "utf-8");
    schemaCache = yaml.load(content) as SchemaOrgConfig;
    return schemaCache || {};
  } catch (err) {
    log.error({ err: err }, "[SchemaOrg] Error loading schema-org.yml:");
    return {};
  }
}

export function clearSchemaCache(): void {
  schemaCache = null;
}

function camelToJsonLd(key: string): string {
  const mappings: Record<string, string> = {
    type: "@type",
    same_as: "sameAs",
    aggregate_rating: "aggregateRating",
    rating_value: "ratingValue",
    review_count: "reviewCount",
    best_rating: "bestRating",
    worst_rating: "worstRating",
    contact_point: "contactPoint",
    contact_type: "contactType",
    address_country: "addressCountry",
    founding_date: "foundingDate",
    search_action: "potentialAction",
    query_input: "query-input",
    educational_level: "educationalLevel",
    time_required: "timeRequired",
    item_list_order: "itemListOrder",
    item_list_element: "itemListElement",
  };
  return mappings[key] || key;
}

function transformToJsonLd(obj: Record<string, unknown>, locale: string = "en"): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (key === "locales") continue;
    
    const jsonLdKey = camelToJsonLd(key);
    
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (key === "search_action") {
        result["potentialAction"] = {
          "@type": "SearchAction",
          target: (value as Record<string, unknown>).target,
          "query-input": (value as Record<string, unknown>).query_input,
        };
      } else if (key === "aggregate_rating") {
        result["aggregateRating"] = {
          "@type": "AggregateRating",
          ...transformToJsonLd(value as Record<string, unknown>, locale),
        };
      } else if (key === "contact_point") {
        result["contactPoint"] = {
          "@type": "ContactPoint",
          ...transformToJsonLd(value as Record<string, unknown>, locale),
        };
      } else if (key === "address") {
        result["address"] = {
          "@type": "PostalAddress",
          ...transformToJsonLd(value as Record<string, unknown>, locale),
        };
      } else {
        result[jsonLdKey] = transformToJsonLd(value as Record<string, unknown>, locale);
      }
    } else if (Array.isArray(value)) {
      if (key === "founders") {
        result["founder"] = value.map((f: { name: string }) => ({
          "@type": "Person",
          name: f.name,
        }));
      } else if (key === "items" && value[0]?.ref) {
        // ItemList items with refs - will be resolved separately
        result["itemListElement"] = value;
      } else {
        result[jsonLdKey] = value;
      }
    } else {
      result[jsonLdKey] = value;
    }
  }
  
  // Apply locale overrides
  const locales = obj.locales as SchemaLocales | undefined;
  if (locales && locales[locale]) {
    for (const [key, value] of Object.entries(locales[locale])) {
      const jsonLdKey = camelToJsonLd(key);
      result[jsonLdKey] = value;
    }
  }
  
  return result;
}

function resolveSchemaRef(ref: string, config: SchemaOrgConfig, locale: string): Record<string, unknown> | null {
  if (ref === "@organization") {
    return config.organization ? transformToJsonLd(config.organization, locale) : null;
  }
  
  if (ref.startsWith("courses:")) {
    const courseSlug = ref.replace("courses:", "");
    const course = config.courses?.[courseSlug];
    if (course) {
      const transformed = transformToJsonLd(course, locale);
      // Resolve provider reference
      if (transformed.provider === "@organization" && config.organization) {
        transformed.provider = {
          "@type": config.organization.type,
          name: config.organization.name,
          url: config.organization.url,
        };
      }
      return transformed;
    }
  }
  
  if (ref.startsWith("item_lists:")) {
    const listSlug = ref.replace("item_lists:", "");
    const list = config.item_lists?.[listSlug];
    if (list) {
      const transformed = transformToJsonLd(list, locale);
      // Resolve item refs
      if (Array.isArray(transformed.itemListElement)) {
        transformed.itemListElement = transformed.itemListElement.map((item: { ref?: string; position?: number }) => {
          if (item.ref) {
            const resolvedItem = resolveSchemaRef(item.ref, config, locale);
            return {
              "@type": "ListItem",
              position: item.position,
              item: resolvedItem,
            };
          }
          return item;
        });
      }
      return transformed;
    }
  }

  if (ref.startsWith("local_business:")) {
    const bizSlug = ref.replace("local_business:", "");
    const biz = config.local_business?.[bizSlug];
    if (biz) {
      const transformed = transformToJsonLd(biz, locale);
      if (transformed.parentOrganization === "@organization" && config.organization) {
        transformed.parentOrganization = {
          "@type": config.organization.type,
          name: config.organization.name,
          url: config.organization.url,
        };
      }
      return transformed;
    }
  }
  
  return null;
}

export function getSchema(schemaKey: string, locale: string = "en"): Record<string, unknown> | null {
  const config = loadSchemaConfig();
  
  if (schemaKey === "organization" && config.organization) {
    return {
      "@context": "https://schema.org",
      ...transformToJsonLd(config.organization, locale),
    };
  }
  
  if (schemaKey === "website" && config.website) {
    return {
      "@context": "https://schema.org",
      ...transformToJsonLd(config.website, locale),
    };
  }
  
  if (schemaKey.startsWith("courses:")) {
    const resolved = resolveSchemaRef(schemaKey, config, locale);
    if (resolved) {
      return {
        "@context": "https://schema.org",
        ...resolved,
      };
    }
  }
  
  if (schemaKey.startsWith("item_lists:")) {
    const resolved = resolveSchemaRef(schemaKey, config, locale);
    if (resolved) {
      return {
        "@context": "https://schema.org",
        ...resolved,
      };
    }
  }

  if (schemaKey.startsWith("local_business:")) {
    const resolved = resolveSchemaRef(schemaKey, config, locale);
    if (resolved) {
      return {
        "@context": "https://schema.org",
        ...resolved,
      };
    }
  }
  
  return null;
}

export function getMergedSchemas(
  schemaRef: SchemaReference,
  locale: string = "en"
): Record<string, unknown>[] {
  const config = loadSchemaConfig();
  const result: Record<string, unknown>[] = [];
  
  if (!schemaRef.include || schemaRef.include.length === 0) {
    return result;
  }
  
  for (const key of schemaRef.include) {
    let schema = getSchema(key, locale);
    
    if (schema) {
      // Apply overrides (Option A: full replace of properties)
      const overrides = schemaRef.overrides?.[key];
      if (overrides) {
        schema = { ...schema };
        for (const [propKey, propValue] of Object.entries(overrides)) {
          const jsonLdKey = camelToJsonLd(propKey);
          (schema as Record<string, unknown>)[jsonLdKey] = propValue;
        }
      }
      
      result.push(schema);
    }
  }
  
  return result;
}

const SOCIAL_PLATFORM_DOMAINS: Record<string, string[]> = {
  twitter: ["twitter.com/", "x.com/"],
  linkedin: ["linkedin.com/"],
  facebook: ["facebook.com/"],
  youtube: ["youtube.com/"],
  instagram: ["instagram.com/"],
  github: ["github.com/"],
};

function matchesPlatform(url: string, platform: string): boolean {
  const domains = SOCIAL_PLATFORM_DOMAINS[platform];
  if (!domains) return false;
  return domains.some((d) => url.includes(d));
}

export function getOrganizationTwitterHandle(): string | null {
  const config = loadSchemaConfig();
  const sameAs = config.organization?.same_as;
  if (!Array.isArray(sameAs)) return null;
  for (const url of sameAs) {
    if (typeof url === "string" && matchesPlatform(url, "twitter")) {
      const segments = url.replace(/\/$/, "").split("/").filter(Boolean);
      const handle = segments[segments.length - 1];
      if (handle) return `@${handle}`;
    }
  }
  return null;
}

export function getOrganizationSameAsUrl(platform: string): string | null {
  const config = loadSchemaConfig();
  const sameAs = config.organization?.same_as;
  if (!Array.isArray(sameAs)) return null;
  for (const url of sameAs) {
    if (typeof url === "string" && matchesPlatform(url, platform)) {
      return url;
    }
  }
  return null;
}

export function updateOrganizationSameAsUrl(platform: string, url: string): void {
  const schemaPath = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", "schema-org.yml");
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(schemaPath)) {
    try {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  if (!existing.organization || typeof existing.organization !== "object") {
    existing.organization = {};
  }
  const org = existing.organization as Record<string, unknown>;

  const newUrl = url.trim() || null;
  let sameAs: string[] = Array.isArray(org.same_as) ? [...(org.same_as as string[])] : [];

  const matchIndex = sameAs.findIndex(
    (entry) => typeof entry === "string" && matchesPlatform(entry, platform)
  );

  if (newUrl) {
    if (matchIndex >= 0) {
      sameAs[matchIndex] = newUrl;
    } else {
      sameAs.push(newUrl);
    }
  } else if (matchIndex >= 0) {
    sameAs.splice(matchIndex, 1);
  }

  org.same_as = sameAs;

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(schemaPath, output, "utf-8");
  clearSchemaCache();
}

export function getWebsiteDefaultSocialImage(): string | null {
  const config = loadSchemaConfig();
  const img = (config.website as Record<string, unknown> | undefined)?.default_social_image;
  return typeof img === "string" && img.trim() !== "" ? img.trim() : null;
}

export function updateOrganizationTwitterHandle(handle: string): void {
  const schemaPath = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", "schema-org.yml");
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(schemaPath)) {
    try {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }

  if (!existing.organization || typeof existing.organization !== "object") {
    existing.organization = {};
  }
  const org = existing.organization as Record<string, unknown>;

  const normalizedHandle = handle.replace(/^@/, "").trim();
  const newUrl = normalizedHandle ? `https://twitter.com/${normalizedHandle}` : null;

  let sameAs: string[] = Array.isArray(org.same_as) ? [...(org.same_as as string[])] : [];

  const twitterIndex = sameAs.findIndex(
    (url) => typeof url === "string" && (url.includes("twitter.com/") || url.includes("x.com/"))
  );

  if (newUrl) {
    if (twitterIndex >= 0) {
      sameAs[twitterIndex] = newUrl;
    } else {
      sameAs.push(newUrl);
    }
  } else if (twitterIndex >= 0) {
    sameAs.splice(twitterIndex, 1);
  }

  org.same_as = sameAs;

  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(schemaPath, output, "utf-8");
  clearSchemaCache();
}

export function updateWebsiteDefaultSocialImage(imageUrl: string): void {
  const schemaPath = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", "schema-org.yml");
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(schemaPath)) {
    try {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      existing = (yaml.load(raw) as Record<string, unknown>) || {};
    } catch {}
  }
  if (!existing.website || typeof existing.website !== "object") {
    existing.website = {};
  }
  (existing.website as Record<string, unknown>).default_social_image = imageUrl;
  const output = yaml.dump(existing, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(schemaPath, output, "utf-8");
  clearSchemaCache();
}

export function getAvailableSchemaKeys(): string[] {
  const config = loadSchemaConfig();
  const keys: string[] = [];
  
  if (config.organization) keys.push("organization");
  if (config.website) keys.push("website");
  
  if (config.courses) {
    for (const slug of Object.keys(config.courses)) {
      keys.push(`courses:${slug}`);
    }
  }
  
  if (config.item_lists) {
    for (const slug of Object.keys(config.item_lists)) {
      keys.push(`item_lists:${slug}`);
    }
  }
  
  if (config.local_business) {
    for (const slug of Object.keys(config.local_business)) {
      keys.push(`local_business:${slug}`);
    }
  }
  
  return keys;
}
