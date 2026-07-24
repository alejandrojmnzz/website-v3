import * as fs from "fs";
import * as path from "path";
import { child } from "./logger";

const log = child({ module: "screenshot-cache" });

export interface ScreenshotCacheStore {
  dir: string;
  safeKey: (raw: string) => string;
  imagePath: (base: string) => string;
  metaPath: (base: string) => string;
  ensureDir: () => void;
  readMeta: <T>(base: string) => T | null;
  writeMeta: (base: string, meta: unknown) => void;
  readImage: (base: string) => Buffer | null;
  writeImage: (base: string, image: Buffer) => void;
  hasImage: (base: string) => boolean;
  deletePair: (base: string) => void;
}

/** Sanitize a filesystem key segment. */
export function safeScreenshotKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "key";
}

/**
 * Generic on-disk WebP + .meta.json store (used by component gallery screenshots).
 */
export function createScreenshotCacheStore(dir: string): ScreenshotCacheStore {
  const ensureDir = () => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  };

  const imagePath = (base: string) => path.join(dir, `${base}.webp`);
  const metaPath = (base: string) => path.join(dir, `${base}.meta.json`);

  return {
    dir,
    safeKey: safeScreenshotKey,
    imagePath,
    metaPath,
    ensureDir,
    readMeta: <T,>(base: string): T | null => {
      try {
        const p = metaPath(base);
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, "utf8")) as T;
      } catch (error) {
        log.warn({ err: error, base }, "Failed to read screenshot meta");
        return null;
      }
    },
    writeMeta: (base: string, meta: unknown) => {
      ensureDir();
      fs.writeFileSync(metaPath(base), JSON.stringify(meta, null, 2));
    },
    readImage: (base: string): Buffer | null => {
      const p = imagePath(base);
      if (!fs.existsSync(p)) return null;
      try {
        return fs.readFileSync(p);
      } catch (error) {
        log.error({ err: error, base }, "Failed to read screenshot image");
        return null;
      }
    },
    writeImage: (base: string, image: Buffer) => {
      ensureDir();
      fs.writeFileSync(imagePath(base), image);
    },
    hasImage: (base: string) => fs.existsSync(imagePath(base)),
    deletePair: (base: string) => {
      const img = imagePath(base);
      const meta = metaPath(base);
      if (fs.existsSync(img)) fs.unlinkSync(img);
      if (fs.existsSync(meta)) fs.unlinkSync(meta);
    },
  };
}
