import type { OgImagePreviewSection } from "@shared/schema";
import UniversalImage from "@/components/UniversalImage";
import { Badge } from "@/components/ui/badge";
import { formatReadingTimeLabel } from "@/lib/readingTime";

const DEFAULT_LOGO_ID = "4geeks-devs-logo-1763162063433";

interface OgImagePreviewProps {
  data: OgImagePreviewSection;
}

function formatMetaLine(author?: string, readingTime?: string | null): string | null {
  const parts = [author?.trim(), readingTime?.trim()].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

/** Normalize category to badge labels (string, string[], or object-ish tag items). */
function categoryLabels(category: unknown): string[] {
  if (category == null) return [];

  const fromItem = (item: unknown): string | undefined => {
    if (typeof item === "string") {
      const t = item.trim();
      return t || undefined;
    }
    if (typeof item === "number" || typeof item === "boolean") return String(item);
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      for (const key of ["title", "name", "label", "slug"]) {
        if (typeof o[key] === "string" && (o[key] as string).trim()) {
          return (o[key] as string).trim();
        }
      }
    }
    return undefined;
  };

  if (Array.isArray(category)) {
    return category.map(fromItem).filter((v): v is string => !!v);
  }

  const single = fromItem(category);
  return single ? [single] : [];
}

export function OgImagePreviewDefault({ data }: OgImagePreviewProps) {
  const { logo, category, title, author, content, reading_time } = data;
  const logoId = typeof logo === "string" && logo.length > 0 ? logo : DEFAULT_LOGO_ID;
  const readingLabel =
    (typeof reading_time === "string" && reading_time.trim()) || formatReadingTimeLabel(content);
  const metaLine = formatMetaLine(author, readingLabel);
  const labels = categoryLabels(category);

  return (
    <section
      className="relative flex w-[1200px] h-[630px] flex-col justify-between overflow-hidden p-16 text-foreground"
      style={{
        background:
          "radial-gradient(ellipse 120% 100% at 0% 0%, hsl(var(--primary) / 0.55) 0%, hsl(var(--background)) 65%)",
      }}
      data-testid="section-og-image-preview"
    >
      <div className="flex items-center" data-testid="og-image-preview-logo">
        <UniversalImage
          id={logoId}
          alt="4Geeks"
          loading="eager"
          className="h-10 w-auto max-w-[280px]"
          style={{ objectFit: "contain" }}
          fieldContext={{ fieldPath: "logo" }}
        />
      </div>

      <div className="flex max-w-[920px] flex-col gap-4">
        {labels.length > 0 ? (
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="og-image-preview-category"
          >
            {labels.map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="border-transparent bg-background/35 px-3 py-1 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground backdrop-blur-sm"
              >
                {label}
              </Badge>
            ))}
          </div>
        ) : null}

        <h1
          className="font-heading text-5xl font-bold leading-tight tracking-tight text-foreground"
          data-testid="og-image-preview-title"
        >
          {title}
        </h1>

        {metaLine ? (
          <p
            className="text-lg text-muted-foreground"
            data-testid="og-image-preview-meta"
          >
            {metaLine}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default OgImagePreviewDefault;
