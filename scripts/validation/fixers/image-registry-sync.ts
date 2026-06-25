/**
 * Fixer: image-registry-sync
 *
 * Scans attached_assets/ and 4geeks-com/images/ for images that are new
 * or have changed extensions, then applies those changes to the registry.
 * Equivalent to POST /api/image-registry/apply.
 */

import type { Fixer, FixerContext, FixerResult } from "./types";
import { mediaGallery } from "../../../server/media-gallery";

export const imageRegistrySyncFixer: Fixer = {
  name: "image-registry-sync",
  description: "Scans for new/updated images and syncs them into the image registry",

  async run(_ctx: FixerContext): Promise<FixerResult> {
    let scanResult;
    try {
      scanResult = await mediaGallery.scan();
    } catch (err) {
      return { ok: false, message: `Scan failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (scanResult.newImages.length === 0 && scanResult.updatedImages.length === 0) {
      return {
        ok: true,
        message: "Registry is already in sync — no new or updated images found",
        details: {
          registeredCount: scanResult.registeredCount,
          brokenReferences: scanResult.brokenReferences.length,
        },
      };
    }

    let applied;
    try {
      applied = mediaGallery.applyChanges(scanResult);
    } catch (err) {
      return { ok: false, message: `Apply failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    return {
      ok: true,
      message: `Synced registry: ${applied.added} added, ${applied.updated} updated`,
      details: {
        added: applied.added,
        updated: applied.updated,
        yamlFilesUpdated: applied.yamlFilesUpdated.length,
        brokenReferences: scanResult.brokenReferences.length,
      },
    };
  },
};
