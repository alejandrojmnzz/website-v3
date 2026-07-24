import { useState } from "react";
import type { ContactBubbleSection } from "@shared/schema";
import { getIcon } from "@/lib/icons";

const SIZE_PRESETS: Record<string, number> = {
  sm: 48,
  md: 64,
  lg: 80,
};

function resolveSize(size: ContactBubbleSection["size"]): number {
  if (typeof size === "number" && size > 0) return size;
  if (typeof size === "string" && SIZE_PRESETS[size]) return SIZE_PRESETS[size];
  return SIZE_PRESETS.md;
}

export default function ContactBubbleDefault({ data }: { data: ContactBubbleSection }) {
  const [hovered, setHovered] = useState(false);
  const diameter = resolveSize(data.size);
  const hasImage = Boolean(data.img?.url);
  const IconComponent = !hasImage && data.icon ? getIcon(data.icon) : null;
  const iconSize = Math.round(diameter * 0.45);
  const isExternal = /^https?:\/\//.test(data.url);

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 flex-row-reverse"
      data-testid="contact-bubble"
    >
      <a
        href={data.url}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        aria-label={data.hover_text || "Contact"}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="rounded-full shadow-card overflow-hidden flex items-center justify-center bg-primary text-primary-foreground hover-elevate active-elevate-2 shrink-0"
        style={{ width: diameter, height: diameter }}
        data-testid="link-contact-bubble"
      >
        {hasImage ? (
          <img
            src={data.img!.url}
            alt={data.img!.alt || ""}
            className="w-full h-full object-cover rounded-full"
            data-testid="img-contact-bubble"
          />
        ) : IconComponent ? (
          <IconComponent size={iconSize} data-testid="icon-contact-bubble" />
        ) : null}
      </a>
      {data.hover_text && (
        <div
          className={`bg-card text-card-foreground border border-card-border rounded-full px-4 py-2 text-sm font-medium shadow-card whitespace-nowrap transition-all duration-200 ${
            hovered
              ? "opacity-100 translate-x-0"
              : "opacity-0 translate-x-2 pointer-events-none"
          }`}
          data-testid="text-contact-bubble-hover"
        >
          {data.hover_text}
        </div>
      )}
    </div>
  );
}
