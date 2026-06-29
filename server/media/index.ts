import type { StorageProvider, MediaConfig, ProviderName } from "./types";
import { LocalProvider } from "./local-provider";
import { GCSProvider } from "./gcs-provider";
import { gcs } from "../gcs";
import { child } from "../logger";
const log = child({ module: "media/index" });



export type { StorageProvider, MediaConfig, ProviderName };
export { LocalProvider } from "./local-provider";
export { GCSProvider } from "./gcs-provider";

/**
 * Create a site-scoped GCSProvider for the given content folder.
 * The basePath is `${contentFolderName}/${GCS_BASE_PATH || "media"}`,
 * so all uploads, exists-checks, and deletes are scoped to that prefix.
 * Returns null when GCS is not available.
 */
export function createSiteGCSProvider(contentFolderName: string): GCSProvider | null {
  if (!gcs.available) return null;
  const mediaSegment = process.env.GCS_BASE_PATH || "media";
  const basePath = `${contentFolderName}/${mediaSegment}`;
  log.info(`[Media] createSiteGCSProvider: basePath=${basePath}`);
  return new GCSProvider({ basePath });
}

class Media {
  private providers: Map<string, StorageProvider> = new Map();
  private defaultProviderName: ProviderName = "local";
  private initialized = false;

  init(config?: Partial<MediaConfig>): void {
    this.providers.clear();

    const local = new LocalProvider();
    this.providers.set("local", local);

    if (gcs.available) {
      // The global GCS provider is intentionally bare (no basePath/prefix).
      // Site-scoped uploads and deletes go through per-site GCSProvider instances
      // created via createSiteGCSProvider(), owned by MediaGallery.
      // This bare provider handles operations that don't go through MediaGallery
      // and is used by resolveProvider() for backward-compat URL resolution.
      const gcsProvider = new GCSProvider({ basePath: "" });
      this.providers.set("gcs", gcsProvider);
      log.info(`[Media] GCS provider configured for bucket: ${gcs.getBucketName()} (bare, no basePath prefix)`);
    }

    this.defaultProviderName = config?.defaultProvider || "local";
    this.initialized = true;
    log.info(`[Media] Initialized with default provider: ${this.defaultProviderName}, ${this.providers.size} provider(s) active`);
  }

  initFromEnv(): void {
    gcs.initFromEnv();

    const config: Partial<MediaConfig> = {
      defaultProvider: (process.env.MEDIA_DEFAULT_PROVIDER as ProviderName) || "local",
    };

    if (gcs.available) {
      config.gcs = {
        bucketName: gcs.getBucketName(),
      };
    }

    this.init(config);
  }

  private ensureInit(): void {
    if (!this.initialized) {
      this.initFromEnv();
    }
  }

  getProvider(name: ProviderName): StorageProvider | undefined {
    this.ensureInit();
    return this.providers.get(name);
  }

  getDefaultProvider(): StorageProvider {
    this.ensureInit();
    const provider = this.providers.get(this.defaultProviderName);
    if (!provider) {
      return this.providers.get("local")!;
    }
    return provider;
  }

  resolveProvider(src: string): StorageProvider {
    this.ensureInit();
    for (const provider of Array.from(this.providers.values())) {
      if (provider.owns(src)) {
        return provider;
      }
    }
    return this.providers.get("local")!;
  }

  async exists(src: string): Promise<boolean> {
    const provider = this.resolveProvider(src);
    const key = provider.extractKey(src);
    if (key === null) return false;
    return provider.exists(key);
  }

  async upload(data: Buffer, key: string, contentType?: string, providerName?: ProviderName): Promise<string> {
    this.ensureInit();
    const provider = providerName
      ? this.providers.get(providerName) || this.getDefaultProvider()
      : this.getDefaultProvider();
    return provider.upload(key, data, contentType);
  }

  async delete(src: string): Promise<void> {
    const provider = this.resolveProvider(src);
    const key = provider.extractKey(src);
    if (key === null) return;
    return provider.delete(key);
  }

  getProviderName(src: string): string {
    return this.resolveProvider(src).name;
  }

  getAllProviderNames(): string[] {
    this.ensureInit();
    return Array.from(this.providers.keys());
  }

  getStatus(): {
    defaultProvider: string;
    providers: string[];
    gcs?: { bucket: string; basePath: string; projectId?: string };
  } {
    this.ensureInit();
    const status: ReturnType<Media["getStatus"]> = {
      defaultProvider: this.defaultProviderName,
      providers: this.getAllProviderNames(),
    };
    if (this.providers.has("gcs")) {
      status.gcs = {
        bucket: gcs.getBucketName(),
        basePath: "(bare — site prefix set per-gallery)",
        projectId: process.env.GCS_PROJECT_ID,
      };
    }
    return status;
  }
}

export const media = new Media();
