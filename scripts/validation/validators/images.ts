import * as fs from "fs";
import * as path from "path";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import {
  isNonLocalFilesystemSrc,
  buildRegistrySrcToIdMap,
  resolveRegistryReference,
} from "../shared/imageRegistrySrc";
import { mediaGallery } from "../../../server/media-gallery";

const REGISTRY_PATH = path.join(process.cwd(), "4geeks-com", "image-registry.json");

interface ImageRegistryEntry {
  src: string;
  alt: string;
  focal_point?: string;
  tags?: string[];
  usage_count?: number;
  protected?: boolean;
  source_url?: string;
  source_item?: string;
  srcset?: Array<{ url: string; w: number }>;
}

interface ImageRegistry {
  presets: Record<string, unknown>;
  images: Record<string, ImageRegistryEntry>;
}

export const imagesValidator: Validator = {
  name: "images",
  description: "Validates image integrity: registry references, file existence, alt text, and orphaned entries",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "content",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let registry: ImageRegistry;
    try {
      const rawContent = fs.readFileSync(REGISTRY_PATH, "utf-8");
      registry = JSON.parse(rawContent) as ImageRegistry;
    } catch (err) {
      errors.push({
        type: "error",
        code: "REGISTRY_LOAD_ERROR",
        message: `Failed to load image registry: ${err instanceof Error ? err.message : String(err)}`,
        file: REGISTRY_PATH,
        suggestion: "Ensure 4geeks-com/image-registry.json exists and is valid JSON",
      });

      return {
        name: this.name,
        description: this.description,
        status: "failed",
        errors,
        warnings,
        duration: Date.now() - startTime,
      };
    }

    const images = registry.images || {};
    const { imageIds: referencedIds, imageIdLocations } = mediaGallery.collectImageReferences();
    const srcToId = buildRegistrySrcToIdMap(images);

    let missingFromRegistry = 0;
    referencedIds.forEach((ref) => {
      if (resolveRegistryReference(ref, images, srcToId) !== null) {
        return;
      }
      missingFromRegistry++;
      const locations = imageIdLocations.get(ref) ?? [];
      if (locations.length > 0) {
        for (const loc of locations) {
          const editUrl = `/private/preview/${loc.contentType}/${loc.slug}?locale=${loc.locale}&edit=1#${loc.sectionType}-${loc.sectionIndex}`;
          errors.push({
            type: "error",
            code: "IMAGE_REFERENCE_NOT_IN_REGISTRY",
            message: `Referenced image "${ref}" not found in image registry (no matching id or src) — used in ${loc.yamlFile} (${loc.sectionType} section, index ${loc.sectionIndex})`,
            file: loc.yamlFile,
            suggestion: editUrl,
            fix: {
              type: "manual",
              label: "Go to section",
              url: editUrl,
            },
          });
        }
      } else {
        errors.push({
          type: "error",
          code: "IMAGE_REFERENCE_NOT_IN_REGISTRY",
          message: `Referenced image "${ref}" not found in image registry (no matching id or src)`,
          suggestion: "Add this image to 4geeks-com/image-registry.json or fix the reference",
          fix: {
            type: "manual",
            label: "Fix manually",
          },
        });
      }
    });

    const resolvedReferencedIds = new Set<string>();
    referencedIds.forEach((ref) => {
      const resolved = resolveRegistryReference(ref, images, srcToId);
      if (resolved !== null) resolvedReferencedIds.add(resolved);
    });

    let missingFromDisk = 0;
    let placeholderAlts = 0;
    let missingAlts = 0;
    for (const [id, entry] of Object.entries(images)) {
      if (entry.src && !isNonLocalFilesystemSrc(entry.src)) {
        const srcPath = path.join(process.cwd(), entry.src);
        if (!fs.existsSync(srcPath)) {
          missingFromDisk++;
          errors.push({
            type: "error",
            code: "IMAGE_SRC_FILE_MISSING",
            message: `Image file not found on disk: ${entry.src}`,
            file: REGISTRY_PATH,
            suggestion: `Check that the file exists at ${srcPath} or update the registry entry for "${id}"`,
            fix: {
              type: "api",
              label: "Sync image registry (detect updated paths)",
              fixerName: "image-registry-sync",
            },
          });
        }
      }

      if (!entry.alt || entry.alt.trim() === "") {
        missingAlts++;
        errors.push({
          type: "error",
          code: "IMAGE_ALT_MISSING",
          message: `Image "${id}" has no alt text`,
          file: REGISTRY_PATH,
          suggestion: "Add descriptive alt text for accessibility",
        });
      } else if (entry.alt.match(/todo/i)) {
        placeholderAlts++;
        warnings.push({
          type: "warning",
          code: "IMAGE_ALT_PLACEHOLDER",
          message: `Image "${id}" has placeholder alt text: "${entry.alt}"`,
          file: REGISTRY_PATH,
          suggestion: "Replace TODO placeholder with actual descriptive alt text",
        });
      }
    }

    let orphanedEntries = 0;
    let externalSourceSkipped = 0;
    for (const [id, entry] of Object.entries(images)) {
      if (entry.source_url || entry.source_item) {
        externalSourceSkipped++;
        continue;
      }
      if (entry.protected) {
        continue;
      }
      const srcsetUrls = Array.isArray(entry.srcset) ? entry.srcset.map((s) => s.url) : [];
      const usage = mediaGallery.getUsage(id, entry.src, srcsetUrls);
      const isUsed = usage.length > 0 || resolvedReferencedIds.has(id);
      if (!isUsed) {
        orphanedEntries++;
        warnings.push({
          type: "warning",
          code: "ORPHANED_REGISTRY_ENTRY",
          message: `Registry image "${id}" is not referenced by any content file`,
          file: REGISTRY_PATH,
          suggestion: "Consider removing unused registry entries or adding references in content",
          fix: {
            type: "api",
            label: "Remove orphaned images",
            fixerName: "orphaned-images-cleanup",
          },
        });
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        registryEntries: Object.keys(images).length,
        referencedIds: referencedIds.size,
        missingFromRegistry,
        missingFromDisk,
        placeholderAlts,
        orphanedEntries,
        externalSourceSkipped,
      },
    };
  },
};
