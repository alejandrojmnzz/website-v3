/**
 * Fixer: hero-image-tags
 *
 * Scans all hero sections across pages/landings YAML files, locates registry
 * entries that are missing the "hero" tag, and adds the tag then saves the
 * registry. Equivalent to running `audit-hero-image-tags.ts --fix`.
 *
 */

import * as fs from "fs";
import * as path from "path";
import * as jsYaml from "js-yaml";
import type { Fixer, FixerContext, FixerResult } from "./types";
import { escapeTemplateVars } from "../../../shared/templateVars";
import { mediaGallery } from "../../../server/media-gallery";
import { processImageFromSrc } from "../../../server/image-optimizer";
import type { Preset } from "../../../server/image-optimizer";
import { getAllDirectories } from "../../../server/content-types";

const MARKETING_CONTENT_DIR = path.join(process.cwd(), "4geeks-com");
const REGISTRY_PATH = path.join(MARKETING_CONTENT_DIR, "image-registry.json");

const CONTENT_DIRS = getAllDirectories().map(dir => path.join(MARKETING_CONTENT_DIR, dir));

const HERO_VARIANT_KEYS = new Set([
  "hero",
  "hero_singleColumn",
  "hero_showcase",
  "hero_productShowcase",
  "hero_simpleTwoColumn",
  "hero_simpleStacked",
  "hero_twoColumn",
  "hero_course",
  "hero_ApplyFormProductShowcase",
]);

function getAllYamlFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
        files.push(full);
      }
    }
  }
  walk(dir);
  return files;
}

function extractSrc(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "src" in (value as Record<string, unknown>)) {
    const src = (value as Record<string, unknown>).src;
    if (typeof src === "string" && src.length > 0) return src;
  }
  return null;
}

function extractHeroImageSrcs(section: Record<string, unknown>): string[] {
  const srcs: string[] = [];
  for (const field of ["image", "background_image", "form_card_image"]) {
    if (field in section) {
      const s = extractSrc(section[field]);
      if (s) srcs.push(s);
    }
  }
  for (const field of ["left_images", "right_images"]) {
    if (Array.isArray(section[field])) {
      for (const item of section[field] as unknown[]) {
        const s = extractSrc(item);
        if (s) srcs.push(s);
      }
    }
  }
  if (section.media && typeof section.media === "object") {
    const media = section.media as Record<string, unknown>;
    if (typeof media.src === "string" && media.src.length > 0) srcs.push(media.src);
  }
  return srcs;
}

function isKeyedHeroSection(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (!keys.length) return false;
  return HERO_VARIANT_KEYS.has(keys[0]) || keys[0].startsWith("hero");
}

function findHeroSections(parsed: unknown): Record<string, unknown>[] {
  const heroes: Record<string, unknown>[] = [];
  if (!parsed || typeof parsed !== "object") return heroes;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      if (s.type === "hero") {
        heroes.push(s);
      } else if (!("type" in s) && isKeyedHeroSection(s)) {
        const inner = s[Object.keys(s)[0]];
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
          heroes.push(inner as Record<string, unknown>);
        }
      }
    }
    return heroes;
  }
  for (const val of Object.values(parsed as Record<string, unknown>)) {
    if (Array.isArray(val)) heroes.push(...findHeroSections(val));
  }
  return heroes;
}

export const heroImageTagsFixer: Fixer = {
  name: "hero-image-tags",
  description: "Adds the 'hero' tag to registry entries used in hero sections that are missing it",

  async run(_ctx: FixerContext): Promise<FixerResult> {
    let registry: { images: Record<string, { src: string; tags?: string[]; [key: string]: unknown }> };
    try {
      registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
    } catch (err) {
      return { ok: false, message: `Failed to load registry: ${err instanceof Error ? err.message : String(err)}` };
    }

    const srcToId: Record<string, string> = {};
    for (const [id, entry] of Object.entries(registry.images)) {
      srcToId[entry.src] = id;
    }

    const heroSrcs = new Set<string>();
    for (const dir of CONTENT_DIRS) {
      for (const file of getAllYamlFiles(dir)) {
        try {
          const { escaped } = escapeTemplateVars(fs.readFileSync(file, "utf-8"));
          const parsed = jsYaml.load(escaped);
          for (const hero of findHeroSections(parsed)) {
            for (const src of extractHeroImageSrcs(hero)) heroSrcs.add(src);
          }
        } catch {
          // skip unparseable files
        }
      }
    }

    let fixed = 0;
    let alreadyTagged = 0;
    let notInRegistry = 0;
    const fixedIds: string[] = [];

    for (const src of heroSrcs) {
      const isUrl = src.startsWith("http://") || src.startsWith("https://");
      const registryId = (!isUrl && registry.images[src]) ? src : srcToId[src];
      if (!registryId) { notInRegistry++; continue; }

      const entry = registry.images[registryId];
      if ((entry.tags || []).includes("hero")) { alreadyTagged++; continue; }

      if (!entry.tags) entry.tags = [];
      entry.tags.push("hero");
      fixed++;
      fixedIds.push(registryId);
    }

    if (fixed > 0) {
      fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
      mediaGallery.clearCache();

      (async () => {
        try {
          const liveRegistry = mediaGallery.getRegistry();
          if (!liveRegistry) return;
          const presets = liveRegistry.presets as Record<string, Preset>;
          let optimized = 0;
          for (const id of fixedIds) {
            const entry = liveRegistry.images[id];
            if (!entry) continue;
            try {
              const result = await processImageFromSrc(id, entry, presets);
              if (result) {
                entry.preset = result.preset;
                entry.widths_generated = result.widths_generated;
                entry.format = result.format;
                entry.srcset = result.srcset;
                if (result.width) entry.width = result.width;
                if (result.height) entry.height = result.height;
                optimized++;
              }
            } catch (err) {
              console.error(`[Fixer:hero-image-tags] Optimization failed for "${id}":`, err);
            }
          }
          if (optimized > 0) mediaGallery.persistRegistry();
          console.log(`[Fixer:hero-image-tags] Optimization complete: ${optimized}/${fixedIds.length} images processed`);
        } catch (err) {
          console.error("[Fixer:hero-image-tags] Background optimization error:", err);
        }
      })();
    }

    return {
      ok: true,
      message: fixed > 0
        ? `Added "hero" tag to ${fixed} registry entry(ies) — optimization started in background`
        : "No missing hero tags found — registry is up to date",
      details: { fixed, alreadyTagged, notInRegistry, heroImagesScanned: heroSrcs.size },
    };
  },
};
