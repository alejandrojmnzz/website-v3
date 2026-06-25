#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MARKETING_CONTENT_DIR = path.resolve(__dirname, "../../4geeks-com");
const IMAGE_REGISTRY_PATH = path.join(MARKETING_CONTENT_DIR, "image-registry.json");

interface ImageEntry {
  src: string;
  alt: string;
  focal_point?: string;
  tags?: string[];
  usage_count?: number;
}

interface ImageRegistry {
  presets: Record<string, unknown>;
  images: Record<string, ImageEntry>;
}

function getAllYamlFiles(dir: string): string[] {
  const files: string[] = [];
  
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

const IMAGE_ID_KEYS = new Set(["image_id", "imageId", "logo", "icon", "avatar", "thumbnail", "badge"]);
const IMAGE_PATH_KEYS = new Set(["src", "image", "background", "background_image", "hero_image", "cover", "poster"]);

function findImageReferences(obj: unknown, imageIds: Set<string>, imagePaths: Set<string>): void {
  if (obj === null || obj === undefined) return;
  
  if (typeof obj === "string") {
    if (obj.startsWith("/attached_assets/")) {
      imagePaths.add(obj);
    }
    return;
  }
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      findImageReferences(item, imageIds, imagePaths);
    }
    return;
  }
  
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (IMAGE_ID_KEYS.has(key) && typeof value === "string") {
        imageIds.add(value);
      } else if (IMAGE_PATH_KEYS.has(key) && typeof value === "string") {
        if (value.startsWith("/attached_assets/")) {
          imagePaths.add(value);
        } else if (!value.startsWith("http") && !value.startsWith("/")) {
          imageIds.add(value);
        }
      } else {
        findImageReferences(value, imageIds, imagePaths);
      }
    }
  }
}

function main() {
  console.log("📊 Scanning YAML files for image usage...\n");
  
  const registry: ImageRegistry = JSON.parse(fs.readFileSync(IMAGE_REGISTRY_PATH, "utf-8"));
  
  const usageCounts: Record<string, number> = {};
  for (const id of Object.keys(registry.images)) {
    usageCounts[id] = 0;
  }
  
  const srcToId: Record<string, string> = {};
  for (const [id, img] of Object.entries(registry.images)) {
    srcToId[img.src] = id;
  }
  
  const yamlFiles = getAllYamlFiles(MARKETING_CONTENT_DIR);
  console.log(`Found ${yamlFiles.length} YAML files to scan.\n`);
  
  for (const file of yamlFiles) {
    if (file.includes("image-registry")) continue;
    
    try {
      const content = fs.readFileSync(file, "utf-8");
      const parsed = yaml.parse(content);
      
      const imageIds = new Set<string>();
      const imagePaths = new Set<string>();
      findImageReferences(parsed, imageIds, imagePaths);
      
      for (const id of imageIds) {
        if (id in usageCounts) {
          usageCounts[id]++;
        }
      }
      
      for (const srcPath of imagePaths) {
        const id = srcToId[srcPath];
        if (id && id in usageCounts) {
          usageCounts[id]++;
        }
      }
    } catch (err) {
      console.warn(`⚠️  Failed to parse ${path.relative(MARKETING_CONTENT_DIR, file)}: ${err}`);
    }
  }
  
  let updated = 0;
  for (const [id, count] of Object.entries(usageCounts)) {
    const currentCount = registry.images[id].usage_count ?? 0;
    if (currentCount !== count) {
      registry.images[id].usage_count = count;
      updated++;
    }
  }
  
  fs.writeFileSync(IMAGE_REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  
  const sortedUsage = Object.entries(usageCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  
  console.log("Top used images:");
  for (const [id, count] of sortedUsage) {
    console.log(`  ${count.toString().padStart(3)}x  ${id}`);
  }
  
  const unusedCount = Object.values(usageCounts).filter(c => c === 0).length;
  console.log(`\n📈 Summary:`);
  console.log(`  Total images: ${Object.keys(registry.images).length}`);
  console.log(`  Used images: ${Object.keys(registry.images).length - unusedCount}`);
  console.log(`  Unused images: ${unusedCount}`);
  console.log(`  Updated: ${updated} images\n`);
  
  console.log("✅ Image registry updated with usage counts.");
}

main();
