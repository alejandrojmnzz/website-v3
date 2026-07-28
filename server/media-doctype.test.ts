import { describe, expect, it } from "vitest";
import {
  MEDIA_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  PDF_EXTENSIONS,
  acceptAttrForDoctype,
  defaultAltForDoctype,
  extensionFromPath,
  extensionsForDoctype,
  inferDoctypeFromFilename,
  inferDoctypeFromSrc,
} from "@shared/media-doctype";

describe("media-doctype", () => {
  it("includes pdf in MEDIA_EXTENSIONS", () => {
    expect(MEDIA_EXTENSIONS.has(".pdf")).toBe(true);
    expect(PDF_EXTENSIONS.has(".pdf")).toBe(true);
    expect(IMAGE_EXTENSIONS.has(".pdf")).toBe(false);
    expect(VIDEO_EXTENSIONS.has(".mp4")).toBe(true);
  });

  it("extensionFromPath strips query and hash", () => {
    expect(extensionFromPath("/a/b/doc.pdf?x=1#y")).toBe(".pdf");
    expect(extensionFromPath("photo.JPEG")).toBe(".jpeg");
  });

  it("inferDoctypeFromFilename", () => {
    expect(inferDoctypeFromFilename("hero.webp")).toBe("image");
    expect(inferDoctypeFromFilename("clip.mp4")).toBe("video");
    expect(inferDoctypeFromFilename("syllabus.pdf")).toBe("pdf");
    expect(inferDoctypeFromFilename("readme.txt")).toBeNull();
  });

  it("inferDoctypeFromSrc handles local paths and URLs", () => {
    expect(inferDoctypeFromSrc("/site_4geeks-com/images/a.png")).toBe("image");
    expect(inferDoctypeFromSrc("https://storage.googleapis.com/bucket/site/media/v.webm")).toBe(
      "video",
    );
    expect(inferDoctypeFromSrc("https://cdn.example.com/files/guide.PDF?download=1")).toBe("pdf");
    expect(inferDoctypeFromSrc("")).toBeNull();
  });

  it("extensionsForDoctype and acceptAttrForDoctype", () => {
    expect(extensionsForDoctype("pdf")).toEqual([".pdf"]);
    expect(acceptAttrForDoctype("pdf")).toBe(".pdf");
    expect(acceptAttrForDoctype("image")).toContain(".png");
    expect(acceptAttrForDoctype("video")).toContain(".mp4");
  });

  it("defaultAltForDoctype", () => {
    expect(defaultAltForDoctype("pdf", "syllabus")).toBe("Document: syllabus");
    expect(defaultAltForDoctype("video", "intro")).toBe("Video: intro");
    expect(defaultAltForDoctype("image", "hero")).toBe("Image: hero");
    expect(defaultAltForDoctype(null, "x")).toBe("Image: x");
  });
});
