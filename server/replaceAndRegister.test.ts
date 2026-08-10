import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { MediaGallery } from "./media-gallery";
import { media } from "./media";

describe("MediaGallery.replaceAndRegister", () => {
  let relativeFolder: string;
  let tmpDir: string;
  let gallery: MediaGallery;
  let imagesDir: string;

  beforeEach(async () => {
    media.init({ defaultProvider: "local" });
    const cacheRoot = path.join(process.cwd(), ".cache");
    fs.mkdirSync(cacheRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(cacheRoot, "mg-replace-"));
    relativeFolder = path.relative(process.cwd(), tmpDir);
    imagesDir = path.join(tmpDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });

    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 60 } },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(imagesDir, "hero-test.png"), png);

    const src = `/${relativeFolder}/images/hero-test.png`;
    fs.writeFileSync(
      path.join(tmpDir, "image-registry.json"),
      JSON.stringify(
        {
          presets: {},
          images: {
            "hero-test": {
              src,
              alt: "Hero alt",
              tags: ["hero"],
              focal_point: "center",
              protected: true,
              srcset: [{ w: 640, url: `/${relativeFolder}/images/hero-test-640w.webp` }],
            },
            "hero-test-800x600": {
              src: `/${relativeFolder}/images/hero-test-800x600.webp`,
              alt: "Crop",
              tags: ["hero"],
              parentId: "hero-test",
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    gallery = new MediaGallery(relativeFolder);
  });

  afterEach(() => {
    gallery.clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects doctype mismatch", async () => {
    const pdf = Buffer.from("%PDF-1.4");
    await expect(
      gallery.replaceAndRegister("hero-test", "doc.pdf", pdf, "application/pdf"),
    ).rejects.toThrow(/Cannot change media type/);
  });

  it("converts to WebP, preserves metadata, clears srcset, returns childIds", async () => {
    const jpg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .jpeg()
      .toBuffer();

    const result = await gallery.replaceAndRegister(
      "hero-test",
      "replacement.jpg",
      jpg,
      "image/jpeg",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.id).toBe("hero-test");
    expect(result.src.endsWith(".webp")).toBe(true);
    expect(result.srcChanged).toBe(true);
    expect(result.childIds).toEqual(["hero-test-800x600"]);
    expect(result.alt).toBe("Hero alt");

    const entry = gallery.getRegistry()!.images["hero-test"];
    expect(entry.alt).toBe("Hero alt");
    expect(entry.tags).toEqual(["hero"]);
    expect(entry.protected).toBe(true);
    expect(entry.format).toBe("webp");
    expect(entry.srcset).toBeUndefined();
    expect(entry.hash).toBeTruthy();

    const diskPath = path.join(process.cwd(), entry.src.replace(/^\//, ""));
    expect(fs.existsSync(diskPath)).toBe(true);
  });

  it("returns duplicate conflict when bytes match another id", async () => {
    const shared = await sharp({
      create: { width: 6, height: 6, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();

    const webp = await sharp(shared).webp({ quality: 85 }).toBuffer();
    const hash = gallery.computeBufferHash(webp);

    const registry = gallery.getRegistry()!;
    (registry.images as Record<string, unknown>)["other-img"] = {
      src: `/${relativeFolder}/images/other-img.webp`,
      alt: "Other",
      tags: [],
      hash,
    };
    gallery.saveRegistry(registry);

    const result = await gallery.replaceAndRegister(
      "hero-test",
      "same.png",
      shared,
      "image/png",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict).toBe("duplicate");
    expect(result.existingId).toBe("other-img");

    const after = gallery.getRegistry()!.images["hero-test"];
    expect(after.src).toContain("hero-test.png");
  });
});
