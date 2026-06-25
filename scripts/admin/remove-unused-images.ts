import * as path from "path";
import { fileURLToPath } from "url";
import { mediaGallery } from "../../server/media-gallery";
import { media } from "../../server/media";
import {
  buildRegistrySrcToIdMap,
  resolveRegistryReference,
} from "../validation/shared/imageRegistrySrc";

const MARKETING_CONTENT_DIR = path.join(process.cwd(), "4geeks-com");
const REGISTRY_PATH = path.join(MARKETING_CONTENT_DIR, "image-registry.json");

export async function removeUnusedImages(options: {
  dryRun?: boolean;
  onProgress?: (event: { type: "start"; total: number } | { type: "item"; id: string; status: "ok" | "skipped" | "failed"; message: string }) => void;
} = {}): Promise<{
  message: string;
  removedCount: number;
  skippedCount: number;
  cleanupErrorCount: number;
  externalSkippedCount: number;
  results: Array<{ id: string; src: string; status: string; reason?: string }>;
}> {
  const { dryRun = false, onProgress } = options;
  const registry = mediaGallery.getRegistry();
  if (!registry) {
    return {
      message: "Failed to load registry",
      removedCount: 0,
      skippedCount: 0,
      cleanupErrorCount: 0,
      externalSkippedCount: 0,
      results: [],
    };
  }

  const { imageIds } = mediaGallery.collectImageReferences();
  const srcToId = buildRegistrySrcToIdMap(registry.images);
  const resolvedReferencedIds = new Set<string>();
  imageIds.forEach((ref) => {
    const resolved = resolveRegistryReference(ref, registry.images, srcToId);
    if (resolved !== null) resolvedReferencedIds.add(resolved);
  });

  const allImageIds = Object.keys(registry.images);
  const candidates: Array<{ id: string; src: string }> = [];
  let ignoredExternalCount = 0;
  for (const [id, entry] of Object.entries(registry.images)) {
    if (entry.source_url || entry.source_item) {
      ignoredExternalCount++;
      continue;
    }
    if (entry.protected) {
      continue;
    }
    const srcsetUrls = Array.isArray(entry.srcset) ? entry.srcset.map((s) => s.url) : [];
    const usage = mediaGallery.getUsage(id, entry.src, srcsetUrls);
    const isUsed = usage.length > 0 || resolvedReferencedIds.has(id);
    if (!isUsed) {
      candidates.push({ id, src: entry.src });
    }
  }

  onProgress?.({ type: "start", total: candidates.length });
  const results: Array<{ id: string; src: string; status: string; reason?: string }> = [];
  let removedCount = 0;
  let skippedCount = 0;
  let cleanupErrorCount = 0;
  const externalSkippedCount = ignoredExternalCount;

  for (const candidate of candidates) {
    const { id, src } = candidate;

    if (dryRun) {
      results.push({ id, src, status: "would-remove" });
      removedCount++;
      onProgress?.({ type: "item", id, status: "ok", message: "would-remove" });
      continue;
    }

    try {
      const result = await mediaGallery.unregister(id);
      if (result.success) {
        if (result.cleanupErrors && result.cleanupErrors.length > 0) {
          results.push({
            id,
            src,
            status: "removed-with-cleanup-errors",
            reason: result.cleanupErrors.join("; "),
          });
          cleanupErrorCount++;
          onProgress?.({
            type: "item",
            id,
            status: "failed",
            message: `removed-with-cleanup-errors: ${result.cleanupErrors.join("; ")}`,
          });
        } else {
          results.push({ id, src, status: "removed" });
          onProgress?.({ type: "item", id, status: "ok", message: "removed" });
        }
        removedCount++;
      } else {
        const message = `skipped: ${result.error || "unknown"}`;
        results.push({ id, src, status: message });
        skippedCount++;
        onProgress?.({ type: "item", id, status: "skipped", message });
      }
    } catch (err: any) {
      const message = `error: ${err.message || "unknown"}`;
      results.push({ id, src, status: message });
      skippedCount++;
      onProgress?.({ type: "item", id, status: "failed", message });
    }
  }

  const message = dryRun
    ? `Dry run: ${removedCount} unused image(s) would be removed out of ${allImageIds.length} total`
    : `Removed ${removedCount} unused image(s), skipped ${skippedCount}, cleanup warnings ${cleanupErrorCount} (${externalSkippedCount} external-source ignored, ${allImageIds.length} total in registry)`;

  return { message, removedCount, skippedCount, cleanupErrorCount, externalSkippedCount, results };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  media.initFromEnv();

  console.log(`Remove unused images${dryRun ? " (DRY RUN)" : ""}`);
  console.log("");

  removeUnusedImages({ dryRun }).then(result => {
    for (const r of result.results) {
      const tag = r.status.startsWith("removed") || r.status.startsWith("would-remove") ? "OK" : "SKIP";
      console.log(`  [${tag}] ${r.id}: ${r.src} — ${r.status}`);
    }
    console.log("");
    console.log(result.message);
  }).catch(err => {
    console.error("Failed:", err);
    process.exit(1);
  });
}
