import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Request, Response, NextFunction } from "express";
import { contentIndex, ContentIndex } from "./content-index";
import { resolveDynamicEntries } from "./dynamic-entries";
import { queryEntries } from "./query-entries";
import { resolveLayout, getAllConfigs, getLabel, getLayout, getLocaleKey, getContentTypeConfig, getFieldMapping } from "./content-types";
import {
  applyComponentSectionDefaults,
  applyComponentImageSizes,
  buildImageIdToSchemaSizesMap,
} from "./component-registry";
import { getVariableManager } from "./variable-manager";
import { loadImageRegistry } from "./image-registry";
import { getMergedImageRegistry } from "./image-registry-resolver";
import type { SiteContext } from "./site-manager";
import { readNavigationEagerManifest } from "./navigation-eager-manifest";
import { getDefaultLocale, normalizeLocale, resolveEffectiveRobots } from "./settings";
import { getApiPath } from "../shared/api-paths";
import { loadDatabaseSinglePage } from "./database-single-loader";
import { resolveSingleVars } from "./single-resolver";
import { resolveFieldValue } from "./transform";
import { databaseManager, type DatabaseManager, getCachedDatabaseEntryCount } from "./database";
import { applyEntryModulePreload } from "./utils/html-transforms";

const DEFAULT_SRCSET_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

function firstPresetSizesFromImageEntry(
  imageEntry: { preset?: string[] } | null | undefined,
  presets: Record<string, { sizes?: string }> | undefined,
): string | undefined {
  if (!imageEntry?.preset?.length || !presets) return undefined;
  for (const name of imageEntry.preset) {
    const s = presets[name]?.sizes;
    if (typeof s === "string" && s.trim()) return s;
  }
  return undefined;
}

interface SingleQuery {
  queryKey: unknown[];
  data: unknown;
}

export interface InitialDataPayload {
  queries: SingleQuery[];
  locale?: string;
}

async function fetchBlogListingPage(
  locale: string,
  page: number,
  category: string,
  dbm: DatabaseManager = databaseManager,
  contentRoot?: string,
  ci: ContentIndex = contentIndex,
): Promise<Record<string, unknown> | null> {
  try {
    const filters =
      category && category !== "all"
        ? [{ field: "category", value: category }]
        : undefined;
    const { items: posts } = await queryEntries(
      {
        from: { contentType: "blog" },
        locale: normalizeLocale(locale),
        filters,
        sort: "-published_at",
      },
      { db: dbm, contentIndex: ci, contentRoot: contentRoot ?? ci.contentRoot },
    );
    const { items: allLocalePosts } = await queryEntries(
      {
        from: { contentType: "blog" },
        locale: normalizeLocale(locale),
      },
      { db: dbm, contentIndex: ci, contentRoot: contentRoot ?? ci.contentRoot },
    );
    const categories = Array.from(
      new Set(
        allLocalePosts
          .map((p: any) => p.category?.slug || "")
          .filter(Boolean),
      ),
    ).sort();
    const limit = 12;
    const total = posts.length;
    const stripped = posts.map((p: any) => {
      const { content, readme, ...rest } = p;
      return rest;
    });
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = stripped.slice(start, start + limit);
    return {
      count: paginated.length,
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      categories,
      results: paginated,
    };
  } catch {
    return null;
  }
}

function resolveBlogConfigQuery(contentRoot?: string): SingleQuery | null {
  try {
    const config = getContentTypeConfig("blog", contentRoot);
    if (!config) return null;
    return {
      queryKey: ["/api/blog/config"],
      data: config,
    };
  } catch {
    return null;
  }
}

export async function resolvePageQuery(
  url: string,
  ci: ContentIndex = contentIndex,
  dbm: DatabaseManager = databaseManager,
): Promise<SingleQuery | null> {
  // Don't seed page data for force_variant requests — the SSR render would use
  // the default-page data while the client needs a different query key for the
  // variant, causing a hydration mismatch. Return null so SSR emits an empty
  // shell; the client spinner + fetch handles it cleanly.
  if (url.includes("force_variant=")) return null;

  const cleanUrl = url.split("?")[0].split("#")[0];

  if (
    cleanUrl === "/" ||
    cleanUrl === "/en" ||
    cleanUrl === "/en/" ||
    cleanUrl === "/es" ||
    cleanUrl === "/es/"
  ) {
    const locale = cleanUrl.startsWith("/es") ? "es" : "en";
    const slug = "home";
    const result = ci.loadContent({
      contentType: "page",
      slug,
      localeOrVariant: locale,
    });
    if (result.success) {
      const data = result.data as any;
      if (data.sections && Array.isArray(data.sections)) {
        applyComponentSectionDefaults(data.sections);
        data.sections = (await resolveDynamicEntries(
          data.sections,
          locale,
          { db: dbm, contentRoot: ci.contentRoot, contentIndex: ci },
        )) as any;
        applyComponentImageSizes(data.sections);
      }
      const pageRaw = ci.loadMergedContent("page", slug, locale);
      const layout = resolveLayout("page", pageRaw.data || {}, ci.contentRoot);
      data.layout = layout;
      return {
        queryKey: ["/api/pages", slug, locale],
        data,
      };
    }
    return null;
  }

  try {
    const resolved = ci.resolveUrl(cleanUrl);
    if (!resolved) return null;

    const { contentType, slug, fromDatabase, patternLocale } = resolved;
    const isNonLocalized = patternLocale === "default";

    if (fromDatabase) {
      try {
        let locale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
        if (resolved.params?.locale) {
          locale = resolved.params.locale;
        }
        const normalizedLocale = normalizeLocale(locale);
        const page = await loadDatabaseSinglePage(contentType, slug, normalizedLocale, ci.contentRoot, dbm);
        if (!page) return null;
        const dbSingleRaw = ci.loadMergedContent(contentType, slug, normalizedLocale);
        const layout = resolveLayout(contentType, dbSingleRaw.data || (page as unknown as Record<string, unknown>), ci.contentRoot);
        const { layout: _strip, ...pageRest } = page as unknown as Record<string, unknown>;
        return {
          queryKey: ["/api/database-single", contentType, slug, normalizedLocale],
          data: { ...pageRest, layout },
        };
      } catch {
        return null;
      }
    }

    const apiPath = getApiPath(contentType);
    let locale = cleanUrl.match(/^\/(es)\b/) ? "es" : "en";
    if (resolved.params?.locale) {
      locale = resolved.params.locale;
    } else if (!cleanUrl.match(/^\/(en|es)\b/)) {
      const commonData = ci.loadCommonData(contentType, slug);
      if (commonData?.locale && typeof commonData.locale === "string") {
        locale = commonData.locale;
      }
    }

    if (apiPath) {
      const localeOrVariant = locale;

      const result = ci.loadContent({
        contentType,
        slug,
        localeOrVariant,
      });

      if (!result.success) return null;

      const data = result.data as any;
      if (data.sections && Array.isArray(data.sections)) {
        applyComponentSectionDefaults(data.sections);
        data.sections = (await resolveDynamicEntries(
          data.sections,
          locale,
          { db: dbm, contentRoot: ci.contentRoot, contentIndex: ci },
        )) as any;
        applyComponentImageSizes(data.sections);
      }
      const rawContent = ci.loadMergedContent(
        contentType,
        slug,
        locale,
      );
      const layout = resolveLayout(contentType, rawContent.data || {}, ci.contentRoot);
      data.layout = layout;
      data.locale = locale;

      // Match /api/content-pages: attach singleEntry and resolve {{ single.* }} so
      // SSR/hydration (e.g. blog article body) is not left on pipe fallbacks.
      const mapping = getFieldMapping(contentType, ci.contentRoot);
      if (mapping && Object.keys(mapping).length > 0) {
        const singleEntry: Record<string, unknown> = {};
        for (const [key, source] of Object.entries(mapping)) {
          if (typeof source !== "string") continue;
          const value = resolveFieldValue(source, data as Record<string, unknown>);
          if (value !== undefined) singleEntry[key] = value;
        }
        if (Object.keys(singleEntry).length > 0) {
          data.singleEntry = singleEntry;
          const resolved = resolveSingleVars(data, singleEntry) as Record<string, unknown>;
          Object.assign(data, resolved);
        }
      }

      return {
        queryKey: [apiPath, slug, isNonLocalized ? "auto" : locale],
        data,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function resolveMenuQuery(menuId: string, locale: string, contentRoot = getDefaultContentRoot()): SingleQuery | null {
  try {
    const menusDir = path.join(contentRoot, "menus");
    let filePath: string | null = null;

    if (locale && locale !== getDefaultLocale()) {
      const localizedBase = `${menuId}.${locale}`;
      const localizedYml = path.join(menusDir, `${localizedBase}.yml`);
      const localizedYaml = path.join(menusDir, `${localizedBase}.yaml`);
      if (fs.existsSync(localizedYml)) filePath = localizedYml;
      else if (fs.existsSync(localizedYaml)) filePath = localizedYaml;
    }

    if (!filePath) {
      const baseYml = path.join(menusDir, `${menuId}.yml`);
      const baseYaml = path.join(menusDir, `${menuId}.yaml`);
      if (fs.existsSync(baseYml)) filePath = baseYml;
      else if (fs.existsSync(baseYaml)) filePath = baseYaml;
    }

    if (!filePath) return null;

    const content = fs.readFileSync(filePath, "utf-8");
    const data = yaml.load(content);
    const context = { locale };
    const { data: resolved } = getVariableManager(contentRoot).resolveDeep(data, context);

    return {
      queryKey: ["/api/menus", menuId, locale],
      data: { name: menuId, locale, data: resolved },
    };
  } catch {
    return null;
  }
}

const DEFAULT_EAGER_COUNT = 3;

interface ImageRefs {
  ids: Map<string, string | undefined>;
  directUrls: Set<string>;
}

export interface PreloadHint {
  src: string;
  srcset?: string;
  sizes?: string;
  /** When true, emit fetchpriority=high. Only the LCP candidate should set this. */
  highPriority?: boolean;
}

const IMAGE_URL_PATTERN = /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/i;

/** Matches snake_case `image_id` / `*_image_id` and camelCase `imageId` (navbar Logo). */
const IMAGE_ID_KEY_PATTERN = /(?:^|_)image_id$|^imageId$/;

/** Fallback used by LogoItem when menu YAML omits imageId (e.g. localized menus). */
const DEFAULT_NAVBAR_LOGO_ID = "4geeks-devs-logo-1763162063433";

function extractImageRefsFromValue(value: unknown, refs: ImageRefs, parentKey?: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) extractImageRefsFromValue(item, refs, parentKey);
    return;
  }
  const obj = value as Record<string, unknown>;

  if (typeof obj.id === "string") {
    const hasImageContext =
      typeof obj.alt === "string" ||
      typeof obj.preset === "string" ||
      typeof obj.src === "string";
    if (hasImageContext) {
      const preset = typeof obj.preset === "string" ? obj.preset : undefined;
      if (!refs.ids.has(obj.id)) {
        refs.ids.set(obj.id, preset);
      }
    }
  }

  if (typeof obj.image === "object" && obj.image !== null) {
    const img = obj.image as Record<string, unknown>;
    if (typeof img.id === "string" && !refs.ids.has(img.id)) {
      const preset = typeof img.preset === "string" ? img.preset : undefined;
      refs.ids.set(img.id, preset);
    }
  }

  // Navbar Logo items use component: Logo + optional imageId (camelCase).
  // Always include them so the SSR registry subset keeps the brand mark visible.
  if (obj.component === "Logo") {
    const logoId =
      typeof obj.imageId === "string" && obj.imageId.trim()
        ? obj.imageId.trim()
        : DEFAULT_NAVBAR_LOGO_ID;
    if (!refs.ids.has(logoId)) refs.ids.set(logoId, undefined);
  }

  if (typeof obj.src === "string" && obj.src.startsWith("http") && IMAGE_URL_PATTERN.test(obj.src)) {
    refs.directUrls.add(obj.src);
  }

  for (const [key, v] of Object.entries(obj)) {
    if (typeof v === "string" && IMAGE_ID_KEY_PATTERN.test(key)) {
      if (!refs.ids.has(v)) refs.ids.set(v, undefined);
    } else {
      extractImageRefsFromValue(v, refs, key);
    }
  }
}

type PreloadRegistryPayload = {
  presets?: Record<string, { sizes?: string }>;
  images: Record<
    string,
    { src: string; preset?: string[]; srcset?: Array<{ w: number; url: string }> }
  >;
};

export function resolvePreloadHints(
  payload: InitialDataPayload | null,
): PreloadHint[] {
  if (!payload) return [];

  let pageData: Record<string, unknown> | null = null;
  let registryData: PreloadRegistryPayload | null = null;

  const knownPageApiPaths = new Set(
    Object.keys(getAllConfigs()).map((type) => getApiPath(type)),
  );
  knownPageApiPaths.add("/api/database-single");

  for (const q of payload.queries) {
    const key0 = q.queryKey[0];
    if (
      typeof key0 === "string" &&
      (knownPageApiPaths.has(key0) || key0.startsWith("/api/content-pages/"))
    ) {
      pageData = q.data as Record<string, unknown>;
    }
    if (key0 === "/api/image-registry") {
      registryData = q.data as PreloadRegistryPayload;
    }
  }

  if (!pageData || !registryData) return [];

  const sections = pageData.sections as unknown[] | undefined;
  if (!Array.isArray(sections)) return [];

  const settings = pageData.settings as { loading?: { eager_count?: number } } | undefined;
  const eagerCount = settings?.loading?.eager_count ?? DEFAULT_EAGER_COUNT;

  // Prefer images from the first (hero) section as the LCP candidate; collect
  // remaining eager-window images as secondary preloads without high priority.
  const lcpRefs: ImageRefs = { ids: new Map(), directUrls: new Set() };
  const secondaryRefs: ImageRefs = { ids: new Map(), directUrls: new Set() };
  const prioritySections = sections.slice(0, eagerCount);
  if (prioritySections[0]) {
    extractImageRefsFromValue(prioritySections[0], lcpRefs);
  }
  for (const section of prioritySections.slice(1)) {
    extractImageRefsFromValue(section, secondaryRefs);
  }

  const schemaIdToSizes = new Map<string, string>();
  for (const section of prioritySections) {
    if (!section || typeof section !== "object") continue;
    const s = section as Record<string, unknown>;
    const fromSchema = buildImageIdToSchemaSizesMap(s);
    fromSchema.forEach((sz, id) => {
      schemaIdToSizes.set(id, sz);
    });
  }

  const hints: PreloadHint[] = [];
  const seen = new Set<string>();

  const srcToEntry = new Map<
    string,
    { src: string; preset?: string[]; srcset?: Array<{ w: number; url: string }> }
  >();
  for (const entry of Object.values(registryData.images)) {
    if (entry.src) srcToEntry.set(entry.src, entry);
  }

  const pushHint = (
    id: string | null,
    src: string,
    preset: string | undefined,
    highPriority: boolean,
  ) => {
    if (seen.has(src)) return;
    seen.add(src);
    const entry = (id && registryData.images[id]) || srcToEntry.get(src);
    const hint: PreloadHint = { src, highPriority };
    if (entry?.srcset && entry.srcset.length > 0) {
      hint.srcset = entry.srcset
        .map((s: { w: number; url: string }) => `${s.url} ${s.w}w`)
        .join(", ");
      const presetConfig = preset ? registryData.presets?.[preset] : undefined;
      const schemaSizes = id ? schemaIdToSizes.get(id) : undefined;
      const fromImagePresets = firstPresetSizesFromImageEntry(entry, registryData.presets);
      hint.sizes =
        schemaSizes ??
        fromImagePresets ??
        presetConfig?.sizes ??
        DEFAULT_SRCSET_SIZES;
    }
    hints.push(hint);
  };

  // First image from the hero section is the sole high-priority LCP preload.
  let lcpAssigned = false;
  for (const [id, preset] of lcpRefs.ids) {
    const entry = registryData.images[id];
    if (!entry?.src) continue;
    pushHint(id, entry.src, preset, !lcpAssigned);
    lcpAssigned = true;
  }
  for (const url of lcpRefs.directUrls) {
    pushHint(null, url, undefined, !lcpAssigned);
    lcpAssigned = true;
  }

  for (const [id, preset] of secondaryRefs.ids) {
    const entry = registryData.images[id];
    if (entry?.src) pushHint(id, entry.src, preset, false);
  }
  for (const url of secondaryRefs.directUrls) {
    pushHint(null, url, undefined, false);
  }

  return hints;
}

function buildPageImageRegistrySubset(
  fullRegistry: {
    presets?: Record<string, unknown>;
    images: Record<string, unknown>;
    tagDefinitions?: unknown;
  },
  pageData: unknown,
  extraData: unknown[],
): typeof fullRegistry {
  const refs: ImageRefs = { ids: new Map(), directUrls: new Set() };
  extractImageRefsFromValue(pageData, refs);
  for (const extra of extraData) {
    extractImageRefsFromValue(extra, refs);
  }

  const images: Record<string, unknown> = {};
  const srcToId = new Map<string, string>();
  for (const [id, entry] of Object.entries(fullRegistry.images || {})) {
    const src = (entry as { src?: string })?.src;
    if (src) srcToId.set(src, id);
  }

  for (const id of refs.ids.keys()) {
    if (fullRegistry.images[id]) images[id] = fullRegistry.images[id];
  }
  for (const url of refs.directUrls) {
    const id = srcToId.get(url);
    if (id && fullRegistry.images[id]) images[id] = fullRegistry.images[id];
  }

  // Always keep presets — small, and UniversalImage resolves sizes from them.
  return {
    presets: fullRegistry.presets ?? {},
    images: images as typeof fullRegistry.images,
    ...(fullRegistry.tagDefinitions
      ? { tagDefinitions: fullRegistry.tagDefinitions }
      : {}),
  };
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function replaceMetaContent(html: string, attr: string, attrValue: string, replacement: string): string {
  const escaped = escapeAttr(replacement);
  const pattern = new RegExp(`(<meta[^>]*${attr.replace(":", "\\:")}="${attrValue}"[^>]*content=")[^"]*(")`);
  const patternRev = new RegExp(`(<meta[^>]*content=")[^"]*("[^>]*${attr.replace(":", "\\:")}="${attrValue}")`);
  if (pattern.test(html)) return html.replace(pattern, `$1${escaped}$2`);
  if (patternRev.test(html)) return html.replace(patternRev, `$1${escaped}$2`);
  return html;
}

export function injectSsrMetaTags(html: string, payload: InitialDataPayload | null, contentRoot?: string): string {
  if (!payload) return html;

  const lang = payload.locale || "en";
  html = html.replace(/(<html\s[^>]*lang=")[^"]*(")/i, `$1${lang}$2`);

  const knownPageApiPaths = new Set(
    Object.keys(getAllConfigs()).map((type) => getApiPath(type)),
  );
  knownPageApiPaths.add("/api/database-single");

  let pageQuery: SingleQuery | null = null;
  for (const q of payload.queries) {
    const key0 = q.queryKey[0];
    if (typeof key0 === "string" && (knownPageApiPaths.has(key0) || key0.startsWith("/api/content-pages/"))) {
      pageQuery = q;
      break;
    }
  }

  if (!pageQuery?.data) return html;

  const data = pageQuery.data as Record<string, unknown>;
  let meta = data.meta as Record<string, unknown> | undefined;
  if (!meta) return html;

  const singleEntry = data.singleEntry as Record<string, unknown> | undefined;
  if (singleEntry) {
    meta = resolveSingleVars(meta, singleEntry) as Record<string, unknown>;
  }

  if (typeof meta.page_title === "string" && !meta.page_title.includes("{{")) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(meta.page_title)}</title>`);
    html = replaceMetaContent(html, "property", "og:title", meta.page_title);
    html = replaceMetaContent(html, "name", "twitter:title", meta.page_title);
  }

  if (typeof meta.description === "string" && !meta.description.includes("{{")) {
    html = replaceMetaContent(html, "name", "description", meta.description);
    html = replaceMetaContent(html, "property", "og:description", meta.description);
    html = replaceMetaContent(html, "name", "twitter:description", meta.description);
  }

  if (typeof meta.og_image === "string" && !meta.og_image.includes("{{")) {
    const escaped = escapeAttr(meta.og_image);
    if (html.includes('property="og:image"')) {
      html = replaceMetaContent(html, "property", "og:image", meta.og_image);
    } else {
      html = html.replace("</head>", `<meta property="og:image" content="${escaped}" />\n</head>`);
    }
    if (html.includes('name="twitter:image"')) {
      html = replaceMetaContent(html, "name", "twitter:image", meta.og_image);
    } else {
      html = html.replace("</head>", `<meta name="twitter:image" content="${escaped}" />\n</head>`);
    }
  }

  const robotsValue = resolveEffectiveRobots(
    typeof meta.robots === "string" ? meta.robots : undefined,
    contentRoot,
  );
  if (html.includes('name="robots"')) {
    html = replaceMetaContent(html, "name", "robots", robotsValue);
  } else {
    html = html.replace("</head>", `<meta name="robots" content="${escapeAttr(robotsValue)}" />\n</head>`);
  }

  return html;
}

export async function resolveInitialData(
  url: string,
  ci: ContentIndex = contentIndex,
  dbm: DatabaseManager = databaseManager,
  site?: SiteContext,
): Promise<InitialDataPayload | null> {
  const cleanUrl = url.split("?")[0].split("#")[0];
  const isBlogListing =
    cleanUrl === "/en/blog" ||
    cleanUrl === "/en/blog/" ||
    cleanUrl === "/es/blog" ||
    cleanUrl === "/es/blog/";

  const pageQuery = await resolvePageQuery(url, ci, dbm);
  const parsedUrl = ci.parseContentUrl(cleanUrl);

  const variablesQuery: SingleQuery = {
    queryKey: ["/api/variables"],
    data: getVariableManager(ci.contentRoot).getDefinitions(),
  };

  const queries: SingleQuery[] = [];
  if (pageQuery) queries.push(pageQuery);
  queries.push(variablesQuery);

  // Seed main-navbar and main-footer unconditionally so the header and footer
  // are always present in the server-rendered HTML, even when pageQuery is null
  // (e.g. database-backed pages where the DB query failed or returned no result).
  const defaultLocale = cleanUrl.startsWith("/es") ? "es" : "en";
  const defaultNavbarQuery = resolveMenuQuery("main-navbar", defaultLocale, ci.contentRoot);
  if (defaultNavbarQuery) queries.push(defaultNavbarQuery);
  const defaultFooterQuery = resolveMenuQuery("main-footer", defaultLocale, ci.contentRoot);
  if (defaultFooterQuery) queries.push(defaultFooterQuery);

  // If SSR resolved a canonical/base slug but the current URL uses a localized
  // alias slug, hydrate both keys to avoid first-render cache miss on client.
  if (pageQuery && parsedUrl?.slug) {
    const key = pageQuery.queryKey;
    if (Array.isArray(key)) {
      const key0 = key[0];
      if (typeof key0 === "string") {
        if (
          typeof key[1] === "string" &&
          getApiPath(parsedUrl.contentType) === key0 &&
          key[1] !== parsedUrl.slug
        ) {
          const aliasKey = [key0, parsedUrl.slug, key[2]];
          if (!queries.some((q) => q.queryKey.length === aliasKey.length && q.queryKey.every((v, i) => v === aliasKey[i]))) {
            queries.push({ queryKey: aliasKey, data: pageQuery.data });
          }
        }
      }
    }
  }

  if (isBlogListing) {
    const locale = cleanUrl.startsWith("/es") ? "es" : "en";
    const posts = await fetchBlogListingPage(locale, 1, "all", dbm, ci.contentRoot);
    if (posts) {
      queries.push({
        queryKey: ["/api/blog/posts", locale, 1, ""],
        data: posts,
      });
    }
    const blogConfigQuery = resolveBlogConfigQuery(ci.contentRoot);
    if (blogConfigQuery) queries.push(blogConfigQuery);
  }

  let resolvedLocale: string | undefined;

  if (pageQuery) {
    const pageData = pageQuery.data as Record<string, unknown>;
    const layout = pageData?.layout as
      | { menu?: { top?: string | null; bottom?: string | null } }
      | undefined;
    // queryKey shape differs by route:
    //   database-single → ["/api/database-single", contentType, slug, locale]  (locale at index 3)
    //   all others      → [apiPath, slug, locale]                               (locale at index 2)
    const isDatabaseSingle = pageQuery.queryKey[0] === "/api/database-single";
    const localeFromKey = isDatabaseSingle
      ? (pageQuery.queryKey[3] as string | undefined)
      : (pageQuery.queryKey[2] as string | undefined);
    const locale =
      (typeof pageData?.locale === "string" && pageData.locale ? pageData.locale : undefined) ||
      (typeof localeFromKey === "string" && localeFromKey ? localeFromKey : undefined) ||
      defaultLocale;

    resolvedLocale = locale;

    if (layout?.menu?.top) {
      const mq = resolveMenuQuery(layout.menu.top, locale, ci.contentRoot);
      if (mq) queries.push(mq);
    }
    if (layout?.menu?.bottom) {
      const mq = resolveMenuQuery(layout.menu.bottom, locale, ci.contentRoot);
      if (mq) queries.push(mq);
    }
  }

  const contentTypesPayload = buildContentTypesPayload(ci, dbm);
  queries.push({
    queryKey: ["/api/content-types"],
    data: contentTypesPayload,
  });

  const registry = site
    ? getMergedImageRegistry(site)
    : loadImageRegistry(ci.contentRoot);
  if (registry) {
    // Inline only images referenced by this page + menus (not the full ~500KB registry).
    // Editors refetch the full registry via /api/image-registry when edit mode opens.
    const pageData = pageQuery?.data ?? null;
    const menuDatas = queries
      .filter((q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/menus")
      .map((q) => q.data);
    const subset = buildPageImageRegistrySubset(registry as any, pageData, menuDatas);
    queries.push({
      queryKey: ["/api/image-registry"],
      data: subset,
    });
  }

  const navigationManifest = readNavigationEagerManifest(ci.contentRoot);
  if (navigationManifest) {
    queries.push({
      queryKey: ["navigation-eager-manifest"],
      data: navigationManifest,
    });
  }

  return { queries, locale: resolvedLocale };
}

function buildContentTypesPayload(
  ci: ContentIndex = contentIndex,
  dbm: DatabaseManager = databaseManager,
): Record<string, unknown>[] {
  const configs = getAllConfigs(ci.contentRoot);
  const result: Record<string, unknown>[] = [];
  for (const [type, config] of Object.entries(configs)) {
    result.push({
      name: type,
      label: getLabel(type, ci.contentRoot),
      directory: config.directory,
      has_database: !!config.database?.slug,
      database_slug: config.database?.slug || null,
      single_template: !!config.single_template,
      has_field_mapping: !!(
        config.field_mapping &&
        Object.keys(config.field_mapping).filter(
          (k) => !k.startsWith("_"),
        ).length > 0
      ),
      unique_fields: config.unique_fields ?? ["slug"],
      field_mapping_keys: Object.keys(config.field_mapping ?? {}).filter(
        (k) => !k.startsWith("_"),
      ),
      url_pattern: config.url_pattern,
      locale_key: config.field_mapping?._locale || null,
      static_entry_count: ci.findByType(type).length,
      database_entry_count: config.database?.slug
        ? getCachedDatabaseEntryCount(dbm, config.database.slug)
        : null,
      layout: getLayout(type, ci.contentRoot),
    });
  }
  return result;
}

function buildThemeCssOverrides(contentRoot = getDefaultContentRoot()): string {
  try {
    const themePath = path.join(contentRoot, "theme.json");
    if (!fs.existsSync(themePath)) return "";
    const theme = JSON.parse(fs.readFileSync(themePath, "utf-8")) as {
      colors?: { light?: Record<string, string>; dark?: Record<string, string> };
    };
    const colors = theme.colors;
    if (!colors) return "";
    let css = "";
    if (colors.light && Object.keys(colors.light).length > 0) {
      const vars = Object.entries(colors.light)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join("\n");
      css += `:root {\n${vars}\n}\n`;
    }
    if (colors.dark && Object.keys(colors.dark).length > 0) {
      const vars = Object.entries(colors.dark)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join("\n");
      css += `.dark {\n${vars}\n}\n`;
    }
    return css ? `<style id="__theme_overrides__">\n${css}</style>` : "";
  } catch {
    return "";
  }
}

export function initialDataMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.path.startsWith("/api/") || req.path.startsWith("/private/")) {
    return next();
  }

  const ext = req.path.split(".").pop();
  if (
    ext &&
    [
      "js",
      "ts",
      "tsx",
      "css",
      "map",
      "woff2",
      "woff",
      "ttf",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "svg",
      "ico",
      "json",
    ].includes(ext)
  ) {
    return next();
  }

  const ci = ((res.locals as any).site?.contentIndex ?? contentIndex) as ContentIndex;
  const dbm = ((res.locals as any).site?.database ?? databaseManager) as DatabaseManager;
  const site = (res.locals as any).site as SiteContext | undefined;
  // Resolve once per request; SSR catch-all reuses res.locals.initialDataPromise.
  const locals = res.locals as { initialDataPromise?: Promise<InitialDataPayload | null> };
  const payloadPromise =
    locals.initialDataPromise ??
    resolveInitialData(req.originalUrl, ci, dbm, site).catch(() => null);
  locals.initialDataPromise = payloadPromise;

  const originalEnd = res.end;
  res.end = function (this: Response, chunk?: any, ...args: any[]) {
    const contentType = res.getHeader("content-type");
    if (contentType && String(contentType).includes("text/html") && chunk) {
      payloadPromise
        .then((payload) => {
          try {
            const html =
              typeof chunk === "string" ? chunk : chunk.toString("utf-8");
            let injected = html.includes('id="__INITIAL_DATA__"')
              ? html.replace(/<script id="__INITIAL_DATA__" type="application\/json">[\s\S]*?<\/script>/, '')
              : html;

            if (!injected.includes('storage.googleapis.com')) {
              const gcsHints =
                '<link rel="preconnect" href="https://storage.googleapis.com" crossorigin />\n' +
                '<link rel="dns-prefetch" href="https://storage.googleapis.com" />\n';
              injected = injected.replace("</head>", gcsHints + "</head>");
            }

            if (payload) {
              const scriptTag = `<script id="__INITIAL_DATA__" type="application/json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`;
              injected = injected.replace("</body>", scriptTag + "</body>");
              const themeStyle = buildThemeCssOverrides(ci.contentRoot);
              if (themeStyle && !injected.includes('id="__theme_overrides__"')) {
                injected = injected.replace("</head>", themeStyle + "</head>");
              }
            }
            injected = applyEntryModulePreload(injected);

            const newLength = Buffer.byteLength(injected, "utf-8");
            res.setHeader("content-length", newLength);

            originalEnd.call(this, injected, ...args);
          } catch {
            originalEnd.call(this, chunk, ...args);
          }
        })
        .catch(() => {
          originalEnd.call(this, chunk, ...args);
        });
      return this;
    }
    return originalEnd.call(this, chunk, ...args);
  } as any;

  next();
}
