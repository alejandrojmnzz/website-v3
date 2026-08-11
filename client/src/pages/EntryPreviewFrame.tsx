import { useEffect, useRef, useState } from "react";
import { useParams, useSearch } from "wouter";
import { SectionRenderer } from "@/components/SectionRenderer";
import { useScreenshotFrameProtocol } from "@/hooks/useScreenshotFrameProtocol";
import type { Section } from "@shared/schema";

interface PreviewFramePayload {
  theme: "dark" | "light";
  section: Section;
  error?: string;
}

function coercePreviewScalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    const t = value.trim();
    return t || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of ["title", "name", "label", "slug"]) {
      if (typeof o[key] === "string" && o[key].trim()) return (o[key] as string).trim();
    }
  }
  return undefined;
}

export default function EntryPreviewFrame() {
  const { contentType, slug } = useParams<{ contentType: string; slug: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const locale = searchParams.get("locale") || "en";
  const isCapture = searchParams.get("capture") === "1";
  const captureToken = searchParams.get("capture_token") || "";
  const captureExp = searchParams.get("exp") || "";
  const themeFromQuery = searchParams.get("theme");
  const initialTheme: "dark" | "light" =
    themeFromQuery === "light" || themeFromQuery === "dark" ? themeFromQuery : "dark";

  const [theme, setTheme] = useState<"dark" | "light">(initialTheme);
  const [section, setSection] = useState<Section | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [captureReady, setCaptureReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentReady = !loading && !!section && !error;

  useScreenshotFrameProtocol({
    rootRef,
    // Only handshake once the screenshot root with section content is mounted.
    enabled: contentReady,
    onThemeUpdate: setTheme,
  });

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  // Apply query theme immediately so capture iframes are dark before paint.
  useEffect(() => {
    if (initialTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [initialTheme]);

  useEffect(() => {
    if (!contentType || !slug) {
      setError("Missing content type or slug");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setCaptureReady(false);
    const frameQs = new URLSearchParams({ locale });
    if (themeFromQuery === "light" || themeFromQuery === "dark") {
      frameQs.set("theme", themeFromQuery);
    }
    if (captureToken) {
      frameQs.set("capture_token", captureToken);
      if (captureExp) frameQs.set("exp", captureExp);
    }
    fetch(
      `/api/content-types/${encodeURIComponent(contentType)}/entries/${encodeURIComponent(slug)}/preview-frame?${frameQs}`,
    )
      .then(async (res) => {
        const data = (await res.json()) as PreviewFramePayload & { error?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load preview frame");
        const raw = data.section as Record<string, unknown>;
        // Scalar OG props may arrive as nested objects from DB field mapping (e.g. category).
        // Preserve string[] for category (tags → badges in og_image_preview).
        // Preserve full `content` string for reading-time calculation.
        const category = Array.isArray(raw.category)
          ? raw.category
          : (coercePreviewScalar(raw.category) ?? raw.category);
        const content =
          typeof raw.content === "string" ? raw.content : (coercePreviewScalar(raw.content) ?? raw.content);
        const normalized = {
          ...raw,
          title: coercePreviewScalar(raw.title) ?? raw.title,
          category,
          author: coercePreviewScalar(raw.author) ?? raw.author,
          content,
          reading_time: coercePreviewScalar(raw.reading_time) ?? raw.reading_time,
          logo: coercePreviewScalar(raw.logo) ?? raw.logo,
        } as Section;
        setSection(normalized);
        // Prefer capture URL theme, then API theme.
        if (themeFromQuery === "light" || themeFromQuery === "dark") {
          setTheme(themeFromQuery);
        } else if (data.theme === "light" || data.theme === "dark") {
          setTheme(data.theme);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [contentType, slug, locale, themeFromQuery, captureToken, captureExp]);

  // Mark capture-ready after images settle (Cloudflare waitForSelector).
  useEffect(() => {
    if (!contentReady || !rootRef.current) {
      setCaptureReady(false);
      return;
    }
    let cancelled = false;
    const root = rootRef.current;
    const images = Array.from(root.querySelectorAll("img"));
    const wait = Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, 8000);
          }),
      ),
    );
    void wait.then(() => {
      if (!cancelled) {
        // Small paint buffer for fonts/layout
        setTimeout(() => {
          if (!cancelled) setCaptureReady(true);
        }, 150);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [contentReady, section]);

  useEffect(() => {
    if (loading) return;
    if (!error && section) return;
    if (window.parent === window) return;
    window.parent.postMessage(
      { type: "preview-error", error: error || "No section" },
      "*",
    );
  }, [loading, error, section]);

  if (loading) {
    return (
      <div className="min-h-[200px] bg-background text-muted-foreground flex items-center justify-center text-sm">
        Loading preview…
      </div>
    );
  }

  if (error || !section) {
    return (
      <div className="min-h-[200px] bg-background text-destructive flex items-center justify-center text-sm p-4">
        {error || "No section"}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-screenshot-root
      data-capture-ready={captureReady ? "1" : "0"}
      className={isCapture ? "bg-background" : "min-h-screen bg-background"}
      data-testid="entry-preview-frame"
    >
      <SectionRenderer sections={[section]} />
    </div>
  );
}

