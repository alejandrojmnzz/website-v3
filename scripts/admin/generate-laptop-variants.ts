import fs from "fs";
import path from "path";
import sharp from "sharp";
import crypto from "crypto";

const WIDTHS = [640, 960, 1280, 1920];
const QUALITY = 85;
const IMAGES_DIR = path.resolve(process.cwd(), "4geeks-com/images");
const SOURCE_INPUT = path.join(IMAGES_DIR, "laptop.webp");
const WEBP_OUTPUT = path.join(IMAGES_DIR, "laptop.webp");
const REGISTRY_PATH = path.resolve(process.cwd(), "4geeks-com/image-registry.json");

async function main() {
  if (!fs.existsSync(SOURCE_INPUT)) {
    console.error(`Source not found: ${SOURCE_INPUT}`);
    process.exit(1);
  }

  const sourceBuffer = fs.readFileSync(SOURCE_INPUT);
  const sourceInfo = await sharp(sourceBuffer).metadata();
  const intrinsicWidth = sourceInfo.width || 0;
  const intrinsicHeight = sourceInfo.height || 0;

  console.log(`Source: ${SOURCE_INPUT} (${intrinsicWidth}×${intrinsicHeight}, format: ${sourceInfo.format})`);

  let masterBuffer: Buffer;
  let masterHash: string;

  if (sourceInfo.format !== "webp") {
    console.log("Converting source to WebP master...");
    masterBuffer = await sharp(sourceBuffer)
      .toFormat("webp", { quality: QUALITY })
      .toBuffer();
    fs.writeFileSync(WEBP_OUTPUT, masterBuffer);
    console.log(`  Wrote master WebP: ${WEBP_OUTPUT}`);
  } else {
    masterBuffer = sourceBuffer;
  }

  masterHash = crypto.createHash("sha256").update(masterBuffer).digest("hex");
  const masterMeta = await sharp(masterBuffer).metadata();

  const srcset: { w: number; url: string }[] = [];
  const widthsGenerated: number[] = [];

  for (const w of WIDTHS) {
    if (w > intrinsicWidth) {
      console.log(`  Skipping ${w}w — larger than source (${intrinsicWidth})`);
      continue;
    }

    const outFilename = `laptop-${w}w.webp`;
    const outPath = path.join(IMAGES_DIR, outFilename);
    const outUrl = `/4geeks-com/images/${outFilename}`;

    const { data, info } = await sharp(sourceBuffer)
      .resize({ width: w, withoutEnlargement: true })
      .toFormat("webp", { quality: QUALITY })
      .toBuffer({ resolveWithObject: true });

    fs.writeFileSync(outPath, data);
    console.log(`  Wrote ${outUrl} (${info.width}×${info.height}, ${(data.length / 1024).toFixed(1)} KB)`);
    srcset.push({ w: info.width, url: outUrl });
    widthsGenerated.push(info.width);
  }

  if (srcset.length === 0) {
    console.error("No variants generated.");
    process.exit(1);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
  if (!registry.images) registry.images = {};
  if (!registry.images.laptop) registry.images.laptop = {};

  const laptopEntry = registry.images.laptop;
  laptopEntry.src = "/4geeks-com/images/laptop.webp";
  laptopEntry.alt = laptopEntry.alt || "Code editor on a laptop";
  laptopEntry.focal_point = laptopEntry.focal_point || "center";
  laptopEntry.tags = laptopEntry.tags || ["illustration"];
  laptopEntry.hash = masterHash;
  laptopEntry.width = masterMeta.width || intrinsicWidth;
  laptopEntry.height = masterMeta.height || intrinsicHeight;
  laptopEntry.format = "webp";
  laptopEntry.preset = ["full"];
  laptopEntry.widths_generated = widthsGenerated;
  laptopEntry.srcset = srcset;
  laptopEntry.usage_count = laptopEntry.usage_count ?? 0;

  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  console.log(`\nUpdated image-registry.json laptop entry with ${srcset.length} srcset variants.`);
  console.log(JSON.stringify(srcset, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
