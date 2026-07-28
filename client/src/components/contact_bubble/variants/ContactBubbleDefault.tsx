import { useState } from "react";
import { Pencil, MessageCircle } from "lucide-react";
import type { ContactBubbleSection } from "@shared/schema";
import { getIcon } from "@/lib/icons";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { useSectionContext } from "@/contexts/SectionContext";
import { useOrderedPageSections } from "@/contexts/PageSectionsContext";

const SIZE_PRESETS: Record<string, number> = {
  xs: 36,
  sm: 48,
  md: 64,
  lg: 80,
};

const BUBBLE_GAP = 12;
const BUBBLE_BASE_RIGHT = 24;
const BUBBLE_BASE_BOTTOM = 24;

function resolveSize(size: unknown): number {
  if (typeof size === "number" && size > 0) return size;
  if (typeof size === "string") {
    if (SIZE_PRESETS[size]) return SIZE_PRESETS[size];
    const parsed = Number(size);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return SIZE_PRESETS.md;
}

/**
 * Computes the horizontal offset for this bubble so multiple contact_bubble
 * sections line up in a row at the bottom-right, ordered by page position
 * (the first bubble on the page sits rightmost).
 */
function useBubbleRightOffset(diameter: number): number {
  const ordered = useOrderedPageSections();
  const { sectionIndex } = useSectionContext();

  const bubbles = ordered.filter(
    (s) => (s.data as { type?: string }).type === "contact_bubble",
  );
  if (sectionIndex < 0 || bubbles.length <= 1) return BUBBLE_BASE_RIGHT;

  let offset = BUBBLE_BASE_RIGHT;
  for (const bubble of bubbles) {
    if (bubble.index >= sectionIndex) break;
    offset += resolveSize((bubble.data as { size?: unknown }).size) + BUBBLE_GAP;
  }
  return offset;
}

export default function ContactBubbleDefault({ data }: { data: ContactBubbleSection }) {
  const [hovered, setHovered] = useState(false);
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;
  const { sectionIndex } = useSectionContext();

  const diameter = resolveSize(data.size);
  const hasImage = Boolean(data.img?.url);
  const IconComponent = !hasImage && data.icon ? getIcon(data.icon) : null;
  const iconSize = Math.round(diameter * 0.45);
  const isExternal = /^https?:\/\//.test(data.url);
  const rightOffset = useBubbleRightOffset(diameter);

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("contact-bubble:edit", { detail: { sectionIndex } }),
    );
  };

  const floatingBubble = (
    <div
      className="fixed z-50 flex items-center gap-3 flex-row-reverse group/bubble"
      style={{ bottom: BUBBLE_BASE_BOTTOM, right: rightOffset }}
      data-testid="contact-bubble"
    >
      <div className="relative shrink-0" style={{ width: diameter, height: diameter }}>
        <a
          href={data.url}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          aria-label={data.hover_text || "Contact"}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          onClick={isEditMode ? (e) => e.preventDefault() : undefined}
          className="rounded-full shadow-card overflow-hidden flex items-center justify-center bg-primary text-primary-foreground hover-elevate active-elevate-2 w-full h-full"
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
        {isEditMode && (
          <button
            onClick={handleEditClick}
            className="absolute -top-2 -left-2 p-1.5 rounded-full bg-primary text-primary-foreground shadow-lg opacity-0 group-hover/bubble:opacity-100 transition-opacity duration-150"
            title="Edit contact bubble"
            aria-label="Edit contact bubble"
            data-testid={`button-edit-contact-bubble-${sectionIndex}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
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

  if (isEditMode) {
    return (
      <div className="w-full py-6 px-4" data-testid={`contact-bubble-edit-placeholder-${sectionIndex}`}>
        <div className="max-w-4xl mx-auto border-2 border-dashed border-muted-foreground/30 rounded-lg p-5 bg-muted/20">
          <div className="flex items-center justify-center gap-3 text-muted-foreground">
            <MessageCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">
              Floating contact bubble ({typeof data.size === "number" ? `${diameter}px` : data.size || "md"})
              {data.hover_text ? ` — "${data.hover_text}"` : ""} — shown at the bottom-right of the page
            </span>
          </div>
        </div>
        {floatingBubble}
      </div>
    );
  }

  return floatingBubble;
}
