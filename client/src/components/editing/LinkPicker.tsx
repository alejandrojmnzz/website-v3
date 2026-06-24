import { useState, useEffect } from "react";
import { ArrowDown, Check, ExternalLink, Layers, Link, PanelBottom, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Section } from "@shared/schema";
import addSectionImg from "@assets/add-section-explanation_1771275660234.png";

type LinkType = "internal" | "external" | "modal" | "scroll" | "inline";

interface SitemapEntry {
  loc: string;
  label: string;
}

interface SectionOption {
  id: string;
  label: string;
  type: string;
}

interface RemoteSection {
  type: string;
  section_id: string | null;
  label: string;
}

function extractPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

function detectLinkType(value: string, modals: SectionOption[], scrollSections: SectionOption[]): LinkType {
  if (!value) return "internal";
  if (value.startsWith("inline#")) return "inline";
  if (value.startsWith("http://") || value.startsWith("https://")) return "external";
  if (value.startsWith("#")) {
    const anchor = value.slice(1);
    if (modals.some((m) => m.id === anchor)) return "modal";
    if (scrollSections.some((s) => s.id === anchor)) return "scroll";
    return "scroll";
  }
  return "internal";
}

function extractSectionsFromYaml(allSections?: Section[]): {
  modals: SectionOption[];
  scrollSections: SectionOption[];
  inlineSections: SectionOption[];
} {
  const modals: SectionOption[] = [];
  const scrollSections: SectionOption[] = [
    { id: "top", label: "Top of page", type: "built-in" },
    { id: "bottom", label: "Bottom of page", type: "built-in" },
  ];
  const inlineSections: SectionOption[] = [];
  if (!allSections) return { modals, scrollSections, inlineSections };

  allSections.forEach((section, index) => {
    const raw = section as Record<string, unknown>;
    const sectionType = (raw.type as string) || "";
    const sectionId = (raw.section_id as string) || "";
    const title = (raw.title as string) || (raw.heading as string) || (raw.path_name as string) || "";

    if (sectionType === "modal") {
      if (sectionId) {
        modals.push({ id: sectionId, label: title || sectionId, type: sectionType });
      }
    } else {
      const id = sectionId || `${sectionType}-${index}`;
      scrollSections.push({
        id,
        label: title || `${sectionType} (section ${index + 1})`,
        type: sectionType,
      });
      if (sectionId) {
        inlineSections.push({ id: sectionId, label: title || sectionId, type: sectionType });
      }
    }
  });

  return { modals, scrollSections, inlineSections };
}

function extractSectionsFromRemote(remoteSections: RemoteSection[]): {
  modals: SectionOption[];
  scrollSections: SectionOption[];
  inlineSections: SectionOption[];
} {
  const modals: SectionOption[] = [];
  const scrollSections: SectionOption[] = [
    { id: "top", label: "Top of page", type: "built-in" },
    { id: "bottom", label: "Bottom of page", type: "built-in" },
  ];
  const inlineSections: SectionOption[] = [];

  remoteSections.forEach((s, index) => {
    if (s.type === "modal") {
      if (s.section_id) {
        modals.push({ id: s.section_id, label: s.label, type: s.type });
      }
    } else {
      const id = s.section_id || `${s.type}-${index}`;
      scrollSections.push({ id, label: s.label, type: s.type });
      if (s.section_id) {
        inlineSections.push({ id: s.section_id, label: s.label, type: s.type });
      }
    }
  });

  return { modals, scrollSections, inlineSections };
}

interface LinkPickerProps {
  value: string;
  onChange: (value: string) => void;
  locale?: string;
  allSections?: Section[];
  contextPath?: string;
  testId?: string;
  portalContainer?: HTMLElement | null;
  compact?: boolean;
  allowedTypes?: LinkType[];
  allowInlineRender?: boolean;
}

export function LinkPicker({ value, onChange, locale = "en", allSections, contextPath, testId = "link-picker", portalContainer, compact = false, allowedTypes, allowInlineRender = false }: LinkPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [customUrl, setCustomUrl] = useState(value || "");
  const [customError, setCustomError] = useState("");

  const { data: remoteSectionsData, isLoading: remoteSectionsLoading } = useQuery<{ sections: RemoteSection[] }>({
    queryKey: ["/api/page-sections", contextPath, locale],
    queryFn: async () => {
      const response = await fetch(`/api/page-sections?path=${encodeURIComponent(contextPath!)}&locale=${locale}`);
      if (!response.ok) throw new Error("Failed to load page sections");
      return response.json();
    },
    enabled: !!contextPath && open,
  });

  const { modals, scrollSections, inlineSections } = (() => {
    if (contextPath && remoteSectionsData) {
      return extractSectionsFromRemote(remoteSectionsData.sections);
    }
    return extractSectionsFromYaml(allSections);
  })();

  const [activeType, setActiveType] = useState<LinkType>(() => detectLinkType(value, modals, scrollSections));

  useEffect(() => {
    setCustomUrl(value || "");
    setActiveType(detectLinkType(value, modals, scrollSections));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const { data: sitemapUrls = [], isLoading: sitemapLoading } = useQuery<SitemapEntry[]>({
    queryKey: ["/api/sitemap-urls", locale],
    queryFn: async () => {
      const response = await fetch(`/api/sitemap-urls?locale=${locale}`);
      if (!response.ok) throw new Error("Failed to load sitemap URLs");
      return response.json();
    },
  });

  const filteredSitemapUrls = (() => {
    if (!searchQuery.trim()) return sitemapUrls;
    const query = searchQuery.toLowerCase();
    return sitemapUrls.filter(
      (entry) =>
        entry.loc.toLowerCase().includes(query) ||
        entry.label.toLowerCase().includes(query)
    );
  })();

  const handleSelect = (url: string) => {
    onChange(url);
    setOpen(false);
    setSearchQuery("");
  };

  const hasLocalePrefix = (url: string) => /^\/[a-z]{2}(\/|$)/i.test(url.trim());

  const handleExternalSubmit = () => {
    const trimmed = customUrl.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setCustomError("External URLs must start with http:// or https://");
      return;
    }
    setCustomError("");
    onChange(trimmed);
    setOpen(false);
  };

  const handleInternalCustomSubmit = () => {
    const trimmed = customUrl.trim();
    if (!trimmed) return;
    if (hasLocalePrefix(trimmed)) {
      setCustomError("URLs cannot start with a locale prefix like /en/ or /es/. Use the page search above instead.");
      return;
    }
    if (trimmed.startsWith("http")) {
      setCustomError("Use the 'External URL' tab for http links.");
      return;
    }
    setCustomError("");
    onChange(trimmed);
    setOpen(false);
  };

  const allTypeOptions: { type: LinkType; icon: typeof Link; label: string }[] = [
    { type: "internal", icon: Link, label: "Page" },
    { type: "external", icon: ExternalLink, label: "External" },
    { type: "modal", icon: PanelBottom, label: "Modal" },
    { type: "scroll", icon: ArrowDown, label: "Section" },
    ...(allowInlineRender ? [{ type: "inline" as LinkType, icon: Layers, label: "Render inline" }] : []),
  ];
  const typeOptions = allowedTypes
    ? allTypeOptions.filter((o) => allowedTypes.includes(o.type))
    : allTypeOptions;

  const displayValue = value || "No link set";
  const isExternal = value?.startsWith("http");
  const isHash = value?.startsWith("#");
  const isInlineLink = value?.startsWith("inline#");

  const displayIcon = isInlineLink
    ? Layers
    : isExternal
      ? ExternalLink
      : isHash
        ? (modals.some(m => `#${m.id}` === value) ? PanelBottom : ArrowDown)
        : Link;

  const DisplayIconComponent = displayIcon;

  const sectionsLoading = !!contextPath && remoteSectionsLoading;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-1.5 text-xs rounded-md transition-colors hover-elevate",
            compact ? "p-1" : "px-2 py-1 max-w-full",
            value
              ? "text-primary/80 bg-primary/5"
              : "text-muted-foreground"
          )}
          data-testid={testId}
        >
          <DisplayIconComponent className="h-3.5 w-3.5 flex-shrink-0" />
          {!compact && <span className="truncate">{displayValue}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 z-[10001]" align="start" container={portalContainer}>
        <div className="flex border-b">
          {typeOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.type}
                onClick={() => {
                  setActiveType(opt.type);
                  setSearchQuery("");
                  setCustomError("");
                  setCustomUrl(value || "");
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors border-b-2",
                  activeType === opt.type
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
                data-testid={`${testId}-tab-${opt.type}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        {activeType === "internal" && (
          <>
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search pages..."
                  className="h-8 pl-8 text-sm"
                  autoFocus
                  data-testid={`${testId}-internal-search`}
                />
              </div>
            </div>
            <ScrollArea className="h-[200px]">
              {sitemapLoading ? (
                <div className="p-4 text-sm text-muted-foreground text-center">Loading pages...</div>
              ) : filteredSitemapUrls.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  {searchQuery ? "No pages found" : "No pages available"}
                </div>
              ) : (
                <div className="p-1">
                  {filteredSitemapUrls.map((entry, index) => {
                    const path = extractPath(entry.loc);
                    return (
                      <button
                        key={entry.loc}
                        onClick={() => handleSelect(path)}
                        className={cn(
                          "w-full text-left px-2 py-1.5 rounded-md text-sm hover-elevate flex items-start gap-2",
                          value === path && "bg-primary/10"
                        )}
                        data-testid={`${testId}-internal-option-${index}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground truncate text-xs">{entry.label}</div>
                          <div className="text-xs text-muted-foreground truncate">{path}</div>
                        </div>
                        {value === path && (
                          <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            <div className="p-2 border-t space-y-2">
              <div className="flex gap-2">
                <Input
                  value={customUrl}
                  onChange={(e) => { setCustomUrl(e.target.value.replace(/\s+/g, "-")); setCustomError(""); }}
                  placeholder="/custom-path"
                  className="h-8 text-sm flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter") handleInternalCustomSubmit(); }}
                  data-testid={`${testId}-internal-custom-input`}
                />
                <Button
                  size="sm"
                  onClick={handleInternalCustomSubmit}
                  data-testid={`${testId}-internal-custom-save`}
                >
                  Save
                </Button>
              </div>
              {customError && <p className="text-xs text-destructive">{customError}</p>}
            </div>
          </>
        )}

        {activeType === "external" && (
          <div className="p-3 space-y-3">
            <p className="text-xs text-muted-foreground">Enter an external URL:</p>
            <div className="flex gap-2">
              <Input
                value={customUrl}
                onChange={(e) => { setCustomUrl(e.target.value); setCustomError(""); }}
                placeholder="https://example.com"
                className="h-8 text-sm flex-1"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleExternalSubmit(); }}
                data-testid={`${testId}-external-input`}
              />
              <Button
                size="sm"
                onClick={handleExternalSubmit}
                data-testid={`${testId}-external-save`}
              >
                Save
              </Button>
            </div>
            {customError && <p className="text-xs text-destructive">{customError}</p>}
          </div>
        )}

        {activeType === "modal" && (
          <ScrollArea className="h-[200px]">
            {sectionsLoading ? (
              <div className="p-4 text-sm text-muted-foreground text-center">Loading sections...</div>
            ) : modals.length === 0 ? (
              <div className="p-4 space-y-3">
                <p className="text-sm font-medium text-foreground text-center">No modals on this page</p>
                <p className="text-xs text-muted-foreground">
                  Modal links open a popup overlay when clicked. To add a modal, add a section with <code className="bg-muted px-1 py-0.5 rounded text-xs">type: modal</code> in your page YAML or using the manual editor with "Edit Mode". It will then appear here for selection.
                </p>
                {!contextPath && <img src={addSectionImg} alt="Use the Add button between sections to insert a new modal section" className="w-full rounded border" />}
              </div>
            ) : (
              <div className="p-1">
                {modals.map((modal, index) => {
                  const hashValue = `#${modal.id}`;
                  return (
                    <button
                      key={modal.id}
                      onClick={() => handleSelect(hashValue)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded-md text-sm hover-elevate flex items-start gap-2",
                        value === hashValue && "bg-primary/10"
                      )}
                      data-testid={`${testId}-modal-option-${index}`}
                    >
                      <PanelBottom className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate text-xs">{modal.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{hashValue}</div>
                      </div>
                      {value === hashValue && (
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}

        {activeType === "scroll" && (
          <ScrollArea className="h-[200px]">
            {sectionsLoading ? (
              <div className="p-4 text-sm text-muted-foreground text-center">Loading sections...</div>
            ) : scrollSections.length === 0 ? (
              <div className="p-4 space-y-2">
                <p className="text-sm font-medium text-foreground text-center">No sections available</p>
                <p className="text-xs text-muted-foreground">
                  Section links scroll the visitor to a specific part of the page. Sections are listed here automatically. To give a section a custom anchor, add a <code className="bg-muted px-1 py-0.5 rounded text-xs">section_id</code> field in your page YAML. The link will use <code className="bg-muted px-1 py-0.5 rounded text-xs">#your-section-id</code>.
                </p>
              </div>
            ) : (
              <div className="p-1">
                {scrollSections.map((section, index) => {
                  const hashValue = `#${section.id}`;
                  return (
                    <button
                      key={section.id}
                      onClick={() => handleSelect(hashValue)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded-md text-sm hover-elevate flex items-start gap-2",
                        value === hashValue && "bg-primary/10"
                      )}
                      data-testid={`${testId}-scroll-option-${index}`}
                    >
                      <ArrowDown className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate text-xs">{section.label}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {hashValue}
                          <span className="ml-1 opacity-60">({section.type})</span>
                        </div>
                      </div>
                      {value === hashValue && (
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}
        {activeType === "inline" && (
          <ScrollArea className="h-[200px]">
            {inlineSections.length === 0 ? (
              <div className="p-4 space-y-2">
                <p className="text-sm font-medium text-foreground text-center">No sections with an ID on this page</p>
                <p className="text-xs text-muted-foreground">
                  Add a{" "}
                  <code className="bg-muted px-1 py-0.5 rounded text-xs">section_id</code> field to any section to make it available as an inline render target.
                </p>
              </div>
            ) : (
              <div className="p-1">
                {inlineSections.map((section, index) => {
                  const inlineValue = `inline#${section.id}`;
                  return (
                    <button
                      key={section.id}
                      onClick={() => handleSelect(inlineValue)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded-md text-sm hover-elevate flex items-start gap-2",
                        value === inlineValue && "bg-primary/10"
                      )}
                      data-testid={`${testId}-inline-option-${index}`}
                    >
                      <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate text-xs">{section.label}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          inline#{section.id}
                          <span className="ml-1 opacity-60">({section.type})</span>
                        </div>
                      </div>
                      {value === inlineValue && (
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
