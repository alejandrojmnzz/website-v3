import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { MediaGallery } from "./media-gallery";
import type { StorageProvider } from "./media/types";
import type { ContentTypePreviewConfig } from "./content-types";
import { RESERVED_IMAGE_FIELD } from "./content-types";
import { child } from "./logger";

const log = child({ module: "entry-preview-manager" });

/** Reject captures smaller than this (likely blank). */
export const MIN_WEBP_BYTES = 2_000;

export const DEFAULT_PREVIEW_WIDTH = 1200;
export const DEFAULT_PREVIEW_MAX_HEIGHT = 630;

export interface EntryPreviewMeta {
  url: string;
  capturedAt: string;
  dirty: boolean;
  propsHash?: string;
  failedAt?: string;
  error?: string;
  attempts?: number;
  width: number;
  locale: string;
}

export interface EntryPreviewStats {
  fromSource: number;
  generated: number;
  missing: number;
  dirty: number;
  failed: number;
}

export interface UpsertWebpInput {
  contentType: string;
  slug: string;
  locale: string;
  width: number;
  buffer: Buffer;
  propsHash?: string;
}

function sanitizeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

function metaKey(
  contentType: string,
  slug: string,
  locale: string,
  width: number,
): string {
  return [
    sanitizeSegment(contentType),
    sanitizeSegment(slug),
    sanitizeSegment(locale),
    String(width),
  ].join(":");
}

export function hashPreviewProps(
  props: Record<string, string> | undefined,
  entry: Record<string, unknown>,
): string {
  const mapping = props || {};
  const payload: Record<string, unknown> = {};
  for (const [compKey, entryField] of Object.entries(mapping)) {
    if (entryField === RESERVED_IMAGE_FIELD || compKey === RESERVED_IMAGE_FIELD) continue;
    payload[compKey] = entry[entryField];
  }
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

/**
 * Per-site manager for OG / entry list preview screenshots.
 * Bytes + meta live under the site media prefix (not image-registry).
 */
export class EntryPreviewManager {
  private readonly contentRoot: string;
  private readonly contentRootName: string;
  private readonly mediaGallery: MediaGallery;
  private readonly writeLocks = new Map<string, Promise<void>>();
  private listCache: { at: number; contentType: string; metas: EntryPreviewMeta[] } | null = null;
  private readonly listTtlMs = 60_000;

  constructor(contentRoot: string, mediaGallery: MediaGallery) {
    this.contentRoot = contentRoot;
    this.contentRootName = path.relative(process.cwd(), contentRoot) || path.basename(contentRoot);
    this.mediaGallery = mediaGallery;
  }

  private storageKey(
    contentType: string,
    slug: string,
    locale: string,
    width: number,
    ext: "webp" | "meta.json",
  ): string {
    return `entry-previews/${sanitizeSegment(contentType)}/${sanitizeSegment(slug)}/${sanitizeSegment(locale)}/${width}.${ext}`;
  }

  private localDiskPath(relativeKey: string): string {
    return path.join(this.contentRoot, "images", relativeKey);
  }

  private localPublicUrl(relativeKey: string): string {
    return `/${this.contentRootName}/images/${relativeKey}`;
  }

  private provider(): StorageProvider {
    return this.mediaGallery.getDefaultStorageProvider();
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.writeLocks.set(key, prev.then(() => gate));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.writeLocks.get(key) === gate) this.writeLocks.delete(key);
    }
  }

  private invalidateListCache(contentType?: string): void {
    if (!contentType || this.listCache?.contentType === contentType) {
      this.listCache = null;
    }
  }

  async getMeta(
    contentType: string,
    slug: string,
    locale: string,
    width: number = DEFAULT_PREVIEW_WIDTH,
  ): Promise<EntryPreviewMeta | null> {
    const provider = this.provider();
    const key = this.storageKey(contentType, slug, locale, width, "meta.json");

    try {
      if (provider.name === "gcs") {
        const download = (provider as StorageProvider & { download?: (key: string) => Promise<Buffer | null> }).download;
        if (download) {
          const buf = await download.call(provider, key);
          if (!buf) return null;
          const raw = JSON.parse(buf.toString("utf8")) as EntryPreviewMeta;
          return this.normalizeMeta(raw, locale, width);
        }
        if (!(await provider.exists(key))) return null;
        const url = provider.getPublicUrl(key);
        const res = await fetch(url);
        if (!res.ok) return null;
        const raw = (await res.json()) as EntryPreviewMeta;
        return this.normalizeMeta(raw, locale, width);
      }

      const disk = this.localDiskPath(key);
      if (!fs.existsSync(disk)) return null;
      const raw = JSON.parse(fs.readFileSync(disk, "utf8")) as EntryPreviewMeta;
      return this.normalizeMeta(raw, locale, width);
    } catch (err) {
      log.warn({ err, contentType, slug, locale }, "Failed to read entry preview meta");
      return null;
    }
  }

  private normalizeMeta(
    raw: EntryPreviewMeta,
    locale: string,
    width: number,
  ): EntryPreviewMeta | null {
    if (!raw || typeof raw !== "object") return null;
    return {
      url: typeof raw.url === "string" ? raw.url : "",
      capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : "",
      dirty: !!raw.dirty,
      propsHash: typeof raw.propsHash === "string" ? raw.propsHash : undefined,
      failedAt: typeof raw.failedAt === "string" ? raw.failedAt : undefined,
      error: typeof raw.error === "string" ? raw.error : undefined,
      attempts: typeof raw.attempts === "number" ? raw.attempts : undefined,
      width: typeof raw.width === "number" ? raw.width : width,
      locale: typeof raw.locale === "string" ? raw.locale : locale,
    };
  }

  async writeMeta(
    contentType: string,
    slug: string,
    locale: string,
    width: number,
    meta: EntryPreviewMeta,
  ): Promise<void> {
    const key = this.storageKey(contentType, slug, locale, width, "meta.json");
    const lockKey = metaKey(contentType, slug, locale, width);
    await this.withLock(lockKey, async () => {
      const body = Buffer.from(JSON.stringify(meta, null, 2), "utf8");
      const provider = this.provider();
      if (provider.name === "gcs") {
        await provider.upload(key, body, "application/json");
      } else {
        const disk = this.localDiskPath(key);
        fs.mkdirSync(path.dirname(disk), { recursive: true });
        fs.writeFileSync(disk, body);
      }
      this.invalidateListCache(contentType);
    });
  }

  async upsertWebp(input: UpsertWebpInput): Promise<EntryPreviewMeta> {
    const { contentType, slug, locale, width, buffer, propsHash } = input;
    if (buffer.length < MIN_WEBP_BYTES) {
      const failed = await this.markFailed(contentType, slug, locale, width, "capture_too_small");
      throw new Error(failed.error || "capture_too_small");
    }

    const lockKey = metaKey(contentType, slug, locale, width);
    return this.withLock(lockKey, async () => {
      const webpKey = this.storageKey(contentType, slug, locale, width, "webp");
      const provider = this.provider();
      let url: string;
      if (provider.name === "gcs") {
        url = await provider.upload(webpKey, buffer, "image/webp");
      } else {
        const disk = this.localDiskPath(webpKey);
        fs.mkdirSync(path.dirname(disk), { recursive: true });
        fs.writeFileSync(disk, buffer);
        url = this.localPublicUrl(webpKey);
      }

      const capturedAt = new Date().toISOString();
      const meta: EntryPreviewMeta = {
        url,
        capturedAt,
        dirty: false,
        propsHash,
        width,
        locale,
        attempts: 0,
      };
      const metaKeyPath = this.storageKey(contentType, slug, locale, width, "meta.json");
      const metaBody = Buffer.from(JSON.stringify(meta, null, 2), "utf8");
      if (provider.name === "gcs") {
        await provider.upload(metaKeyPath, metaBody, "application/json");
      } else {
        const disk = this.localDiskPath(metaKeyPath);
        fs.writeFileSync(disk, metaBody);
      }
      this.invalidateListCache(contentType);
      return meta;
    });
  }

  async markDirty(
    contentType: string,
    slug: string,
    locale: string,
    width: number = DEFAULT_PREVIEW_WIDTH,
  ): Promise<EntryPreviewMeta> {
    const existing = (await this.getMeta(contentType, slug, locale, width)) || {
      url: "",
      capturedAt: "",
      dirty: true,
      width,
      locale,
    };
    const next: EntryPreviewMeta = { ...existing, dirty: true, width, locale };
    await this.writeMeta(contentType, slug, locale, width, next);
    return next;
  }

  async markFailed(
    contentType: string,
    slug: string,
    locale: string,
    width: number,
    error: string,
  ): Promise<EntryPreviewMeta> {
    const existing = (await this.getMeta(contentType, slug, locale, width)) || {
      url: "",
      capturedAt: "",
      dirty: false,
      width,
      locale,
    };
    const next: EntryPreviewMeta = {
      ...existing,
      dirty: false,
      failedAt: new Date().toISOString(),
      error,
      attempts: (existing.attempts ?? 0) + 1,
      width,
      locale,
    };
    await this.writeMeta(contentType, slug, locale, width, next);
    return next;
  }

  async retryFailed(
    contentType: string,
    slug: string,
    locale: string,
    width: number = DEFAULT_PREVIEW_WIDTH,
  ): Promise<EntryPreviewMeta> {
    const existing = (await this.getMeta(contentType, slug, locale, width)) || {
      url: "",
      capturedAt: "",
      dirty: true,
      width,
      locale,
    };
    const next: EntryPreviewMeta = {
      ...existing,
      dirty: true,
      failedAt: undefined,
      error: undefined,
      width,
      locale,
    };
    await this.writeMeta(contentType, slug, locale, width, next);
    return next;
  }

  needsCapture(
    meta: EntryPreviewMeta | null,
    propsHash: string | undefined,
    dirtyOnPropChange: boolean,
  ): boolean {
    if (meta?.failedAt) return false;
    if (!meta || !meta.url) return true;
    if (meta.dirty) return true;
    if (dirtyOnPropChange && propsHash && meta.propsHash && propsHash !== meta.propsHash) {
      return true;
    }
    return false;
  }

  cacheBustedUrl(meta: EntryPreviewMeta | null | undefined): string | null {
    if (!meta?.url) return null;
    const t = meta.capturedAt ? Date.parse(meta.capturedAt) : NaN;
    const bust = Number.isFinite(t) ? t : Date.now();
    const sep = meta.url.includes("?") ? "&" : "?";
    return `${meta.url}${sep}t=${bust}`;
  }

  private async urlLooksUsable(url: string): Promise<boolean> {
    if (!url || /\{\{/.test(url)) return false;
    if (!(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/"))) {
      return false;
    }
    try {
      if (url.startsWith("/")) {
        const disk = path.join(process.cwd(), url.replace(/^\//, ""));
        if (fs.existsSync(disk)) return true;
        // Relative public path may still be valid remotely; treat as usable without HEAD
        return true;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(url, { method: "HEAD", signal: controller.signal });
        return res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  async resolveEffectiveImage(
    entry: Record<string, unknown>,
    previewConfig: ContentTypePreviewConfig | null | undefined,
    opts?: { contentType: string; width?: number; skipHeadCheck?: boolean },
  ): Promise<{ url: string | null; source: "db" | "generated" | "none" }> {
    const rawImage = entry[RESERVED_IMAGE_FIELD] ?? entry.preview;
    const imageStr = typeof rawImage === "string" ? rawImage.trim() : "";
    if (imageStr) {
      const ok = opts?.skipHeadCheck ? true : await this.urlLooksUsable(imageStr);
      if (ok) return { url: imageStr, source: "db" };
    }

    if (!previewConfig || !opts?.contentType) {
      return { url: null, source: "none" };
    }

    const slug = String(entry.slug ?? "");
    const locale = String(entry.lang ?? entry.locale ?? entry.language ?? "en");
    const width = opts.width ?? previewConfig.widths?.[0] ?? DEFAULT_PREVIEW_WIDTH;
    if (!slug) return { url: null, source: "none" };

    const meta = await this.getMeta(opts.contentType, slug, locale, width);
    const busted = this.cacheBustedUrl(meta);
    if (busted && !meta?.dirty && !meta?.failedAt) {
      return { url: busted, source: "generated" };
    }
    return { url: null, source: "none" };
  }

  async listMetas(contentType: string): Promise<EntryPreviewMeta[]> {
    const now = Date.now();
    if (
      this.listCache &&
      this.listCache.contentType === contentType &&
      now - this.listCache.at < this.listTtlMs
    ) {
      return this.listCache.metas;
    }

    const provider = this.provider();
    const metas: EntryPreviewMeta[] = [];
    const prefix = `entry-previews/${sanitizeSegment(contentType)}/`;

    try {
      if (provider.name === "gcs" && provider.list) {
        const keys = await provider.list(prefix);
        for (const key of keys) {
          if (!key.endsWith(".meta.json")) continue;
          try {
            const download = (provider as StorageProvider & { download?: (k: string) => Promise<Buffer | null> }).download;
            let raw: EntryPreviewMeta | null = null;
            if (download) {
              const buf = await download.call(provider, key);
              if (buf) raw = JSON.parse(buf.toString("utf8")) as EntryPreviewMeta;
            } else {
              const url = provider.getPublicUrl(key);
              const res = await fetch(url);
              if (res.ok) raw = (await res.json()) as EntryPreviewMeta;
            }
            if (!raw) continue;
            const normalized = this.normalizeMeta(raw, raw.locale || "en", raw.width || DEFAULT_PREVIEW_WIDTH);
            if (normalized) metas.push(normalized);
          } catch {
            /* skip */
          }
        }
      } else {
        const root = path.join(this.contentRoot, "images", "entry-previews", sanitizeSegment(contentType));
        if (fs.existsSync(root)) {
          this.walkLocalMetas(root, metas);
        }
      }
    } catch (err) {
      log.warn({ err, contentType }, "Failed to list entry preview metas");
    }

    this.listCache = { at: now, contentType, metas };
    return metas;
  }

  private walkLocalMetas(dir: string, out: EntryPreviewMeta[]): void {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        this.walkLocalMetas(full, out);
      } else if (name.endsWith(".meta.json")) {
        try {
          const raw = JSON.parse(fs.readFileSync(full, "utf8")) as EntryPreviewMeta;
          const normalized = this.normalizeMeta(raw, raw.locale || "en", raw.width || DEFAULT_PREVIEW_WIDTH);
          if (normalized) out.push(normalized);
        } catch {
          /* skip */
        }
      }
    }
  }

  async stats(
    contentType: string,
    entries: Array<Record<string, unknown>>,
    previewConfig: ContentTypePreviewConfig | null,
    localeKey: string | null,
  ): Promise<EntryPreviewStats> {
    const width = previewConfig?.widths?.[0] ?? DEFAULT_PREVIEW_WIDTH;
    const dirtyOnPropChange = !!previewConfig?.dirty_on_prop_change;
    let fromSource = 0;
    let generated = 0;
    let missing = 0;
    let dirty = 0;
    let failed = 0;

    for (const entry of entries) {
      const slug = String(entry.slug ?? "");
      const locale = localeKey
        ? String(entry[localeKey] || "en")
        : String(entry.lang ?? entry.locale ?? entry.language ?? "en");
      const imageStr =
        typeof entry[RESERVED_IMAGE_FIELD] === "string"
          ? (entry[RESERVED_IMAGE_FIELD] as string).trim()
          : typeof entry.preview === "string"
            ? (entry.preview as string).trim()
            : "";

      if (imageStr && !/\{\{/.test(imageStr)) {
        fromSource++;
        continue;
      }

      if (!previewConfig || !slug) {
        missing++;
        continue;
      }

      const meta = await this.getMeta(contentType, slug, locale, width);
      if (meta?.failedAt) {
        failed++;
        continue;
      }
      const propsHash = hashPreviewProps(previewConfig.props, entry);
      if (meta?.dirty || (dirtyOnPropChange && meta?.propsHash && propsHash !== meta.propsHash)) {
        dirty++;
        continue;
      }
      if (meta?.url) {
        generated++;
        continue;
      }
      missing++;
    }

    return { fromSource, generated, missing, dirty, failed };
  }
}

/**
 * Fill reserved `image` / `meta.og_image` from source or generated preview when missing.
 * Mutates `entry` and optional `pageData` in place.
 */
export async function applyEntryPreviewOgImage(
  manager: EntryPreviewManager,
  opts: {
    contentType: string;
    entry: Record<string, unknown>;
    previewConfig: ContentTypePreviewConfig | null | undefined;
    pageData?: Record<string, unknown>;
    skipHeadCheck?: boolean;
  },
): Promise<string | null> {
  const { contentType, entry, previewConfig, pageData, skipHeadCheck } = opts;
  const resolved = await manager.resolveEffectiveImage(entry, previewConfig, {
    contentType,
    skipHeadCheck,
  });
  if (!resolved.url) return null;

  if (!entry[RESERVED_IMAGE_FIELD] || String(entry[RESERVED_IMAGE_FIELD]).trim() === "") {
    entry[RESERVED_IMAGE_FIELD] = resolved.url;
  }

  if (pageData) {
    const meta = (pageData.meta as Record<string, unknown>) || {};
    const existing =
      typeof meta.og_image === "string" ? meta.og_image.trim() : "";
    if (!existing || /\{\{/.test(existing)) {
      meta.og_image = resolved.url;
      pageData.meta = meta;
    }
  }
  return resolved.url;
}
