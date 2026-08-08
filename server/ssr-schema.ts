import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import { getMergedSchemas, getOrganizationTwitterHandle, getWebsiteDefaultSocialImage } from "./schema-org";
import { contentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { getFolder, getContentTypeConfig, resolveUrlPatternWithMapping } from "./content-types";
import { getBaseUrl, generateHreflangTags, generateListingHreflangTags, generateHomepageHreflangTags } from "./hreflang";
import { getHomePage, getSupportedLocales, getDefaultLocale, resolveEffectiveRobots, isIndexingBlocked } from "./settings";
import { applyFilters, applyMatchCountSort, type QueryFilter } from "./query-entries";
import { faqItemKey } from "./dynamic-entries";
import { mergeSingleTemplate } from "./database-single-loader";
import { resolveAllTemplateVars } from "./resolve-template-vars";
import { collectSectionSchemas, type SchemaComponentContext } from "./schema-components";
import { child } from "./logger";
const log = child({ module: "ssr-schema" });



const DEFAULT_CONTENT_ROOT = getDefaultContentRoot();

const DEFAULT_IMAGE_DIMENSIONS = { width: 1200, height: 630 };
const imageRegistryByRoot = new Map<string, Record<string, { src?: string; width?: number; height?: number }>>();

function getImageRegistryImages(contentRoot: string): Record<string, { src?: string; width?: number; height?: number }> {
  if (imageRegistryByRoot.has(contentRoot)) return imageRegistryByRoot.get(contentRoot)!;
  try {
    const regPath = path.join(contentRoot, "image-registry.json");
    if (!fs.existsSync(regPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(regPath, "utf-8")) as { images?: Record<string, { src?: string; width?: number; height?: number }> };
    const result = parsed.images || {};
    imageRegistryByRoot.set(contentRoot, result);
    return result;
  } catch {
    return {};
  }
}

function getImageDimensions(imageUrl: string, contentRoot: string): { width: number; height: number } {
  if (!imageUrl) return DEFAULT_IMAGE_DIMENSIONS;
  const images = getImageRegistryImages(contentRoot);
  const entry = Object.values(images).find((img) => img.src === imageUrl);
  if (entry?.width && entry?.height) return { width: entry.width, height: entry.height };
  return DEFAULT_IMAGE_DIMENSIONS;
}

function safeYamlLoad(yamlStr: string): unknown {
  const { escaped, map } = escapeTemplateVars(yamlStr);
  const parsed = yaml.load(escaped);
  return unescapeObjectVars(parsed, map);
}

interface FaqItem {
  question: string;
  answer: string;
  locations?: string[];
  related_features?: string[];
  priority?: number;
}

interface FaqDynamicEntries {
  database?: string;
  content_type?: string;
  limit?: number;
  sort?: string;
  permanent_filters?: Array<{ item_property_slug: string; value: unknown }>;
  ignored_entries?: string[];
  hardcoded_entries?: FaqItem[];
}

export interface FaqSection {
  type: "faq";
  title?: string;
  items?: FaqItem[];
  related_features?: string[];
  dynamic_entries?: FaqDynamicEntries;
  hardcoded_entries?: FaqItem[];
}

export interface BreadcrumbSectionItem {
  label: string;
  url?: string;
}

export interface BreadcrumbSection {
  type: "breadcrumb";
  items: BreadcrumbSectionItem[];
}

interface SchemaReference {
  include?: string[];
  overrides?: Record<string, Record<string, unknown>>;
}

interface ParsedRoute {
  contentType: string;
  slug: string;
  locale: string;
}

const faqCacheByRoot = new Map<string, Record<string, FaqItem[]>>();

function loadCentralizedFaqs(locale: string, contentRoot: string): FaqItem[] {
  if (!faqCacheByRoot.has(contentRoot)) faqCacheByRoot.set(contentRoot, {});
  const rootCache = faqCacheByRoot.get(contentRoot)!;
  if (rootCache[locale]) return rootCache[locale];

  const faqPath = path.join(contentRoot, "faqs", `${locale}.yml`);
  if (!fs.existsSync(faqPath)) return [];

  try {
    const content = fs.readFileSync(faqPath, "utf-8");
    const data = safeYamlLoad(content) as { faqs?: FaqItem[] };
    rootCache[locale] = data?.faqs || [];
    return rootCache[locale];
  } catch {
    return [];
  }
}

interface LocalDbEntries {
  entries: Record<string, unknown>[];
  localeField: string | null;
}

const localDbCacheByRoot = new Map<string, Map<string, LocalDbEntries>>();

/**
 * Synchronously loads entries from a local-source database
 * (e.g. db/frequently_asked_questions/faqs.yml). Remote databases are not
 * supported here; SSR schema generation must stay synchronous.
 */
function loadLocalDatabaseEntries(database: string, contentRoot: string): LocalDbEntries {
  if (!localDbCacheByRoot.has(contentRoot)) localDbCacheByRoot.set(contentRoot, new Map());
  const rootCache = localDbCacheByRoot.get(contentRoot)!;
  const cached = rootCache.get(database);
  if (cached) return cached;

  const empty: LocalDbEntries = { entries: [], localeField: null };
  try {
    const dbDir = path.join(contentRoot, "db", database);
    const configPath = path.join(dbDir, "config.yml");
    if (!fs.existsSync(configPath)) return empty;

    const config = safeYamlLoad(fs.readFileSync(configPath, "utf-8")) as {
      source?: { type?: string; local?: { filename?: string; results_path?: string } };
      field_mapping?: Record<string, string>;
      filter_by_locale?: boolean;
    } | null;
    if (!config || config.source?.type !== "local" || !config.source.local?.filename) return empty;

    const dataPath = path.join(dbDir, config.source.local.filename);
    if (!fs.existsSync(dataPath)) return empty;

    const raw = safeYamlLoad(fs.readFileSync(dataPath, "utf-8"));
    const resultsPath = config.source.local.results_path;
    let entries: unknown = raw;
    if (resultsPath && raw && typeof raw === "object" && !Array.isArray(raw)) {
      entries = (raw as Record<string, unknown>)[resultsPath];
    }
    if (!Array.isArray(entries)) return empty;

    const localeField =
      config.filter_by_locale !== false && config.field_mapping?.locale
        ? config.field_mapping.locale
        : null;

    const result: LocalDbEntries = {
      entries: entries as Record<string, unknown>[],
      localeField,
    };
    rootCache.set(database, result);
    return result;
  } catch {
    return empty;
  }
}

export function clearSsrSchemaCache(): void {
  faqCacheByRoot.clear();
  imageRegistryByRoot.clear();
  localDbCacheByRoot.clear();
}

function parseRoute(url: string, ci: typeof contentIndex = contentIndex): ParsedRoute | null {
  const cleanUrl = url.split("?")[0].split("#")[0];

  const supportedLocales = getSupportedLocales();
  const defaultLocale = getDefaultLocale();
  const localeSegmentMatch = cleanUrl.match(/^\/([a-z]{2,3})\/?$/);
  const isHomepage =
    cleanUrl === "/" ||
    (localeSegmentMatch !== null && supportedLocales.includes(localeSegmentMatch[1]));
  if (isHomepage) {
    const homePage = getHomePage();
    if (!homePage?.type || !homePage?.slug) return null;
    const locale = localeSegmentMatch && supportedLocales.includes(localeSegmentMatch[1])
      ? localeSegmentMatch[1]
      : defaultLocale;
    return { contentType: homePage.type, slug: homePage.slug, locale };
  }

  const resolved = ci.resolveUrl(cleanUrl);
  if (resolved && !resolved.fromDatabase) {
    let locale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
    if (resolved.params?.locale) {
      locale = resolved.params.locale;
    } else if (!cleanUrl.match(/^\/(en|es)\b/)) {
      const commonData = ci.loadCommonData(resolved.contentType, resolved.slug);
      if (commonData?.locale && typeof commonData.locale === "string") {
        locale = commonData.locale;
      }
    }
    return { contentType: resolved.contentType, slug: resolved.slug, locale };
  }

  return null;
}

export function loadRawYaml(contentType: string, slug: string, locale: string, ci: typeof contentIndex = contentIndex, contentRoot: string = DEFAULT_CONTENT_ROOT): Record<string, unknown> | null {
  const resolvedSlug = ci.resolveBaseSlug(slug, contentType);
  const folder = getFolder(contentType);
  const contentDir = path.join(contentRoot, folder, resolvedSlug);
  const commonPath = path.join(contentDir, "_common.yml");

  const contentPath = path.join(contentDir, `${locale}.yml`);

  if (!fs.existsSync(contentPath)) return null;

  try {
    let commonData: Record<string, unknown> = {};
    if (fs.existsSync(commonPath)) {
      commonData = safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>;
    }

    const contentData = safeYamlLoad(fs.readFileSync(contentPath, "utf-8")) as Record<string, unknown>;
    return deepMerge(commonData, contentData);
  } catch {
    return null;
  }
}

export function buildFaqPageSchema(faqItems: Array<{ question: string; answer: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function buildBreadcrumbListSchema(items: BreadcrumbSectionItem[], baseUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => {
      const element: Record<string, unknown> = {
        "@type": "ListItem",
        position: index + 1,
        name: item.label,
      };
      if (item.url) {
        element.item = item.url.startsWith("http") ? item.url : `${baseUrl}${item.url}`;
      }
      return element;
    }),
  };
}

export function resolveFaqItems(section: FaqSection, locale: string, locationSlug?: string, programSlug?: string, contentRoot: string = DEFAULT_CONTENT_ROOT): Array<{ question: string; answer: string }> {
  if (section.items && section.items.length > 0) {
    return section.items.map(({ question, answer }) => ({ question, answer }));
  }

  if (section.related_features && section.related_features.length > 0) {
    const allFaqs = loadCentralizedFaqs(locale, contentRoot);
    const relatedFeatures = section.related_features;

    let filtered = allFaqs
      .filter((faq) => {
        const faqFeatures = faq.related_features || [];
        return relatedFeatures.some((f) => faqFeatures.includes(f));
      });

    // Apply location filtering
    if (locationSlug) {
      // On location page: show "all" FAQs + FAQs for this specific location
      filtered = filtered.filter((faq) => {
        const locations = faq.locations || ["all"];
        return locations.includes("all") || locations.includes(locationSlug);
      });
    } else {
      // On general page: only show "all" FAQs, exclude location-specific ones
      filtered = filtered.filter((faq) => {
        const locations = faq.locations || ["all"];
        return locations.includes("all") || locations.length === 0;
      });
    }

    filtered = filtered
      .sort((a, b) => {
        const aFeatures = a.related_features || [];
        const bFeatures = b.related_features || [];
        const aCount = relatedFeatures.filter((f) => aFeatures.includes(f)).length;
        const bCount = relatedFeatures.filter((f) => bFeatures.includes(f)).length;
        
        // Prioritize FAQs that have the programSlug tag when programSlug is provided and in selected topics
        const shouldPrioritizeProgram = programSlug && relatedFeatures.includes(programSlug);
        if (shouldPrioritizeProgram) {
          const aHasProgram = aFeatures.includes(programSlug);
          const bHasProgram = bFeatures.includes(programSlug);
          if (aHasProgram !== bHasProgram) {
            return aHasProgram ? -1 : 1; // FAQs with programSlug come first (lower sort value)
          }
        }
        
        if (bCount !== aCount) return bCount - aCount;
        return (a.priority ?? 2) - (b.priority ?? 2);
      })
      .slice(0, 9);

    return filtered.map(({ question, answer }) => ({ question, answer }));
  }

  const dyn = section.dynamic_entries;
  if (dyn?.database) {
    const { entries, localeField } = loadLocalDatabaseEntries(dyn.database, contentRoot);

    let items = localeField
      ? entries.filter((item) => String(item[localeField] ?? "") === locale)
      : [...entries];

    const filters: QueryFilter[] | undefined = dyn.permanent_filters?.map((pf) => ({
      field: pf.item_property_slug,
      value: pf.value,
    }));
    items = applyFilters(items, filters);
    items = applyMatchCountSort(items, filters, dyn.sort);

    const hardcodedEntries = dyn.hardcoded_entries || section.hardcoded_entries || [];
    const hardcodedCount = hardcodedEntries.length;

    if (dyn.ignored_entries && dyn.ignored_entries.length > 0) {
      const ignoredSet = new Set(dyn.ignored_entries.map((k) => k.toLowerCase().trim()));
      items = items.filter((item) => !ignoredSet.has(faqItemKey(String(item.question ?? ""))));
    }

    if (dyn.limit && dyn.limit > 0) {
      items = items.slice(0, Math.max(0, dyn.limit - hardcodedCount));
    }

    return [...hardcodedEntries, ...(items as unknown as FaqItem[])]
      .filter((item) => typeof item?.question === "string" && typeof item?.answer === "string")
      .map(({ question, answer }) => ({ question, answer }));
  }

  // Standalone root hardcoded_entries (no dynamic database, no related_features):
  // mirrors FaqDefault, which falls back to hardcoded_entries when items is empty.
  if (section.hardcoded_entries && section.hardcoded_entries.length > 0) {
    return section.hardcoded_entries
      .filter((item) => typeof item?.question === "string" && typeof item?.answer === "string")
      .map(({ question, answer }) => ({ question, answer }));
  }

  return [];
}

/** Dedupe FAQ items by normalized question text, preserving first occurrence. */
export function dedupeFaqItems(
  items: Array<{ question: string; answer: string }>,
): Array<{ question: string; answer: string }> {
  const seen = new Set<string>();
  const result: Array<{ question: string; answer: string }> = [];
  for (const item of items) {
    const key = item.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function generateDatabaseSsrHtml(
  contentType: string,
  record: Record<string, unknown>,
  locale: string,
  ci: typeof contentIndex = contentIndex,
  contentRoot: string = DEFAULT_CONTENT_ROOT,
): string {
  const baseUrl = getBaseUrl();
  const config = getContentTypeConfig(contentType);
  if (!config?.url_pattern) return "";

  const urlPattern = config.url_pattern[locale] || config.url_pattern["en"];
  if (!urlPattern) return "";

  // Normalize any object-type fields used in URL patterns (e.g. blog `category` is {slug:...})
  const recordForUrl: Record<string, unknown> = { ...record };
  for (const key of Object.keys(recordForUrl)) {
    const val = recordForUrl[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      if (typeof obj.slug === "string") {
        recordForUrl[key] = obj.slug;
      } else if (typeof obj.name === "string") {
        recordForUrl[key] = obj.name;
      }
    }
  }
  const recordUrl = `${baseUrl}${resolveUrlPatternWithMapping(urlPattern, recordForUrl, locale, null)}`;
  const scripts: string[] = [];

  const title = ((record.title as string) || "").replace(/"/g, "&quot;");
  const description = ((record.description as string) || (record.preview as string) || "").replace(/"/g, "&quot;");
  const image = (record.preview as string) || (record.image as string) || "";
  const publishedAt = (record.published_at as string) || (record.created_at as string) || "";
  const { normalizeFlexibleDate } = require("@shared/normalizeFlexibleDate") as typeof import("@shared/normalizeFlexibleDate");
  const updatedAt =
    normalizeFlexibleDate(record.updated_at) ||
    normalizeFlexibleDate(publishedAt) ||
    publishedAt;

  let authorName = "4Geeks Academy";
  if (record.author && typeof record.author === "object") {
    const author = record.author as Record<string, unknown>;
    authorName = `${author.first_name || ""} ${author.last_name || ""}`.trim() || "4Geeks Academy";
  } else if (typeof record.author === "string") {
    authorName = record.author || "4Geeks Academy";
  }

  const schemaType = contentType === "blog" ? "BlogPosting" : "WebPage";
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaType,
    headline: record.title,
    description: record.description || record.preview || "",
    url: recordUrl,
    datePublished: publishedAt,
    dateModified: updatedAt,
    author: { "@type": "Person", name: authorName },
    publisher: { "@type": "Organization", name: "4Geeks Academy", url: baseUrl },
  };
  if (image) schema.image = image;
  if (record.tags && Array.isArray(record.tags) && record.tags.length > 0) {
    schema.keywords = record.tags.join(", ");
  }
  scripts.push(`<script type="application/ld+json" data-ssr="true">${JSON.stringify(schema)}</script>`);

  if (contentType === "blog") {
    const blogLabel = "Blog";
    const homeLabel = locale === "es" ? "Inicio" : "Home";
    const breadcrumbItems: BreadcrumbSectionItem[] = [
      { label: homeLabel, url: "/" },
      { label: blogLabel, url: locale === "es" ? "/es/blog" : "/en/blog" },
      { label: (record.title as string) || "" },
    ];
    scripts.push(
      `<script type="application/ld+json" data-ssr="true">${JSON.stringify(buildBreadcrumbListSchema(breadcrumbItems, baseUrl))}</script>`
    );
  }

  // Section-driven schema contributions from the fully merged single template
  // (shared template layers + per-entry overrides), with {{ single.* }} vars
  // resolved against this record — same sections the page renders.
  try {
    const template = mergeSingleTemplate(contentType, locale, (record.slug as string) || undefined, undefined, contentRoot);
    const templateSections = template?.sections;
    if (Array.isArray(templateSections)) {
      const resolvedSections = resolveAllTemplateVars(templateSections, {
        singleEntry: record,
        meta: (template?.meta as Record<string, unknown> | undefined),
        contentRoot,
        context: { locale },
        skipSiteVars: false,
      }) as Array<Record<string, unknown>>;
      const context: SchemaComponentContext = {
        locale,
        contentRoot,
        baseUrl,
      };
      for (const sectionSchema of collectSectionSchemas(resolvedSections, context)) {
        // Blog already emits a synthetic BreadcrumbList above; skip
        // section-driven trails so we never publish two competing ones.
        if (contentType === "blog" && (sectionSchema as Record<string, unknown>)["@type"] === "BreadcrumbList") {
          continue;
        }
        scripts.push(
          `<script type="application/ld+json" data-ssr="true">${JSON.stringify(sectionSchema)}</script>`
        );
      }
    }
  } catch (err) {
    log.error({ err }, `[SSR-Schema] Error collecting section schemas for ${contentType}`);
  }

  const robots = resolveEffectiveRobots(
    typeof record.robots === "string" ? record.robots : undefined,
    contentRoot,
  );
  const ogType = contentType === "blog" ? "article" : "website";
  const twitterHandle = getOrganizationTwitterHandle(contentRoot);
  const imageDimensions = image ? getImageDimensions(image, contentRoot) : null;
  const metaTags = [
    `<title>${title} | 4Geeks Academy</title>`,
    `<meta name="robots" content="${robots}" />`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${recordUrl}" />`,
    image ? `<meta property="og:image" content="${image}" />` : "",
    imageDimensions ? `<meta property="og:image:width" content="${imageDimensions.width}" />` : "",
    imageDimensions ? `<meta property="og:image:height" content="${imageDimensions.height}" />` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    twitterHandle ? `<meta name="twitter:site" content="${twitterHandle}" />` : "",
    twitterHandle ? `<meta name="twitter:creator" content="${twitterHandle}" />` : "",
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    image ? `<meta name="twitter:image" content="${image}" />` : "",
    publishedAt ? `<meta property="article:published_time" content="${publishedAt}" />` : "",
    updatedAt ? `<meta property="article:modified_time" content="${updatedAt}" />` : "",
    `<meta property="article:author" content="${authorName}" />`,
    `<link rel="canonical" href="${recordUrl}" />`,
  ].filter(Boolean);

  const hreflangTags = generateHreflangTags(contentType, (record.slug as string) || "", locale, record, undefined, ci);
  return [...hreflangTags, ...metaTags, ...scripts].join("\n");
}

export function generateListingSsrHtml(contentType: string, locale: string, contentRoot: string = DEFAULT_CONTENT_ROOT): string {
  const baseUrl = getBaseUrl();
  const config = getContentTypeConfig(contentType);
  if (!config?.url_pattern) return "";

  const pattern = config.url_pattern[locale] || config.url_pattern["en"];
  if (!pattern) return "";

  const listingUrl = `${baseUrl}${pattern.replace(/\/:[a-zA-Z_]+/g, "").replace(/\/+$/, "") || "/"}`;
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);
  const title = `${label} | 4Geeks Academy`;
  const description = locale === "es"
    ? `Explora nuestro contenido de ${label.toLowerCase()} en 4Geeks Academy.`
    : `Explore our ${label.toLowerCase()} content at 4Geeks Academy.`;

  const twitterHandle = getOrganizationTwitterHandle(contentRoot);
  const defaultSocialImage = getWebsiteDefaultSocialImage(contentRoot);
  const defaultImageDimensions = defaultSocialImage ? getImageDimensions(defaultSocialImage, contentRoot) : null;
  const metaTags = [
    `<title>${title}</title>`,
    `<meta name="robots" content="${resolveEffectiveRobots(undefined, contentRoot)}" />`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${listingUrl}" />`,
    defaultSocialImage ? `<meta property="og:image" content="${defaultSocialImage}" />` : "",
    defaultImageDimensions ? `<meta property="og:image:width" content="${defaultImageDimensions.width}" />` : "",
    defaultImageDimensions ? `<meta property="og:image:height" content="${defaultImageDimensions.height}" />` : "",
    `<meta name="twitter:card" content="${defaultSocialImage ? "summary_large_image" : "summary"}" />`,
    twitterHandle ? `<meta name="twitter:site" content="${twitterHandle}" />` : "",
    twitterHandle ? `<meta name="twitter:creator" content="${twitterHandle}" />` : "",
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    defaultSocialImage ? `<meta name="twitter:image" content="${defaultSocialImage}" />` : "",
    `<link rel="canonical" href="${listingUrl}" />`,
  ].filter(Boolean);

  const hreflangTags = generateListingHreflangTags(contentType, locale);
  return [...hreflangTags, ...metaTags].join("\n");
}

export function resolvePageRobots(url: string, ci: typeof contentIndex = contentIndex, contentRoot: string = DEFAULT_CONTENT_ROOT): string {
  try {
    if (isIndexingBlocked(contentRoot)) return "noindex, nofollow";
    const route = parseRoute(url, ci);
    if (!route) return "index, follow";
    const pageData = loadRawYaml(route.contentType, route.slug, route.locale, ci, contentRoot);
    if (!pageData) return "index, follow";
    const meta = pageData.meta as Record<string, unknown> | undefined;
    return resolveEffectiveRobots(
      typeof meta?.robots === "string" ? meta.robots : undefined,
      contentRoot,
    );
  } catch {
    return resolveEffectiveRobots(undefined, contentRoot);
  }
}

export function generateSsrSchemaHtml(url: string, ci: typeof contentIndex = contentIndex, contentRoot: string = DEFAULT_CONTENT_ROOT): string {
  try {
    const route = parseRoute(url, ci);
    if (!route) return "";

    // Use fully merged content (shared single_template + per-entry layers) so
    // schema contributors see the same sections the page actually renders.
    const merged = ci.loadMergedContent(route.contentType, route.slug, route.locale);
    let pageData = merged.data ?? loadRawYaml(route.contentType, route.slug, route.locale, ci, contentRoot);
    if (!pageData) return "";
    if (merged.data && merged.isSharedTemplate) {
      // Shared-template pages may reference {{ single.* }} vars; the merged
      // entry data itself is the "single" record for static entries.
      pageData = resolveAllTemplateVars(pageData, {
        singleEntry: pageData,
        contentRoot,
        context: { locale: route.locale },
        skipSiteVars: false,
      }) as Record<string, unknown>;
    }

    const scripts: string[] = [];

    const schemaRef = pageData.schema as SchemaReference | undefined;
    if (schemaRef?.include && schemaRef.include.length > 0) {
      const schemas = getMergedSchemas(schemaRef, route.locale, contentRoot);
      for (const schema of schemas) {
        scripts.push(
          `<script type="application/ld+json" data-ssr="true">${JSON.stringify(schema)}</script>`
        );
      }
    }

    const sections = pageData.sections as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(sections)) {
      const context: SchemaComponentContext = {
        locale: route.locale,
        contentRoot,
        baseUrl: getBaseUrl(),
        locationSlug: route.contentType === "location" ? route.slug : undefined,
        programSlug: route.contentType === "program" ? route.slug : undefined,
      };
      for (const sectionSchema of collectSectionSchemas(sections, context)) {
        scripts.push(
          `<script type="application/ld+json" data-ssr="true">${JSON.stringify(sectionSchema)}</script>`
        );
      }
    }

    const meta = pageData.meta as Record<string, unknown> | undefined;
    const robots = resolveEffectiveRobots(
      typeof meta?.robots === "string" ? meta.robots : undefined,
      contentRoot,
    );
    const robotsTag = `<meta name="robots" content="${robots}" />`;

    const ogImage = typeof meta?.og_image === "string" ? meta.og_image : null;
    const twitterHandle = getOrganizationTwitterHandle(contentRoot);
    const socialImageUrl = ogImage || getWebsiteDefaultSocialImage(contentRoot);
    const socialImageDimensions = socialImageUrl ? getImageDimensions(socialImageUrl, contentRoot) : null;
    const socialTags = [
      twitterHandle ? `<meta name="twitter:site" content="${twitterHandle}" />` : "",
      twitterHandle ? `<meta name="twitter:creator" content="${twitterHandle}" />` : "",
      socialImageUrl && !ogImage ? `<meta property="og:image" content="${socialImageUrl}" />` : "",
      socialImageDimensions ? `<meta property="og:image:width" content="${socialImageDimensions.width}" />` : "",
      socialImageDimensions ? `<meta property="og:image:height" content="${socialImageDimensions.height}" />` : "",
    ].filter(Boolean);

    const homePage = getHomePage();
    const isHomepageRoute = homePage?.type === route.contentType && homePage?.slug === route.slug;
    const hreflangTags = isHomepageRoute
      ? generateHomepageHreflangTags()
      : generateHreflangTags(route.contentType, route.slug, route.locale, undefined, undefined, ci);
    return [...hreflangTags, robotsTag, ...socialTags, ...scripts].join("\n");
  } catch (err) {
    log.error({ err }, `[SSR-Schema] Error generating schema for ${url}`);
    return "";
  }
}
