/**
 * Context Manager - Singleton for loading and caching layered context
 * Uses file mtime for cache invalidation
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type {

  BrandContext,
  ContentContext,
  ComponentContext,
  FullContext,
  ICache,
  AdaptOptions,
} from "./types";
import { child } from "../logger";
const log = child({ module: "ai/ContextManager" });


// Simple mtime-based cache implementation
class MtimeCache<T> implements ICache<T> {
  private cache = new Map<string, { value: T; mtime: number }>();

  get(key: string): { value: T; mtime: number } | null {
    return this.cache.get(key) || null;
  }

  set(key: string, value: T, mtime: number): void {
    this.cache.set(key, { value, mtime });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}

// Singleton instance
let instance: ContextManager | null = null;

export class ContextManager {
  private brandCache = new MtimeCache<BrandContext>();
  private contentCache = new MtimeCache<ContentContext>();
  private componentCache = new MtimeCache<ComponentContext>();

  private constructor() {}

  static getInstance(): ContextManager {
    if (!instance) {
      instance = new ContextManager();
    }
    return instance;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.brandCache.invalidateAll();
    this.contentCache.invalidateAll();
    this.componentCache.invalidateAll();
  }

  /**
   * Get file mtime, returns 0 if file doesn't exist
   */
  private getFileMtime(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      return stats.mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * Load brand context from 4geeks-com/brand-context.yml
   */
  async getBrandContext(): Promise<BrandContext> {
    let contentFolder: string;
    try {
      const { getDefaultSite } = require("../site-manager") as typeof import("../site-manager");
      contentFolder = getDefaultSite().contentRootName;
    } catch {
      contentFolder = process.env.CONTENT_FOLDER || "default-site-content";
    }
    const filePath = path.join(process.cwd(), contentFolder, "brand-context.yml");
    const cacheKey = "brand-context";
    const currentMtime = this.getFileMtime(filePath);

    const cached = this.brandCache.get(cacheKey);
    if (cached && cached.mtime === currentMtime) {
      return cached.value;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const brandContext = yaml.load(content) as BrandContext;
      this.brandCache.set(cacheKey, brandContext, currentMtime);
      return brandContext;
    } catch (error) {
      log.error({ err: error }, "Failed to load brand context:");
      throw new Error("Brand context not found or invalid");
    }
  }

  /**
   * Load content context from _common.yml
   */
  async getContentContext(type: string, slug: string): Promise<ContentContext> {
    const filePath = path.join(
      process.cwd(),
      process.env.CONTENT_FOLDER || "default-site-content",
      type,
      slug,
      "_common.yml"
    );
    const cacheKey = `content:${type}:${slug}`;
    const currentMtime = this.getFileMtime(filePath);

    const cached = this.contentCache.get(cacheKey);
    if (cached && cached.mtime === currentMtime) {
      return cached.value;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const commonData = yaml.load(content) as Record<string, unknown>;
      
      const contentContext: ContentContext = {
        slug,
        type,
        title: commonData.title as string | undefined,
        context: commonData.context as ContentContext["context"],
      };
      
      this.contentCache.set(cacheKey, contentContext, currentMtime);
      return contentContext;
    } catch (error) {
      // Return minimal context if _common.yml doesn't exist
      return { slug, type };
    }
  }

  /**
   * Load component context from component registry
   */
  async getComponentContext(name: string, version: string): Promise<ComponentContext> {
    const filePath = path.join(
      process.cwd(),
      process.env.CONTENT_FOLDER || "default-site-content",
      "component-registry",
      name,
      version,
      "schema.yml"
    );
    const cacheKey = `component:${name}:${version}`;
    const currentMtime = this.getFileMtime(filePath);

    const cached = this.componentCache.get(cacheKey);
    if (cached && cached.mtime === currentMtime) {
      return cached.value;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const schema = yaml.load(content) as Record<string, unknown>;
      
      const componentContext: ComponentContext = {
        name,
        version,
        description: schema.description as string | undefined,
        when_to_use: schema.when_to_use as string | undefined || (schema.context as Record<string, unknown>)?.when_to_use as string | undefined,
        variants: schema.variants as ComponentContext["variants"],
        props: schema.props as ComponentContext["props"] || {},
        variant_props: schema.variant_props as ComponentContext["variant_props"],
      };
      
      this.componentCache.set(cacheKey, componentContext, currentMtime);
      return componentContext;
    } catch (error) {
      log.error({ err: error }, `Failed to load component context for ${name}/${version}:`);
      throw new Error(`Component schema not found: ${name}/${version}`);
    }
  }

  /**
   * Build complete adaptation context
   */
  async buildAdaptationContext(options: AdaptOptions): Promise<FullContext> {
    const [brand, content, component] = await Promise.all([
      this.getBrandContext(),
      this.getContentContext(options.contentType, options.contentSlug),
      this.getComponentContext(options.targetComponent, options.targetVersion),
    ]);

    return {
      brand,
      content,
      component,
      targetVariant: options.targetVariant,
      userOverrides: options.userOverrides,
    };
  }
}

// Export singleton getter
export function getContextManager(): ContextManager {
  return ContextManager.getInstance();
}
