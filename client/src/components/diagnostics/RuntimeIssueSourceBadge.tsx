import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SOURCE_EXPLANATIONS, SOURCE_LABELS, type RuntimeSourceTag } from "@shared/runtime-issues";
import { sourceLabel } from "./runtime-issues-filters";

export function RuntimeIssueSourceBadge({ tag, fingerprint }: { tag: string; fingerprint: string }) {
  const explanation =
    SOURCE_EXPLANATIONS[tag as RuntimeSourceTag] ??
    "This tag was recorded on at least one hit for this path.";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer"
          data-testid={`badge-runtime-source-${fingerprint}-${tag}`}
        >
          <Badge variant="outline" className="text-[10px]">
            {sourceLabel(tag)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-sm" data-testid={`popover-runtime-source-${tag}`}>
        <p className="font-medium text-foreground">{SOURCE_LABELS[tag as RuntimeSourceTag] ?? tag}</p>
        <p className="text-muted-foreground">{explanation}</p>
        <p className="text-xs text-muted-foreground">
          This path had at least one hit of this type in the selected window. Tag sums can exceed Count.
        </p>
      </PopoverContent>
    </Popover>
  );
}
