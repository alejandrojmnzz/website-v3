import pLimit from "p-limit";
import { processImageBuffer, processImageFromSrc, ImageEncodingError } from "./image-optimizer";
import {
  createQueueContext,
  getPendingExternalImages,
  getPendingOptimizations,
  markExternalImageDone,
  markJobDone,
  markJobFailed,
  type ImageQueueContext,
} from "./image-registry";
import type { Preset } from "./image-optimizer";
import { getSiteContextMap } from "./site-manager";
import { child as loggerChild } from "./logger";

const workerLogger = loggerChild({ module: "ImageQueueWorker", worker: "ImageQueueWorker" });

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

const externalLimit = pLimit(5);
const optimizeLimit = pLimit(3);

let tickRunning = false;

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^0\./,
  /^localhost$/i,
];

function isSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  for (const pattern of PRIVATE_IP_RANGES) {
    if (pattern.test(host)) return false;
  }
  return true;
}

const NON_IMAGE_CONTENT_TYPE_PREFIXES = ["text/", "application/json", "application/xhtml"];

function isNonImageContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return NON_IMAGE_CONTENT_TYPE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

async function fetchWithTimeout(url: string): Promise<Buffer | null> {
  if (!isSafeUrl(url)) {
    workerLogger.warn({ url }, "blocked fetch to disallowed URL");
    return null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type");
    if (isNonImageContentType(contentType)) {
      workerLogger.warn({ url, contentType }, "[ImageQueueWorker] Skipped non-image buffer (content-type check)");
      return null;
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

const IMAGE_MAGIC_BYTES: Array<{ label: string; bytes: number[] }> = [
  { label: "JPEG", bytes: [0xff, 0xd8, 0xff] },
  { label: "PNG", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { label: "GIF", bytes: [0x47, 0x49, 0x46] },
  { label: "WEBP", bytes: [0x52, 0x49, 0x46, 0x46] },
  { label: "AVIF", bytes: [0x00, 0x00, 0x00] },
];

function isImageBuffer(buf: Buffer): boolean {
  for (const { bytes } of IMAGE_MAGIC_BYTES) {
    if (bytes.every((b, i) => buf[i] === b)) return true;
  }
  return false;
}

async function processExternalEntry(
  ctx: ImageQueueContext,
  entry: { id: string; source_url?: string; tags?: string[] },
): Promise<void> {
  const { id, source_url: url } = entry;
  if (!url) return;

  const registry = ctx.gallery.getRegistry();
  if (!registry) return;

  const buffer = await fetchWithTimeout(url);
  if (!buffer) {
    markJobFailed(ctx, id, `Failed to fetch ${url}`);
    return;
  }

  if (!isImageBuffer(buffer)) {
    workerLogger.warn({ id, url }, "[ImageQueueWorker] Skipped non-image buffer (magic-bytes check)");
    markJobFailed(ctx, id, `Non-image buffer received for ${url}`);
    return;
  }

  const presets = registry.presets as Record<string, Preset>;
  const tagDefinitions = registry.tagDefinitions as Record<string, { presets?: string[] }> | undefined;
  const dbName = entry.tags?.[0] ?? "external";

  let result = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
    try {
      result = await processImageBuffer(id, buffer, url, entry.tags ?? [dbName], presets, false, undefined, tagDefinitions);
    } catch (err) {
      if (err instanceof ImageEncodingError) {
        workerLogger.warn({ id, url }, `[ImageQueueWorker] fast-fail: ${(err as Error).message}`);
        markJobFailed(ctx, id, (err as Error).message);
        return;
      }
      throw err;
    }
    if (result) break;
  }

  if (!result) {
    markJobFailed(ctx, id, `processImageBuffer failed for ${url}`);
    return;
  }

  const primaryUrl = result.srcset?.[0]?.url ?? url;
  markExternalImageDone(ctx, id, primaryUrl, {
    alt: `Image from ${dbName}`,
    tags: entry.tags ?? [dbName],
    source_url: url,
    width: result.width,
    height: result.height,
    preset: result.preset,
    widths_generated: result.widths_generated,
    format: result.format,
    srcset: result.srcset,
    usage_count: 0,
  });

  workerLogger.info({ id, url }, "cached external image");
}

async function processOptimizeEntry(
  ctx: ImageQueueContext,
  entry: { id: string; src: string },
): Promise<void> {
  const { id } = entry;
  const registry = ctx.gallery.getRegistry();
  if (!registry) return;

  const entryData = registry.images[id];
  if (!entryData) return;

  const presets = registry.presets as Record<string, Preset>;
  const tagDefinitions = registry.tagDefinitions as Record<string, { presets?: string[] }> | undefined;

  try {
    const result = await processImageFromSrc(id, entryData, presets, false, undefined, tagDefinitions);
    if (result) {
      markJobDone(
        ctx,
        id,
        {
          width: result.width,
          height: result.height,
          preset: result.preset,
          widths_generated: result.widths_generated,
          format: result.format,
          srcset: result.srcset,
        },
        "optimize",
      );
      workerLogger.info({ id }, "optimized image");
    } else {
      markJobFailed(ctx, id, `processImageFromSrc returned null for "${id}"`, "optimize");
    }
  } catch (err) {
    markJobFailed(ctx, id, String(err), "optimize");
    workerLogger.error({ err, id }, "error optimizing image");
  }
}

type PendingJob =
  | { type: "external"; ctx: ImageQueueContext; entry: { id: string } & import("@shared/schema").ImageEntry }
  | { type: "optimize"; ctx: ImageQueueContext; entry: { id: string } & import("@shared/schema").ImageEntry };

async function tick(): Promise<void> {
  if (tickRunning) {
    workerLogger.info("tick skipped — previous tick still running");
    return;
  }

  tickRunning = true;
  try {
    const jobs: PendingJob[] = [];
    const sitesToPersist = new Set<ImageQueueContext["gallery"]>();

    for (const site of Array.from(getSiteContextMap().values())) {
      const ctx = createQueueContext(site.mediaGallery);
      if (!ctx.gallery.getRegistry({ silent: true })) continue;

      for (const entry of getPendingExternalImages(ctx, 20)) {
        jobs.push({ type: "external", ctx, entry });
      }
      for (const entry of getPendingOptimizations(ctx, 10)) {
        jobs.push({ type: "optimize", ctx, entry });
      }
    }

    if (jobs.length === 0) return;

    const externalCount = jobs.filter((j) => j.type === "external").length;
    const optimizeCount = jobs.filter((j) => j.type === "optimize").length;
    workerLogger.info(
      { external: externalCount, optimize: optimizeCount },
      "tick: processing pending jobs",
    );

    await Promise.allSettled(
      jobs.map((job) => {
        sitesToPersist.add(job.ctx.gallery);
        if (job.type === "external") {
          return externalLimit(() => processExternalEntry(job.ctx, job.entry));
        }
        return optimizeLimit(() => processOptimizeEntry(job.ctx, job.entry));
      }),
    );

    for (const gallery of Array.from(sitesToPersist)) {
      gallery.persistRegistry();
    }
  } finally {
    tickRunning = false;
  }
}

export function runNow(): void {
  void tick();
}

export function isImageQueueBusy(): boolean {
  return tickRunning;
}

export function start(): void {
  workerLogger.info("starting background worker (30s interval)");
  setInterval(() => void tick(), 30_000);
  void tick();
}
