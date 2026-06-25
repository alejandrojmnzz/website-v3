import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "../../shared/templateVars";
import { deepMerge } from "../utils/deepMerge";
import { getFolder, getType } from "../content-types";
import { addFileModifiedListener, markFileAsModified } from "../sync-state";
import { gcs } from "../gcs";
import { hashUserId } from "./cookie-utils";
import { child } from "../logger";
const log = child({ module: "versioning/VersioningManager" });



const DEFAULT_CONTENT_FOLDER_NAME = process.env.CONTENT_FOLDER || "marketing-content";
const CONTENT_DIR = path.join(process.cwd(), DEFAULT_CONTENT_FOLDER_NAME);
const STATE_FILE = path.join(CONTENT_DIR, ".versioning-state.json");
const GCS_STATE_KEY = "sync/versioning-state.json";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

export interface VersioningVariant {
  slug: string;
  allocation: number;
}

export interface VersioningLocale {
  variants: VersioningVariant[];
}

export interface VersioningFile {
  [locale: string]: VersioningLocale;
}

interface VersioningState {
  counts: Record<string, number>;
  visitors: Record<string, string[]>;
  lastFlushed: number;
}

const visitorSets: Map<string, Set<string>> = new Map();

export class VersioningManager {
  private configCache: Map<string, VersioningFile> = new Map();
  private contentCache: Map<string, unknown> = new Map();
  private state: VersioningState = { counts: {}, visitors: {}, lastFlushed: Date.now() };

  constructor() {
    this.loadState();
    this.loadStateFromBucket();
    this.registerFileModifiedListener();
  }

  /**
   * Parse a relative file path and return variant coordinates if it is a
   * variant content file (e.g. "marketing-content/landings/my-page/test.en.yml").
   * Returns null for regular locale files, shared templates, or internal files.
   */
  private parseVariantFilePath(relativePath: string): {
    contentType: string;
    slug: string;
    variantSlug: string;
    locale: string;
  } | null {
    const parts = relativePath.replace(/\\/g, "/").split("/");
    // Expected structure: {content-folder} / {folder} / {slug} / {file}.yml
    if (parts.length !== 4 || parts[0] !== DEFAULT_CONTENT_FOLDER_NAME) return null;
    if (!parts[3].endsWith(".yml")) return null;

    const base = parts[3].slice(0, -4); // strip .yml
    const lastDot = base.lastIndexOf(".");
    if (lastDot === -1) return null; // "en.yml" — plain locale file, no variant

    const variantSlug = base.slice(0, lastDot);
    const locale = base.slice(lastDot + 1);

    // Exclude shared templates ("single.en.yml") and internal files ("_common.yml")
    if (!variantSlug || variantSlug === "single" || variantSlug.startsWith("_")) return null;
    // Locale codes are short alpha-only strings
    if (!/^[a-z]{2,5}$/.test(locale)) return null;

    const folder = parts[1];
    const slug = parts[2];
    const contentType = getType(folder);

    return { contentType, slug, variantSlug, locale };
  }

  private registerFileModifiedListener(): void {
    addFileModifiedListener((filePath: string) => {
      const parsed = this.parseVariantFilePath(filePath);
      if (parsed) {
        const { contentType, slug, variantSlug, locale } = parsed;
        this.invalidateVariantCache(contentType, slug, variantSlug, locale);
      }
    });
  }

  private loadState(): void {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, "utf-8");
        this.applyLoadedState(JSON.parse(data));
      }
    } catch (error) {
      log.error({ err: error }, "[Versioning] Error loading state:");
    }
  }

  private applyLoadedState(loaded: any): void {
    this.state = {
      counts: loaded.counts || {},
      visitors: loaded.visitors || {},
      lastFlushed: loaded.lastFlushed || Date.now(),
    };

    visitorSets.clear();
    for (const [key, visitorIds] of Object.entries(this.state.visitors)) {
      visitorSets.set(key, new Set(visitorIds as string[]));
    }

    log.info("[Versioning] Loaded state:", Object.keys(this.state.counts).length, "variant keys");
  }

  private async loadStateFromBucket(): Promise<void> {
    if (!IS_PRODUCTION || !gcs.available) {
      if (!IS_PRODUCTION) log.info("[Versioning] Development mode, using local file only");
      return;
    }

    try {
      const exists = await gcs.exists(GCS_STATE_KEY);
      if (!exists) {
        log.info("[Versioning] No state found in bucket, using local file");
        return;
      }

      const data = await gcs.download(GCS_STATE_KEY);
      if (!data) {
        log.info("[Versioning] Empty download from bucket, using local file");
        return;
      }

      const loaded = JSON.parse(data.toString("utf-8"));
      this.applyLoadedState(loaded);
      this.saveStateLocal();
      log.info("[Versioning] Loaded state from GCS bucket");
    } catch (error) {
      log.error({ err: error }, "[Versioning] Error loading from bucket:");
    }
  }

  private saveStateLocal(): void {
    try {
      this.state.lastFlushed = Date.now();
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (error) {
      log.error({ err: error }, "[Versioning] Error saving state locally:");
    }
  }

  private saveStateToBucket(): void {
    if (!IS_PRODUCTION || !gcs.available) return;

    const content = JSON.stringify(this.state, null, 2);
    gcs.debouncedUpload(GCS_STATE_KEY, Buffer.from(content, "utf-8"), "application/json", 30_000);
  }

  private saveState(): void {
    this.saveStateLocal();
    this.saveStateToBucket();
  }

  public async shutdown(): Promise<void> {
    this.saveStateLocal();
    if (IS_PRODUCTION && gcs.available) {
      await gcs.flushPending();
      try {
        const content = JSON.stringify(this.state, null, 2);
        await gcs.upload(GCS_STATE_KEY, Buffer.from(content, "utf-8"), "application/json");
      } catch (error) {
        log.error({ err: error }, "[Versioning] Error saving to bucket on shutdown:");
      }
    }
  }

  private loadVersioningConfig(contentType: string, slug: string): VersioningFile | null {
    const cacheKey = `${contentType}:${slug}`;

    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey)!;
    }

    const configPath = path.join(CONTENT_DIR, getFolder(contentType), slug, "versioning.yml");

    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const { escaped, map } = escapeTemplateVars(content);
      const rawParsed = yaml.load(escaped);
      const parsed = (rawParsed ? unescapeObjectVars(rawParsed, map) : rawParsed) as VersioningFile;
      this.configCache.set(cacheKey, parsed);
      return parsed;
    } catch (error) {
      log.error({ err: error }, `[Versioning] Error loading config for ${contentType}/${slug}:`);
      return null;
    }
  }

  /**
   * Find the actual YAML file for a variant slug + locale.
   * Tries new format first ({slug}.{locale}.yml), then old format ({slug}.v*.{locale}.yml).
   */
  private findVariantFile(contentDir: string, variantSlug: string, locale: string): string | null {
    const newPath = path.join(contentDir, `${variantSlug}.${locale}.yml`);
    if (fs.existsSync(newPath)) {
      return newPath;
    }

    try {
      const files = fs.readdirSync(contentDir);
      const oldPattern = new RegExp(`^${variantSlug}\\.v\\d+\\.${locale}\\.yml$`);
      const match = files.find((f) => oldPattern.test(f));
      if (match) {
        return path.join(contentDir, match);
      }
    } catch {
    }

    return null;
  }

  private loadVariantContent(
    contentType: string,
    slug: string,
    variantSlug: string,
    locale: string
  ): unknown | null {
    const cacheKey = `${contentType}:${slug}:${variantSlug}.${locale}`;

    if (this.contentCache.has(cacheKey)) {
      return this.contentCache.get(cacheKey);
    }

    const contentDir = path.join(CONTENT_DIR, getFolder(contentType), slug);
    const commonPath = path.join(contentDir, "_common.yml");
    const filePath = this.findVariantFile(contentDir, variantSlug, locale);

    if (!filePath) {
      log.warn(`[Versioning] Variant file not found: ${variantSlug}.${locale}.yml (or .v*.${locale}.yml) in ${contentDir}`);
      return null;
    }

    try {
      let commonData: Record<string, unknown> = {};
      if (fs.existsSync(commonPath)) {
        const commonContent = fs.readFileSync(commonPath, "utf-8");
        const { escaped: cEsc, map: cMap } = escapeTemplateVars(commonContent);
        const cParsed = yaml.load(cEsc) as Record<string, unknown>;
        commonData = (cParsed ? unescapeObjectVars(cParsed, cMap) : {}) as Record<string, unknown>;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const { escaped: vEsc, map: vMap } = escapeTemplateVars(content);
      const vParsed = yaml.load(vEsc) as Record<string, unknown>;
      const variantData = (vParsed ? unescapeObjectVars(vParsed, vMap) : {}) as Record<string, unknown>;

      const merged = deepMerge(commonData, variantData);
      this.contentCache.set(cacheKey, merged);
      return merged;
    } catch (error) {
      log.error({ err: error }, `[Versioning] Error loading variant content:`);
      return null;
    }
  }

  private hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private selectVariant(
    variants: VersioningVariant[],
    sessionId: string,
    contentType: string,
    slug: string,
    locale: string
  ): VersioningVariant | null {
    const eligibleVariants = variants.filter((v) => v.allocation > 0);
    if (eligibleVariants.length === 0) return null;

    const hashKey = `${sessionId}:${contentType}:${slug}:${locale}`;
    const hashValue = this.hash(hashKey) % 100;

    let cumulative = 0;
    for (const variant of eligibleVariants) {
      cumulative += variant.allocation;
      if (hashValue < cumulative) {
        return variant;
      }
    }

    return eligibleVariants[0];
  }

  private recordExposure(
    contentType: string,
    slug: string,
    locale: string,
    variantSlug: string,
    userId: string
  ): void {
    const stateKey = `${contentType}/${slug}/${locale}/${variantSlug}`;
    const hashedId = hashUserId(userId);

    if (!visitorSets.has(stateKey)) {
      visitorSets.set(stateKey, new Set());
    }
    const visitorSet = visitorSets.get(stateKey)!;

    if (visitorSet.has(hashedId)) return;

    visitorSet.add(hashedId);

    if (!this.state.counts[stateKey]) {
      this.state.counts[stateKey] = 0;
    }
    if (!this.state.visitors[stateKey]) {
      this.state.visitors[stateKey] = [];
    }

    this.state.visitors[stateKey].push(hashedId);
    this.state.counts[stateKey]++;
    this.saveState();
  }

  /**
   * Get the variant assignment for a session. Returns null if no versioning.yml
   * or if all variants have 0% allocation (fall back to default locale file).
   */
  public getAssignment(
    contentType: string,
    slug: string,
    locale: string,
    sessionId: string,
    existingAssignment?: string
  ): string | null {
    const config = this.loadVersioningConfig(contentType, slug);
    if (!config) return null;

    const localeConfig = config[locale];
    if (!localeConfig?.variants?.length) return null;

    if (existingAssignment) {
      const variant = localeConfig.variants.find((v) => v.slug === existingAssignment);
      if (variant && variant.allocation > 0) {
        this.recordExposure(contentType, slug, locale, existingAssignment, sessionId);
        return existingAssignment;
      }
    }

    const selected = this.selectVariant(localeConfig.variants, sessionId, contentType, slug, locale);
    if (!selected) return null;

    this.recordExposure(contentType, slug, locale, selected.slug, sessionId);
    return selected.slug;
  }

  /**
   * Load variant content. Used when force_variant is set or after assignment.
   */
  public getVariantContent(
    contentType: string,
    slug: string,
    variantSlug: string,
    locale: string
  ): unknown | null {
    return this.loadVariantContent(contentType, slug, variantSlug, locale);
  }

  /**
   * Get versioning config for a content type and slug (for debug panel).
   */
  public getVersioningForContent(
    contentType: string,
    slug: string
  ): VersioningFile | null {
    const configPath = path.join(CONTENT_DIR, getFolder(contentType), slug, "versioning.yml");
    if (!fs.existsSync(configPath)) return null;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const { escaped, map } = escapeTemplateVars(content);
      const rawParsed = yaml.load(escaped);
      return (rawParsed ? unescapeObjectVars(rawParsed, map) : rawParsed) as VersioningFile;
    } catch (error) {
      log.error({ err: error }, `[Versioning] Error loading config for ${contentType}/${slug}:`);
      return null;
    }
  }

  public getVersioningFilePath(contentType: string, slug: string): string {
    return path.join(CONTENT_DIR, getFolder(contentType), slug, "versioning.yml");
  }

  /**
   * Get variant counts for diagnostics.
   */
  public getStats(): Record<string, number> {
    return { ...this.state.counts };
  }

  /**
   * Save updated versioning.yml for a content type and slug.
   */
  public updateVersioning(
    contentType: string,
    slug: string,
    data: VersioningFile
  ): void {
    const configPath = this.getVersioningFilePath(contentType, slug);
    const yamlContent = yaml.dump(data, {
      indent: 2,
      lineWidth: 120,
      quotingType: '"',
      forceQuotes: false,
    });
    fs.writeFileSync(configPath, yamlContent, "utf-8");
    const cacheKey = `${contentType}:${slug}`;
    this.configCache.delete(cacheKey);
    this.contentCache.clear();
    markFileAsModified(configPath, "system");
    log.info(`[Versioning] Updated versioning.yml for ${contentType}/${slug} — queued for auto-commit (${configPath})`);
  }

  /**
   * Invalidate the content cache for a specific variant after an external write.
   * Call this whenever a variant file is saved to disk outside VersioningManager.
   */
  public invalidateVariantCache(contentType: string, slug: string, variantSlug: string, locale: string): void {
    const cacheKey = `${contentType}:${slug}:${variantSlug}.${locale}`;
    this.contentCache.delete(cacheKey);
    log.info(`[Versioning] Cache invalidated for ${cacheKey}`);
  }

  /**
   * Clear caches (for hot reload in dev).
   */
  public clearCache(): void {
    this.configCache.clear();
    this.contentCache.clear();
    log.info("[Versioning] Cache cleared");
  }

  /**
   * Get available variants for a content type and slug.
   * Parses YAML files following naming conventions.
   */
  public getAvailableVariants(
    contentType: string,
    slug: string
  ): {
    variants: Array<{
      filename: string;
      name: string;
      variantSlug: string;
      version: number | null;
      locale: string;
      displayName: string;
      isPromoted: boolean;
    }>;
    contentType: string;
    slug: string;
    folderPath: string;
  } | null {
    const contentDir = path.join(CONTENT_DIR, getFolder(contentType), slug);

    if (!fs.existsSync(contentDir)) {
      return null;
    }

    try {
      const files = fs.readdirSync(contentDir);

      const variants = files
        .filter(
          (file) =>
            file.endsWith(".yml") &&
            file !== "versioning.yml" &&
            !file.startsWith("_")
        )
        .map((file) => {
          const name = file.replace(".yml", "");
          const parts = name.split(".");

          if (parts.length === 1) {
            return {
              filename: file,
              name,
              variantSlug: "promoted",
              version: null,
              locale: parts[0],
              displayName: `Promoted (${parts[0].toUpperCase()})`,
              isPromoted: true,
            };
          }

          const locale = parts[parts.length - 1];
          const versionMatch = parts[parts.length - 2]?.match(/^v(\d+)$/);

          if (versionMatch) {
            const version = parseInt(versionMatch[1], 10);
            const variantSlug = parts.slice(0, -2).join(".");
            return {
              filename: file,
              name,
              variantSlug,
              version,
              locale,
              displayName: `${variantSlug} (${locale.toUpperCase()})`,
              isPromoted: false,
            };
          }

          const variantSlug = parts.slice(0, -1).join(".");
          return {
            filename: file,
            name,
            variantSlug,
            version: null,
            locale,
            displayName: `${variantSlug} (${locale.toUpperCase()})`,
            isPromoted: false,
          };
        })
        .sort((a, b) => {
          if (a.isPromoted !== b.isPromoted) return a.isPromoted ? -1 : 1;
          if (a.variantSlug !== b.variantSlug) return a.variantSlug.localeCompare(b.variantSlug);
          if (a.version !== b.version) return (a.version || 0) - (b.version || 0);
          return a.locale.localeCompare(b.locale);
        });

      return {
        variants,
        contentType,
        slug,
        folderPath: `marketing-content/${getFolder(contentType)}/${slug}`,
      };
    } catch (error) {
      log.error({ err: error }, `[Versioning] Error getting variants for ${contentType}/${slug}:`);
      return null;
    }
  }

  /**
   * Get version counts per locale for a content entry.
   * Used by ContentTypeManagePage to show "EN · 3" badges.
   */
  public getVersionCounts(contentType: string, slug: string): Record<string, number> {
    const config = this.getVersioningForContent(contentType, slug);
    if (!config) return {};

    const result: Record<string, number> = {};
    for (const [locale, localeData] of Object.entries(config)) {
      if (localeData?.variants?.length > 1) {
        result[locale] = localeData.variants.length;
      }
    }
    return result;
  }
}

let instance: VersioningManager | null = null;

export function getVersioningManager(): VersioningManager {
  if (!instance) {
    instance = new VersioningManager();
  }
  return instance;
}
