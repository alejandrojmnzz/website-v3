import type { OgImagePreviewSection } from "@shared/schema";
import UniversalImage from "@/components/UniversalImage";

const DEFAULT_LOGO_ID = "4geeks-devs-logo-1763162063433";

interface OgImagePreviewProps {
  data: OgImagePreviewSection;
}

function formatMetaLine(author?: string, readingTime?: string): string | null {
  const parts = [author?.trim(), readingTime?.trim()].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function OgImagePreviewDefault({ data }: OgImagePreviewProps) {
  const { logo, category, title, author, reading_time } = data;
  const logoId = typeof logo === "string" && logo.length > 0 ? logo : DEFAULT_LOGO_ID;
  const metaLine = formatMetaLine(author, reading_time);
  const categoryLabel = category?.trim();

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
          className="h-10 w-auto max-w-[280px]"
          style={{ objectFit: "contain" }}
          fieldContext={{ fieldPath: "logo" }}
        />
      </div>

      <div className="flex max-w-[920px] flex-col gap-4">
        {categoryLabel ? (
          <p
            className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground"
            data-testid="og-image-preview-category"
          >
            {categoryLabel}
          </p>
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
