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

export interface FaqSection {
  type: "faq";
  title?: string;
  items?: FaqItem[];
  related_features?: string[];
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

export function clearSsrSchemaCache(): void {
  faqCacheByRoot.clear();
  imageRegistryByRoot.clear();
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

  return [];
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
  const updatedAt = (record.updated_at as string) || publishedAt;

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

    const pageData = loadRawYaml(route.contentType, route.slug, route.locale, ci, contentRoot);
    if (!pageData) return "";

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
    if (sections) {
      const locationSlug = route.contentType === "location" ? route.slug : undefined;
      const programSlug = route.contentType === "program" ? route.slug : undefined;
      const baseUrl = getBaseUrl();

      for (const section of sections) {
        if (section.type === "faq") {
          const faqItems = resolveFaqItems(section as unknown as FaqSection, route.locale, locationSlug, programSlug, contentRoot);
          if (faqItems.length > 0) {
            scripts.push(
              `<script type="application/ld+json" data-ssr="true">${JSON.stringify(buildFaqPageSchema(faqItems))}</script>`
            );
          }
        }

        if (section.type === "breadcrumb") {
          const bc = section as unknown as BreadcrumbSection;
          const resolvedItems = (bc.items || []).filter((item) => item.label);
          if (resolvedItems.length > 0) {
            scripts.push(
              `<script type="application/ld+json" data-ssr="true">${JSON.stringify(buildBreadcrumbListSchema(resolvedItems, baseUrl))}</script>`
            );
          }
        }
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
    log.error("[SSR-Schema] Error generating schema for", url, err);
    return "";
  }
}
