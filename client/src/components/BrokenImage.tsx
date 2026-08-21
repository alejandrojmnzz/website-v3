import React from "react";
import { ImageOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type BrokenImageReason = "visitor-blank" | "unknown" | "load-failed";

const REASON_COPY: Record<BrokenImageReason, { title: string; detail: string }> = {
  "visitor-blank": {
    title: "Broken for visitors",
    detail:
      "Visitors would not see this image. The public page only ships a short image catalog; this id is not in it.",
  },
  unknown: {
    title: "Unknown image id",
    detail: "This id is not in the image registry. Pick a gallery image or fix the id in content/menus.",
  },
  "load-failed": {
    title: "Image failed to load",
    detail: "The registry entry exists but the file URL failed (404, network, or corrupt).",
  },
};

interface BrokenImageProps {
  id: string;
  reason: BrokenImageReason;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Edit-mode placeholder when UniversalImage would render blank for visitors
 * (or the id/file is truly broken). Not shown to anonymous visitors or capture iframes.
 */
export function BrokenImage({ id, reason, className = "", style }: BrokenImageProps) {
  const copy = REASON_COPY[reason];
  const truncated = id.length > 28 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-md",
            "border border-dashed border-destructive/60 bg-muted text-muted-foreground",
            "min-h-[1.5rem] min-w-[1.5rem] w-full h-full",
            className,
          )}
          style={style}
          data-testid={`img-broken-${id}`}
          data-broken-reason={reason}
          role="img"
          aria-label={`${copy.title}: ${id}`}
        >
          <ImageOff className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span className="max-w-full truncate px-1 text-[10px] font-mono leading-tight text-destructive/90">
            {truncated}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <p className="font-medium">{copy.title}</p>
        <p className="mt-1 text-muted-foreground">{copy.detail}</p>
        <p className="mt-1 font-mono text-[10px] break-all">{id}</p>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Read more: client/src/components/UniversalImage.tsx · server/image-registry-subset.ts ·
          LogoItem fallbacks in client/src/components/menus/index.tsx
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export default BrokenImage;
