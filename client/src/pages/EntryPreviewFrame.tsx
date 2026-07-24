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

export default function EntryPreviewFrame() {
  const { contentType, slug } = useParams<{ contentType: string; slug: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const locale = searchParams.get("locale") || "en";
  const isCapture = searchParams.get("capture") === "1";

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [section, setSection] = useState<Section | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useScreenshotFrameProtocol({
    rootRef,
    enabled: true,
    onThemeUpdate: setTheme,
  });

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  useEffect(() => {
    if (!contentType || !slug) {
      setError("Missing content type or slug");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(
      `/api/content-types/${encodeURIComponent(contentType)}/entries/${encodeURIComponent(slug)}/preview-frame?locale=${encodeURIComponent(locale)}`,
    )
      .then(async (res) => {
        const data = (await res.json()) as PreviewFramePayload & { error?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load preview frame");
        setSection(data.section);
        if (data.theme === "light" || data.theme === "dark") setTheme(data.theme);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [contentType, slug, locale]);

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
      className={isCapture ? "bg-background" : "min-h-screen bg-background"}
      data-testid="entry-preview-frame"
    >
      <SectionRenderer sections={[section]} />
    </div>
  );
}
