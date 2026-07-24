import * as fs from "fs";
import * as path from "path";
import { child } from "./logger";

const log = child({ module: "component-screenshots" });

const CACHE_DIR = path.join(process.cwd(), ".cache", "component-screenshots");

export interface ScreenshotMeta {
  version: string;
  example: string;
  sourceMtime: number;
  sourceSize: number;
  capturedAt: string;
}

export interface ScreenshotIndexEntry {
  url: string;
  stale: boolean;
  meta: ScreenshotMeta | null;
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Sanitize example name for filesystem keys (keeps letters, digits, _ -). */
export function safeExampleKey(example: string): string {
  return example.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "example";
}

/**
 * Primary gallery shots use `{type}.webp`.
 * Lazy per-example shots use `{type}--{safeExample}.webp` when `example` is set.
 */
function cacheBase(componentType: string, example?: string | null): string {
  if (!example) return componentType;
  return `${componentType}--${safeExampleKey(example)}`;
}

function imagePath(componentType: string, example?: string | null): string {
  return path.join(CACHE_DIR, `${cacheBase(componentType, example)}.webp`);
}

function metaPath(componentType: string, example?: string | null): string {
  return path.join(CACHE_DIR, `${cacheBase(componentType, example)}.meta.json`);
}

export function readScreenshotMeta(
  componentType: string,
  example?: string | null,
): ScreenshotMeta | null {
  try {
    const p = metaPath(componentType, example);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as ScreenshotMeta;
    if (
      typeof raw.version !== "string" ||
      typeof raw.example !== "string" ||
      typeof raw.sourceMtime !== "number" ||
      typeof raw.sourceSize !== "number"
    ) {
      return null;
    }
    return raw;
  } catch (error) {
    log.warn({ err: error, componentType, example }, "Failed to read screenshot meta");
    return null;
  }
}

export function hasScreenshotImage(
  componentType: string,
  example?: string | null,
): boolean {
  return fs.existsSync(imagePath(componentType, example));
}

export function isScreenshotStale(
  componentType: string,
  sourceMtime: number | undefined,
  sourceSize: number | undefined,
  example?: string | null,
): boolean {
  if (!hasScreenshotImage(componentType, example)) return true;
  const meta = readScreenshotMeta(componentType, example);
  if (!meta) return true;
  if (sourceMtime === undefined || sourceSize === undefined) return false;
  return meta.sourceMtime !== sourceMtime || meta.sourceSize !== sourceSize;
}

function screenshotUrl(
  componentType: string,
  cacheBust: number,
  example?: string | null,
): string {
  const params = new URLSearchParams({ t: String(cacheBust) });
  if (example) params.set("example", example);
  return `/api/private/component-screenshots/${encodeURIComponent(componentType)}?${params}`;
}

export function getScreenshotIndex(
  components: Array<{
    type: string;
    primaryExample?: { sourceMtime: number; sourceSize: number };
  }>,
): Record<string, ScreenshotIndexEntry> {
  const out: Record<string, ScreenshotIndexEntry> = {};
  for (const comp of components) {
    const meta = readScreenshotMeta(comp.type);
    const hasImage = hasScreenshotImage(comp.type);
    const stale = isScreenshotStale(
      comp.type,
      comp.primaryExample?.sourceMtime,
      comp.primaryExample?.sourceSize,
    );
    const cacheBust = meta?.capturedAt
      ? Date.parse(meta.capturedAt) || meta.sourceMtime
      : meta?.sourceMtime ?? 0;
    out[comp.type] = {
      url: hasImage ? screenshotUrl(comp.type, cacheBust) : "",
      stale: !hasImage || stale,
      meta: hasImage ? meta : null,
    };
  }
  return out;
}

/** Index entry for a single lazy example shot (picker). */
export function getExampleScreenshotEntry(
  componentType: string,
  example: string,
  sourceMtime?: number,
  sourceSize?: number,
): ScreenshotIndexEntry {
  const meta = readScreenshotMeta(componentType, example);
  const hasImage = hasScreenshotImage(componentType, example);
  const stale = isScreenshotStale(componentType, sourceMtime, sourceSize, example);
  const cacheBust = meta?.capturedAt
    ? Date.parse(meta.capturedAt) || meta.sourceMtime
    : meta?.sourceMtime ?? 0;
  return {
    url: hasImage ? screenshotUrl(componentType, cacheBust, example) : "",
    stale: !hasImage || stale,
    meta: hasImage ? meta : null,
  };
}

export function readScreenshotImage(
  componentType: string,
  example?: string | null,
): Buffer | null {
  const p = imagePath(componentType, example);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p);
  } catch (error) {
    log.error({ err: error, componentType, example }, "Failed to read screenshot image");
    return null;
  }
}

export function saveScreenshot(
  componentType: string,
  image: Buffer,
  meta: Omit<ScreenshotMeta, "capturedAt"> & { capturedAt?: string },
  options?: { exampleKeyed?: boolean },
): { success: boolean; error?: string } {
  try {
    if (!/^[a-z0-9_]+$/i.test(componentType)) {
      return { success: false, error: "Invalid component type" };
    }
    ensureCacheDir();
    const exampleKey = options?.exampleKeyed ? meta.example : null;
    if (options?.exampleKeyed && !meta.example) {
      return { success: false, error: "example required for keyed screenshot" };
    }
    const fullMeta: ScreenshotMeta = {
      version: meta.version,
      example: meta.example,
      sourceMtime: meta.sourceMtime,
      sourceSize: meta.sourceSize,
      capturedAt: meta.capturedAt || new Date().toISOString(),
    };
    fs.writeFileSync(imagePath(componentType, exampleKey), image);
    fs.writeFileSync(metaPath(componentType, exampleKey), JSON.stringify(fullMeta, null, 2));
    return { success: true };
  } catch (error) {
    log.error({ err: error, componentType }, "Failed to save screenshot");
    return { success: false, error: String(error) };
  }
}

export function deleteScreenshot(
  componentType: string,
  example?: string | null,
): { success: boolean; error?: string } {
  try {
    const img = imagePath(componentType, example);
    const meta = metaPath(componentType, example);
    if (fs.existsSync(img)) fs.unlinkSync(img);
    if (fs.existsSync(meta)) fs.unlinkSync(meta);
    return { success: true };
  } catch (error) {
    log.error({ err: error, componentType, example }, "Failed to delete screenshot");
    return { success: false, error: String(error) };
  }
}
