/** Media gallery / picker document types. */
export type MediaDoctype = "image" | "video" | "pdf";

export const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".avif",
  ".gif",
]);

export const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".ogg",
  ".m4v",
]);

export const PDF_EXTENSIONS = new Set([".pdf"]);

export const MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...PDF_EXTENSIONS,
]);

const DOCTYPE_EXTENSIONS: Record<MediaDoctype, Set<string>> = {
  image: IMAGE_EXTENSIONS,
  video: VIDEO_EXTENSIONS,
  pdf: PDF_EXTENSIONS,
};

/** Normalize a path or filename to a lowercase extension including the dot. */
export function extensionFromPath(pathOrName: string): string {
  const clean = pathOrName.split("?")[0]?.split("#")[0] ?? pathOrName;
  const base = clean.includes("/") ? clean.slice(clean.lastIndexOf("/") + 1) : clean;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot).toLowerCase();
}

export function inferDoctypeFromFilename(filename: string): MediaDoctype | null {
  const ext = extensionFromPath(filename);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  return null;
}

/** Infer doctype from a registry `src` URL or local path. */
export function inferDoctypeFromSrc(src: string): MediaDoctype | null {
  if (!src || typeof src !== "string") return null;
  try {
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")) {
      const pathname = new URL(src.startsWith("//") ? `https:${src}` : src).pathname;
      return inferDoctypeFromFilename(pathname);
    }
  } catch {
    // fall through to path-based inference
  }
  return inferDoctypeFromFilename(src);
}

export function extensionsForDoctype(doctype: MediaDoctype): string[] {
  return [...DOCTYPE_EXTENSIONS[doctype]];
}

/** Comma-separated accept attribute for `<input type="file">`. */
export function acceptAttrForDoctype(doctype: MediaDoctype): string {
  return extensionsForDoctype(doctype).join(",");
}

export function isMediaExtension(ext: string): boolean {
  return MEDIA_EXTENSIONS.has(ext.toLowerCase().startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
}

export function defaultAltForDoctype(doctype: MediaDoctype | null, basename: string): string {
  const name = basename || "file";
  if (doctype === "pdf") return `Document: ${name}`;
  if (doctype === "video") return `Video: ${name}`;
  return `Image: ${name}`;
}
