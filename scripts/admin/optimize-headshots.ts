/**
 * Admin script: optimize-headshots
 *
 * Generates WebP srcset variants for the 4 profile headshot images that were
 * moved from attached_assets/ to 4geeks-com/images/.
 *
 * Usage:
 *   npx tsx scripts/admin/optimize-headshots.ts [--dry-run]
 */

import { fileURLToPath } from "url";
import { gcs } from "../../server/gcs";
import { mediaGallery } from "../../server/media-gallery";
import { processImageFromSrc } from "../../server/image-optimizer";
import type { Preset } from "../../server/image-optimizer";

const HEADSHOT_IDS = [
  "woman-profile-headshot-1-608aff01",
  "man-profile-headshot-1-0850c276",
  "woman-profile-headshot-2-a0ea2c29",
  "man-profile-headshot-2-516b72e4",
];

export async function optimizeHeadshots(dryRun = false): Promise<void> {
  gcs.initFromEnv();

  if (!gcs.available) {
    console.error("[optimize-headshots] GCS is not available — GCS_BUCKET_NAME must be set");
    process.exit(1);
  }

  const registry = mediaGallery.getRegistry();
  if (!registry) {
    console.error("[optimize-headshots] Failed to load image registry");
    process.exit(1);
  }

  const presets = registry.presets as Record<string, Preset>;

  let processed = 0;
  let failed = 0;

  for (const id of HEADSHOT_IDS) {
    const entry = registry.images[id];
    if (!entry) {
      console.warn(`[optimize-headshots] ID not found in registry: ${id}`);
      failed++;
      continue;
    }

    console.log(`[optimize-headshots] Processing ${id} (src: ${entry.src})${dryRun ? " [DRY RUN]" : ""}`);

    try {
      const result = await processImageFromSrc(id, entry, presets, dryRun);
      if (result) {
        if (!dryRun) {
          entry.width = result.width;
          entry.height = result.height;
          entry.preset = result.preset;
          entry.widths_generated = result.widths_generated;
          entry.format = result.format;
          entry.srcset = result.srcset;
        }
        console.log(`  width=${result.width} height=${result.height} widths_generated=[${result.widths_generated.join(",")}]`);
        for (const s of result.srcset) {
          console.log(`  ${s.w}w -> ${s.url}`);
        }
        processed++;
      } else {
        console.error(`  [FAILED] processImageFromSrc returned null`);
        failed++;
      }
    } catch (err) {
      console.error(`  [ERROR] ${(err as Error).message}`);
      failed++;
    }
  }

  if (!dryRun && processed > 0) {
    mediaGallery.persistRegistry();
    console.log(`\n[optimize-headshots] Registry saved.`);
  }

  console.log(`\n[optimize-headshots] Done: ${processed} processed, ${failed} failed`);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const dryRun = process.argv.includes("--dry-run");
  optimizeHeadshots(dryRun).catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
