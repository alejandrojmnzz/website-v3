import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "../shared/templateVars";
import { markFileAsModified } from "./sync-state";

const ATTACHED_ASSETS_DIR = path.join(process.cwd(), "attached_assets");
const MARKETING_CONTENT_DIR = path.join(process.cwd(), process.env.CONTENT_FOLDER || "4geeks-com");
const MARKETING_IMAGES_DIR = path.join(MARKETING_CONTENT_DIR, "images");
const REGISTRY_PATH = path.join(MARKETING_CONTENT_DIR, "image-registry.json");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".avif", ".gif"]);

const SCREENSHOT_PATTERNS = [/^Screenshot_/i, /^Captura_/i, /^Capture_/i, /^Screen[\s_]?Shot/i];

export interface ScanNewImage {
  id: string;
  src: string;
  filename: string;
}

export interface ScanUpdatedImage {
  id: string;
  oldSrc: string;
  newSrc: string;
}

export interface BrokenReference {
  yamlFile: string;
  field: string;
  missingSrc: string;
}

export interface ScanResult {
  newImages: ScanNewImage[];
  updatedImages: ScanUpdatedImage[];
  brokenReferences: BrokenReference[];
  registeredCount: number;
  scannedImagesCount: number;
  summary: {
    new: number;
    updated: number;
    broken: number;
  };
}

function filenameToId(filename: string): string {
  const name = path.parse(filename).name;
  return name
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function getIdBase(filename: string): string {
  const name = path.parse(filename).name;
  const withoutTimestamp = name.replace(/_\d{13,}$/, "");
  return withoutTimestamp
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function extractTimestamp(filename: string): number {
  const name = path.parse(filename).name;
  const match = name.match(/_(\d{13,})$/);
  return match ? parseInt(match[1], 10) : 0;
}

function isScreenshot(filename: string): boolean {
  return SCREENSHOT_PATTERNS.some(pattern => pattern.test(filename));
}

function scanImageDirectory(baseDir: string, urlPrefix: string, skipScreenshots: boolean): Map<string, string> {
  const imageFiles = new Map<string, string>();
  if (!fs.existsSync(baseDir)) return imageFiles;

  function walkDir(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walkDir(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else {
        if (skipScreenshots && isScreenshot(entry.name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          const relPath = `${prefix}${entry.name}`;
          imageFiles.set(relPath, `${urlPrefix}${relPath}`);
        }
      }
    }
  }

  walkDir(baseDir, "");
  return imageFiles;
}

function scanAllImageDirectories(): Map<string, string> {
  const attachedAssets = scanImageDirectory(ATTACHED_ASSETS_DIR, "/attached_assets/", true);
  const marketingImages = scanImageDirectory(MARKETING_IMAGES_DIR, "/4geeks-com/images/", false);
  const combined = new Map<string, string>();
  attachedAssets.forEach((src, key) => combined.set(key, src));
  marketingImages.forEach((src, key) => combined.set(key, src));
  return combined;
}

function loadRegistry(): { presets: Record<string, any>; images: Record<string, any> } {
  try {
    const content = fs.readFileSync(REGISTRY_PATH, "utf8");
    return JSON.parse(content);
  } catch {
    return { presets: {}, images: {} };
  }
}

function findImageRefsInValue(
  value: any,
  currentPath: string,
  results: Array<{ field: string; src: string }>
): void {
  if (typeof value === "string") {
    if (value.startsWith("/attached_assets/") || value.startsWith("attached_assets/") ||
        value.startsWith("/4geeks-com/images/") || value.startsWith("4geeks-com/images/")) {
      results.push({ field: currentPath, src: value });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findImageRefsInValue(item, `${currentPath}[${index}]`, results);
    });
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      findImageRefsInValue(val, currentPath ? `${currentPath}.${key}` : key, results);
    }
  }
}

function scanYamlFiles(): Array<{ yamlFile: string; field: string; src: string }> {
  const refs: Array<{ yamlFile: string; field: string; src: string }> = [];

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          const { escaped, map } = escapeTemplateVars(content);
          const rawParsed = yaml.load(escaped);
          const parsed = rawParsed ? unescapeObjectVars(rawParsed, map) : rawParsed;
          if (parsed && typeof parsed === "object") {
            const fileRefs: Array<{ field: string; src: string }> = [];
            findImageRefsInValue(parsed, "", fileRefs);
            const relPath = path.relative(process.cwd(), fullPath);
            for (const ref of fileRefs) {
              refs.push({ yamlFile: relPath, field: ref.field, src: ref.src });
            }
          }
        } catch {
          // skip unparseable YAML
        }
      }
    }
  }

  walkDir(MARKETING_CONTENT_DIR);
  return refs;
}

export function scanImageRegistry(): ScanResult {
  const registry = loadRegistry();
  const allImages = scanAllImageDirectories();
  const marketingOnly = scanImageDirectory(MARKETING_IMAGES_DIR, "/4geeks-com/images/", false);
  const yamlRefs = scanYamlFiles();

  const existingSrcSet = new Set<string>();
  const existingIdByBase = new Map<string, { id: string; src: string } | null>();

  for (const [id, entry] of Object.entries(registry.images)) {
    existingSrcSet.add(entry.src);
    const filename = entry.src.split("/").pop() || "";
    const base = getIdBase(filename);
    if (base) {
      if (existingIdByBase.has(base)) {
        existingIdByBase.set(base, null);
      } else {
        existingIdByBase.set(base, { id, src: entry.src });
      }
    }
  }

  const newImages: ScanNewImage[] = [];
  const updatedImages: ScanUpdatedImage[] = [];

  // Only flag images from 4geeks-com/images/ as new/unregistered
  // attached_assets/ is legacy and should not produce new registration suggestions
  marketingOnly.forEach((src, filename) => {
    if (existingSrcSet.has(src)) return;

    const base = getIdBase(filename);
    const existing = existingIdByBase.get(base) ?? undefined;

    if (existing) {
      const oldFile = existing.src.split("/").pop() || "";
      const oldExt = path.extname(oldFile).toLowerCase();
      const newExt = path.extname(filename).toLowerCase();
      if (oldExt !== newExt) {
        const oldTs = extractTimestamp(oldFile);
        const newTs = extractTimestamp(filename);
        if (newTs >= oldTs) {
          updatedImages.push({
            id: existing.id,
            oldSrc: existing.src,
            newSrc: src,
          });
        }
      }
    } else {
      const basename = path.basename(filename);
      const id = filenameToId(basename);
      if (id && !registry.images[id]) {
        newImages.push({ id, src, filename });
      }
    }
  });

  const brokenReferences: BrokenReference[] = [];
  const checkedSrcs = new Set<string>();

  for (const ref of yamlRefs) {
    const normalizedSrc = ref.src.startsWith("/") ? ref.src : `/${ref.src}`;
    if (checkedSrcs.has(`${ref.yamlFile}:${normalizedSrc}`)) continue;
    checkedSrcs.add(`${ref.yamlFile}:${normalizedSrc}`);

    const diskPath = path.join(process.cwd(), normalizedSrc);
    if (!fs.existsSync(diskPath)) {
      brokenReferences.push({
        yamlFile: ref.yamlFile,
        field: ref.field,
        missingSrc: normalizedSrc,
      });
    }
  }

  for (const [id, entry] of Object.entries(registry.images)) {
    const src = (entry as any).src;
    if (!src || typeof src !== "string") continue;
    const normalizedSrc = src.startsWith("/") ? src : `/${src}`;
    const diskPath = path.join(process.cwd(), normalizedSrc);
    if (!fs.existsSync(diskPath)) {
      brokenReferences.push({
        yamlFile: `image-registry.json (id: ${id})`,
        field: "src",
        missingSrc: normalizedSrc,
      });
    }
  }

  return {
    newImages,
    updatedImages,
    brokenReferences,
    registeredCount: Object.keys(registry.images).length,
    scannedImagesCount: allImages.size,
    summary: {
      new: newImages.length,
      updated: updatedImages.length,
      broken: brokenReferences.length,
    },
  };
}

function replacePathsInYamlFiles(
  oldSrc: string,
  newSrc: string
): string[] {
  const updatedFiles: string[] = [];

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (content.includes(oldSrc)) {
          const updated = content.split(oldSrc).join(newSrc);
          fs.writeFileSync(fullPath, updated, "utf8");
          updatedFiles.push(path.relative(process.cwd(), fullPath));
        }
      }
    }
  }

  walkDir(MARKETING_CONTENT_DIR);
  return updatedFiles;
}

export function applyRegistryChanges(scanResult: ScanResult): {
  added: number;
  updated: number;
  yamlFilesUpdated: string[];
} {
  const registry = loadRegistry();
  const allYamlFilesUpdated: string[] = [];

  for (const img of scanResult.newImages) {
    registry.images[img.id] = {
      src: img.src,
      alt: `TODO: Add alt text for ${img.filename}`,
      focal_point: "center",
      tags: [],
      usage_count: 0,
    };
  }

  for (const img of scanResult.updatedImages) {
    if (registry.images[img.id]) {
      registry.images[img.id].src = img.newSrc;
    }
    const files = replacePathsInYamlFiles(img.oldSrc, img.newSrc);
    allYamlFilesUpdated.push(...files);
  }

  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf8");
  markFileAsModified(`${process.env.CONTENT_FOLDER || "4geeks-com"}/image-registry.json`);

  return {
    added: scanResult.newImages.length,
    updated: scanResult.updatedImages.length,
    yamlFilesUpdated: Array.from(new Set(allYamlFilesUpdated)),
  };
}
