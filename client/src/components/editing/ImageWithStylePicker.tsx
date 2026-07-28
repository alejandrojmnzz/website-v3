import { useState } from "react";
import { ChevronDown, Image } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { ImageRegistry } from "@shared/schema";
import { ImagePickerDialog } from "./ImagePickerDialog";
import { BRAND_LOGO_ENSURE_TAGS } from "@shared/standardMediaTags";

export interface ImageWithStylePickerProps {
  label: string;
  value: string;
  alt?: string;
  objectFit?: string;
  objectPosition?: string;
  tagFilter?: string;
  /** Standard tags applied on gallery Save (e.g. logo + brand). */
  ensureTagsOnSave?: string[];
  testId?: string;
  disabled?: boolean;
  onChangeSrc: (src: string, alt: string, registryId?: string) => void;
  onChangeAlt?: (alt: string) => void;
  onChangeObjectFit?: (fit: string) => void;
  onChangeObjectPosition?: (position: string) => void;
  onRemove?: () => void;
}

export function ImageWithStylePicker({
  label,
  value,
  alt = "",
  objectFit = "",
  objectPosition = "",
  tagFilter,
  ensureTagsOnSave,
  testId = "image-style",
  disabled = false,
  onChangeSrc,
  onChangeAlt,
  onChangeObjectFit,
  onChangeObjectPosition,
  onRemove,
}: ImageWithStylePickerProps) {
  const { toast } = useToast();

  const { data: imageRegistry } = useQuery<ImageRegistry>({
    queryKey: ["/api/image-registry"],
  });

  const [pickerOpen, setPickerOpen] = useState(false);

  const displaySrc = !value ? "" : (imageRegistry?.images?.[value]?.src || value);

  const handleSave = async (src: string, pickedAlt: string, registryId: string | undefined) => {
    onChangeSrc(src, pickedAlt, registryId);
    if (registryId) {
      fetch(`/api/media/classify/${encodeURIComponent(registryId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tagFilter ? { context: { tagFilter } } : {}),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { added?: string[] } | null) => {
          if (data?.added && data.added.length > 0) {
            toast({
              title: "Tags added",
              description: `Added ${data.added.length} tag(s): ${data.added.join(", ")}`,
            });
          }
        })
        .catch(() => {});
    }
  };

  return (
    <>
      <Collapsible className="border rounded-md">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={`w-full flex items-center gap-3 p-3 transition-colors ${disabled ? "opacity-60 cursor-default" : "hover:bg-muted/50"}`}
            data-testid={`${testId}-trigger`}
          >
            <div className="w-10 h-10 rounded-md overflow-hidden bg-muted border flex-shrink-0">
              {displaySrc ? (
                <img src={displaySrc} alt={alt || label} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Image className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
            <span className="flex-1 text-left text-sm font-medium">{label}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-3 pt-0 space-y-3 border-t">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={disabled ? undefined : () => setPickerOpen(true)}
                disabled={disabled}
                className="relative w-16 h-16 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group flex-shrink-0 disabled:cursor-default disabled:opacity-60"
                data-testid={`${testId}-picker`}
                title={disabled ? "Read-only" : "Change image"}
              >
                {displaySrc ? (
                  <>
                    <img src={displaySrc} alt={alt} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Image className="h-5 w-5 text-white" />
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Image className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
              </button>
              {onChangeAlt !== undefined && (
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Alt text</Label>
                  <Input
                    value={alt}
                    onChange={(e) => onChangeAlt(e.target.value)}
                    placeholder="Image description"
                    className="h-8 text-sm"
                    data-testid={`${testId}-alt`}
                  />
                </div>
              )}
            </div>

            {(onChangeObjectFit !== undefined || onChangeObjectPosition !== undefined) && (
              <div className="grid grid-cols-2 gap-3">
                {onChangeObjectFit !== undefined && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Object Fit</Label>
                    <Select value={objectFit || "cover"} onValueChange={onChangeObjectFit}>
                      <SelectTrigger className="h-8 text-sm" data-testid={`${testId}-object-fit`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cover">Cover (crops)</SelectItem>
                        <SelectItem value="contain">Contain (fits)</SelectItem>
                        <SelectItem value="fill">Fill (stretch)</SelectItem>
                        <SelectItem value="none">None (original)</SelectItem>
                        <SelectItem value="scale-down">Scale Down</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {onChangeObjectPosition !== undefined && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Position (X Y)</Label>
                    <Input
                      value={objectPosition}
                      onChange={(e) => onChangeObjectPosition(e.target.value)}
                      placeholder="center center"
                      className="h-8 text-sm"
                      data-testid={`${testId}-object-position`}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <ImagePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={tagFilter ? `Select ${tagFilter.charAt(0).toUpperCase() + tagFilter.slice(1)}` : "Select Image"}
        initialSrc={value}
        initialAlt={alt}
        tagFilter={tagFilter}
        ensureTagsOnSave={
          ensureTagsOnSave ??
          (tagFilter === "logo" ? [...BRAND_LOGO_ENSURE_TAGS] : undefined)
        }
        onSave={handleSave}
        onRemove={onRemove}
      />
    </>
  );
}
