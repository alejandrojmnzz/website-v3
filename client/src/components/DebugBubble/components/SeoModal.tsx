import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, ArrowRight, ChevronDown, ChevronRight, Code, Eye, EyeOff, FileText, Image, Info, MapPin, Pencil, RefreshCw, Search, Table2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImagePickerDialog } from "@/components/editing/ImagePickerDialog";
import { MappingFieldsTab } from "@/components/editing/MappingFieldsTab";
import { OG_IMAGE_ENSURE_TAGS } from "@shared/standardMediaTags";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ContentInfo, SeoMeta, SeoLocation, SlugCheckStatus } from "../types";

export type SeoModalTab = "general" | "fields" | "schema" | "visibility" | "redirects";

type SchemaOrgPreviewDoc = {
  schema: Record<string, unknown>;
  source: string;
};

export interface SeoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentInfo: ContentInfo;
  seoLoading: boolean;
  seoData: any;
  seoMeta: SeoMeta;
  setSeoMeta: (v: SeoMeta) => void;
  seoLocations: string[];
  setSeoLocations: (v: string[] | ((prev: string[]) => string[])) => void;
  seoAvailableLocations: SeoLocation[];
  seoLocationSearch: string;
  setSeoLocationSearch: (v: string) => void;
  seoSaving: boolean;
  handleSeoSave: () => Promise<void>;
  newSlugValue: string;
  setNewSlugValue: (v: string) => void;
  slugCheckStatus: SlugCheckStatus;
  slugRenaming: boolean;
  slugRedirectPrompt: boolean;
  slugOldUrl: string;
  slugNewUrl: string;
  handleSlugRenameClick: () => void;
  handleSlugRename: (createRedirect: boolean) => Promise<void>;
  currentLocaleSlug: string;
  slugCheckReason: string | null;
  setSlugRedirectPrompt: (v: boolean) => void;
  /** Locale for Fields tab provenance / field_overrides (live locale). */
  locale?: string;
  contentTypeLabel?: string;
  /** Tab to show when the modal opens (defaults to SEO Meta). */
  initialTab?: SeoModalTab;
}

function resolveSchemaPreviewDocs(seoData: any): SchemaOrgPreviewDoc[] {
  const docs = seoData?.schemaOrgDocuments;
  if (Array.isArray(docs) && docs.length > 0) {
    return docs.filter(
      (d: unknown): d is SchemaOrgPreviewDoc =>
        !!d &&
        typeof d === "object" &&
        typeof (d as SchemaOrgPreviewDoc).source === "string" &&
        !!(d as SchemaOrgPreviewDoc).schema,
    );
  }
  const out: SchemaOrgPreviewDoc[] = [];
  if (seoData?.faqSchema) {
    out.push({ schema: seoData.faqSchema, source: "faq" });
  }
  if (Array.isArray(seoData?.schemaOrg)) {
    for (const schema of seoData.schemaOrg) {
      if (!schema || typeof schema !== "object") continue;
      const t = String((schema as Record<string, unknown>)["@type"] ?? "");
      if (t === "FAQPage" && seoData?.faqSchema) continue;
      let source = "schema_org";
      if (t === "FAQPage") source = "faq";
      else if (t === "Article" || t === "BlogPosting") source = "article";
      else if (t === "BreadcrumbList") source = "breadcrumb";
      else if (t === "Organization") source = "organization";
      out.push({ schema, source });
    }
  }
  return out;
}

export function SeoModal({
  open,
  onOpenChange,
  contentInfo,
  seoLoading,
  seoData,
  seoMeta,
  setSeoMeta,
  seoLocations,
  setSeoLocations,
  seoAvailableLocations,
  seoLocationSearch,
  setSeoLocationSearch,
  seoSaving,
  handleSeoSave,
  newSlugValue,
  setNewSlugValue,
  slugCheckStatus,
  slugRenaming,
  slugRedirectPrompt,
  slugOldUrl,
  slugNewUrl,
  handleSlugRenameClick,
  handleSlugRename,
  currentLocaleSlug,
  slugCheckReason,
  setSlugRedirectPrompt,
  locale = "en",
  contentTypeLabel,
  initialTab = "general",
}: SeoModalProps) {
  const [activeTab, setActiveTab] = useState<SeoModalTab>(initialTab);
  const [schemaAdvancedOpen, setSchemaAdvancedOpen] = useState(false);
  const [expandedSchemaDocs, setExpandedSchemaDocs] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);
  const [ogImageError, setOgImageError] = useState(false);
  const [ogImageTooSmall, setOgImageTooSmall] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [snippetEditing, setSnippetEditing] = useState(false);

  const fieldsLocale = locale || contentInfo.locale || "en";
  const fieldsTypeLabel =
    contentTypeLabel ||
    (contentInfo.type
      ? contentInfo.type.charAt(0).toUpperCase() + contentInfo.type.slice(1)
      : "Content type");
  const fieldsVariant = useMemo(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    return q.get("variant") || q.get("force_variant");
  }, [open, contentInfo.type, contentInfo.slug]);

  const { data: ctConfig } = useQuery<{ immutable_slug?: boolean }>({
    queryKey: ["/api/content-types", contentInfo.type, "config"],
    enabled: open && !!contentInfo.type,
    staleTime: 5 * 60 * 1000,
  });
  const slugImmutable = !!ctConfig?.immutable_slug;

  const snippetUrl = seoMeta.canonical_url || (typeof window !== "undefined" ? `${window.location.origin}/${contentInfo.slug || ""}` : "");
  const snippetBreadcrumb = (() => {
    try {
      const u = new URL(snippetUrl);
      const parts = (u.hostname + u.pathname).replace(/\/$/, "").split("/");
      return parts.join(" › ");
    } catch {
      return snippetUrl;
    }
  })();
  const snippetDomain = (() => {
    try { return new URL(snippetUrl).hostname; } catch { return ""; }
  })();

  return (
    <>
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) setImagePickerOpen(false); onOpenChange(isOpen); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>SEO & Meta Tags</DialogTitle>
          <DialogDescription>
            {contentInfo.slug ? `${contentInfo.label}: ${contentInfo.slug}` : "Page SEO settings"}
          </DialogDescription>
        </DialogHeader>

        {seoLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading SEO data...</p>
          </div>
        ) : seoData ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="inline-flex h-auto w-auto max-w-full flex-wrap justify-start" data-testid="tabs-seo-nav">
              <TabsTrigger value="general" data-testid="tab-general" className="flex items-center justify-center gap-1.5 px-2.5" title="SEO Meta" aria-label="SEO Meta">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">SEO Meta</span>
              </TabsTrigger>
              <TabsTrigger value="fields" data-testid="tab-fields" className="flex items-center justify-center gap-1.5 px-2.5" title="Fields" aria-label="Fields">
                <Table2 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Fields</span>
              </TabsTrigger>
              <TabsTrigger value="schema" data-testid="tab-schema" className="flex items-center justify-center gap-1.5 px-2.5" title="Schema" aria-label="Schema">
                <Code className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Schema</span>
              </TabsTrigger>
              <TabsTrigger value="visibility" data-testid="tab-visibility" className="flex items-center justify-center gap-1.5 px-2.5" title="Visibility" aria-label="Visibility">
                {seoMeta.robots && seoMeta.robots.includes("noindex") ? (
                  <EyeOff className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <Eye className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="hidden sm:inline">Visibility</span>
              </TabsTrigger>
              <TabsTrigger value="redirects" data-testid="tab-redirects" className="flex items-center justify-center gap-1.5 px-2.5" title="Redirects" aria-label="Redirects">
                <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Redirects</span>
              </TabsTrigger>
            </TabsList>

            {/* ── SEO Meta tab ───────────────────────────────────────── */}
            <TabsContent value="general" className="space-y-6 pt-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>
                  These fields live under <code className="font-mono">meta:</code> in the entry YAML.
                  Sections can read them as <code className="font-mono">{"{{ meta.page_title }}"}</code>,{" "}
                  <code className="font-mono">{"{{ meta.description }}"}</code>, etc.
                </p>
                <p>
                  Type fields / DB mappings are on the <strong>Fields</strong> tab (
                  <code className="font-mono">{"{{ single.* }}"}</code>
                  ) — not here.
                </p>
              </div>

              {/* Page Slug */}
              {contentInfo.type && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold">Page Slug</h4>
                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{currentLocaleSlug}</code>
                  </div>
                  <div className="space-y-1">
                    <div className="flex gap-2">
                      <input
                        id="slug-editor-input"
                        type="text"
                        value={newSlugValue}
                        onChange={(e) => setNewSlugValue(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
                        placeholder={currentLocaleSlug}
                        className={`flex-1 min-w-0 px-3 py-2 text-sm font-mono rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring ${slugCheckStatus === "taken" ? "border-destructive" : slugCheckStatus === "available" ? "border-green-500" : ""}`}
                        data-testid="input-slug-editor"
                        disabled={slugRenaming || slugImmutable}
                      />
                      {slugImmutable && (
                        <p className="text-xs text-muted-foreground" data-testid="text-slug-immutable">
                          Slug is immutable for this content type (authors).
                        </p>
                      )}
                      {newSlugValue && newSlugValue !== currentLocaleSlug && !slugRedirectPrompt && !slugImmutable && (
                        <>
                          <Button
                            size="sm"
                            onClick={handleSlugRenameClick}
                            disabled={slugCheckStatus !== "available" || slugRenaming}
                            data-testid="button-rename-slug"
                          >
                            {slugRenaming ? "Renaming…" : "Apply"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setNewSlugValue(currentLocaleSlug)}
                            disabled={slugRenaming}
                            data-testid="button-reset-slug"
                          >
                            Reset
                          </Button>
                        </>
                      )}
                    </div>
                    {slugCheckStatus === "checking" && (
                      <p className="text-xs text-muted-foreground">Checking availability…</p>
                    )}
                    {slugCheckStatus === "available" && (
                      <p className="text-xs text-green-600">Slug is available</p>
                    )}
                    {slugCheckStatus === "taken" && slugCheckReason && (
                      <p className="text-xs text-destructive">{slugCheckReason}</p>
                    )}
                  </div>

                  {slugRedirectPrompt && (
                    <div className="space-y-3 rounded-md border p-3">
                      <p className="text-sm font-medium">Create a redirect?</p>
                      <p className="text-xs text-muted-foreground">
                        Do you want to create a redirect from the old URLs to the new ones? This ensures existing links and bookmarks still work.
                      </p>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <code className="bg-muted px-1.5 py-0.5 rounded truncate">{slugOldUrl}</code>
                          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <code className="bg-muted px-1.5 py-0.5 rounded truncate">{slugNewUrl}</code>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          onClick={() => handleSlugRename(true)}
                          disabled={slugRenaming}
                          data-testid="button-rename-with-redirect"
                        >
                          {slugRenaming ? "Renaming..." : "Yes, create redirect"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSlugRename(false)}
                          disabled={slugRenaming}
                          data-testid="button-rename-without-redirect"
                        >
                          No, just rename
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSlugRedirectPrompt(false)}
                          disabled={slugRenaming}
                          data-testid="button-cancel-rename"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Search Snippet */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <h4 className="text-sm font-semibold">Search Snippet</h4>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setSnippetEditing(e => !e)}
                    data-testid="button-toggle-snippet-edit"
                    title={snippetEditing ? "Show preview" : "Edit snippet"}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {!snippetEditing ? (
                  /* ── Preview card ── */
                  <div className="space-y-3">
                    {/* Google SERP preview */}
                    <div
                      className="rounded-md border bg-background px-4 py-3 space-y-0.5 cursor-pointer hover-elevate"
                      onClick={() => setSnippetEditing(true)}
                      data-testid="card-serp-preview"
                      title="Click to edit"
                    >
                      <p className="text-[11px] text-[#0d652d] dark:text-[#81c995] truncate" data-testid="text-serp-breadcrumb">
                        {snippetBreadcrumb || "your-site.com"}
                      </p>
                      <p className="text-sm font-medium text-[#1558d6] dark:text-[#8ab4f8] leading-snug line-clamp-1" data-testid="text-serp-title">
                        {seoMeta.page_title || <span className="text-muted-foreground italic font-normal">No title set — click to edit</span>}
                      </p>
                      <p className="text-xs text-[#4d5156] dark:text-[#bdc1c6] line-clamp-2 leading-relaxed" data-testid="text-serp-description">
                        {seoMeta.description || <span className="italic">No description set — click to edit</span>}
                      </p>
                    </div>

                    {/* Social / OG card preview */}
                    <div
                      className="rounded-md border overflow-hidden cursor-pointer hover-elevate"
                      onClick={() => setSnippetEditing(true)}
                      data-testid="card-og-preview"
                      title="Click to edit social image"
                    >
                      <div className="bg-muted flex items-center justify-center overflow-hidden" style={{ aspectRatio: "1200/630", maxHeight: "140px" }}>
                        {seoMeta.og_image && !ogImageError ? (
                          <img
                            src={seoMeta.og_image}
                            alt="og:image preview"
                            className="object-cover w-full h-full"
                            onError={() => { setOgImageError(true); setOgImageTooSmall(false); }}
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              setOgImageTooSmall(img.naturalWidth < 1200 || img.naturalHeight < 630);
                            }}
                            data-testid="img-og-image-preview"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                            <Image className="h-6 w-6" />
                            <p className="text-xs">{ogImageError ? "Could not load image" : "No social image set"}</p>
                          </div>
                        )}
                      </div>
                      <div className="px-3 py-2 border-t bg-muted/40">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{snippetDomain || "your-site.com"}</p>
                        <p className="text-xs font-medium line-clamp-1 text-foreground mt-0.5" data-testid="text-og-card-title">
                          {seoMeta.page_title || <span className="text-muted-foreground italic font-normal">No title</span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5" data-testid="text-og-card-description">
                          {seoMeta.description || ""}
                        </p>
                      </div>
                    </div>
                    {ogImageTooSmall && !ogImageError && seoMeta.og_image && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1" data-testid="text-og-image-too-small">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                        Social image is smaller than 1200×630 px — it may appear blurry or cropped.
                      </p>
                    )}
                  </div>
                ) : (
                  /* ── Edit form ── */
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-page-title">
                        Page Title
                      </label>
                      <input
                        id="seo-page-title"
                        type="text"
                        value={seoMeta.page_title}
                        onChange={(e) => setSeoMeta({ ...seoMeta, page_title: e.target.value })}
                        placeholder="e.g. Full Stack Developer Program | 4Geeks"
                        className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        data-testid="input-seo-page-title"
                        autoFocus
                      />
                      <p className={`text-xs ${seoMeta.page_title.length > 60 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {seoMeta.page_title.length}/60 characters (recommended)
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-description">
                        Description
                      </label>
                      <textarea
                        id="seo-description"
                        value={seoMeta.description}
                        onChange={(e) => setSeoMeta({ ...seoMeta, description: e.target.value })}
                        placeholder="e.g. Learn full stack development with unlimited mentorship..."
                        rows={3}
                        className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                        data-testid="input-seo-description"
                      />
                      <p className={`text-xs ${seoMeta.description.length > 160 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {seoMeta.description.length}/160 characters (recommended)
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-og-image">
                        Social Image (og:image)
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        <input
                          id="seo-og-image"
                          type="url"
                          value={seoMeta.og_image}
                          onChange={(e) => {
                            setSeoMeta({ ...seoMeta, og_image: e.target.value });
                            setOgImageError(false);
                            setOgImageTooSmall(false);
                          }}
                          placeholder="e.g. https://4geeks.com/images/social-preview.jpg"
                          className="flex-1 min-w-0 px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                          data-testid="input-seo-og-image"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setImagePickerOpen(true)}
                          data-testid="button-seo-og-image-picker"
                        >
                          <Image className="h-4 w-4 mr-1.5" />
                          Choose from gallery
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Recommended size: 1200×630 px.
                      </p>
                      {seoMeta.og_image && (
                        <>
                          <div className="mt-1.5 rounded-md border bg-muted max-h-[120px] flex items-center justify-center overflow-hidden" style={{ aspectRatio: "1200/630" }}>
                            {ogImageError ? (
                              <p className="text-xs text-muted-foreground px-4 text-center" data-testid="text-og-image-error">
                                Could not load image — check that the URL is publicly accessible.
                              </p>
                            ) : (
                              <img
                                src={seoMeta.og_image}
                                alt="og:image preview"
                                className="object-cover w-full h-full"
                                onError={() => { setOgImageError(true); setOgImageTooSmall(false); }}
                                onLoad={(e) => {
                                  const img = e.currentTarget;
                                  setOgImageTooSmall(img.naturalWidth < 1200 || img.naturalHeight < 630);
                                }}
                                data-testid="img-og-image-preview"
                              />
                            )}
                          </div>
                          {ogImageTooSmall && !ogImageError && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1" data-testid="text-og-image-too-small">
                              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                              Image is smaller than the recommended 1200×630 px — it may appear blurry or cropped when shared on social media.
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSnippetEditing(false)}
                      data-testid="button-snippet-done"
                    >
                      Done editing
                    </Button>
                  </div>
                )}
              </div>

              {/* Canonical URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="seo-canonical-url">
                  Canonical URL
                </label>
                <input
                  id="seo-canonical-url"
                  type="text"
                  value={seoMeta.canonical_url}
                  onChange={(e) => setSeoMeta({ ...seoMeta, canonical_url: e.target.value })}
                  placeholder="e.g. https://4geeks.com/en/career-programs/full-stack"
                  className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="input-seo-canonical-url"
                />
              </div>
            </TabsContent>

            {/* ── Fields tab ─────────────────────────────────────────── */}
            <TabsContent value="fields" className="pt-1">
              {contentInfo.type && contentInfo.slug ? (
                <MappingFieldsTab
                  contentType={contentInfo.type}
                  slug={contentInfo.slug}
                  locale={fieldsLocale}
                  typeLabel={fieldsTypeLabel}
                  variant={fieldsVariant}
                />
              ) : (
                <p className="text-sm text-muted-foreground pt-4">
                  Open from a content entry to manage content-type fields.
                </p>
              )}
            </TabsContent>

            {/* ── Schema tab (read-only preview) ─────────────────────── */}
            <TabsContent value="schema" className="space-y-6 pt-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground space-y-2" data-testid="banner-schema-education">
                <p className="text-foreground font-medium flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  How Schema.org works on this page
                </p>
                <p>
                  Schema.org comes from leading <code className="font-mono">schema_org</code> sections plus FAQ, Article, and Breadcrumb contributors.
                  Site Organization/Website in <code className="font-mono">schema-org.yml</code> are templates (prefill + dual-emit + social defaults).
                  WebSite/Organization belong on the home page as <code className="font-mono">schema_org</code> sections; elsewhere they are page-local overrides. Course hero needs a Course companion section.
                </p>
                <p>
                  This tab is a read-only preview of resolved JSON-LD. Edit sections on the page (or SEO &amp; GEO → Schema.org for site templates) — legacy <code className="font-mono">schema.include</code> is removed and ignored.
                </p>
                <Collapsible open={schemaAdvancedOpen} onOpenChange={setSchemaAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      data-testid="button-schema-read-more"
                    >
                      Read more (advanced)
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${schemaAdvancedOpen ? "rotate-180" : ""}`} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2 space-y-0.5 font-mono text-[11px]">
                    <p>shared/component-registry/schema_org/v1.0/</p>
                    <p>server/schema-components/</p>
                    <p>shared/schema-org-sections.ts</p>
                    <p>server/schema-org-seed.ts</p>
                    <p>schema-org.yml</p>
                    <p>client/src/components/settings/SchemaOrgTab.tsx</p>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {(() => {
                const previewDocs = resolveSchemaPreviewDocs(seoData);
                if (previewDocs.length === 0) {
                  return (
                    <div className="rounded-md border border-dashed px-3 py-6 text-center space-y-1" data-testid="empty-schema-documents">
                      <p className="text-sm text-foreground">No JSON-LD documents on this page yet</p>
                      <p className="text-xs text-muted-foreground">
                        Add a leading <code className="font-mono">schema_org</code> section (or FAQ / Article / Breadcrumb) to emit structured data.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-3" data-testid="list-schema-documents">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">Resolved JSON-LD</h4>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        {previewDocs.length} document{previewDocs.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {previewDocs.map((doc, i) => {
                      const typeLabel = String(doc.schema["@type"] ?? "Document");
                      const expanded = expandedSchemaDocs[i] ?? i === 0;
                      return (
                        <div key={i} className="rounded-md border overflow-hidden" data-testid={`schema-document-${i}`}>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSchemaDocs((prev) => ({ ...prev, [i]: !expanded }))
                            }
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover-elevate"
                            data-testid={`button-toggle-schema-doc-${i}`}
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <span className="text-sm font-medium font-mono truncate">{typeLabel}</span>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium uppercase tracking-wide"
                              data-testid={`badge-schema-source-${doc.source}`}
                            >
                              {doc.source}
                            </span>
                          </button>
                          {expanded && (
                            <pre
                              className="bg-muted/60 p-3 text-xs font-mono max-h-[240px] overflow-y-auto whitespace-pre-wrap break-all border-t"
                              data-testid={`text-schema-doc-preview-${i}`}
                            >
                              {JSON.stringify(doc.schema, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </TabsContent>

            {/* ── Visibility tab ─────────────────────────────────────── */}
            <TabsContent value="visibility" className="space-y-6 pt-4">

              {/* Robots */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold">Robots</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Control how search engines crawl and index this page.
                  </p>
                </div>
                <div className="space-y-1.5" data-testid="select-seo-robots">
                  {([
                    { value: "", label: "index, follow", description: "Show in search results and follow all links on this page. Recommended for most pages." },
                    { value: "noindex", label: "noindex", description: "Hide from search results but still follow links. Useful for private or duplicate pages." },
                    { value: "noindex, nofollow", label: "noindex, nofollow", description: "Hide from search results and don't follow any links. Use for pages you never want crawled." },
                  ] as const).map(({ value, label, description }) => (
                    <label
                      key={value}
                      className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer hover-elevate ${(seoMeta.robots === value) ? "border-ring bg-muted/50" : ""}`}
                      data-testid={`option-seo-robots-${value || "default"}`}
                    >
                      <input
                        type="radio"
                        name="seo-robots"
                        value={value}
                        checked={seoMeta.robots === value}
                        onChange={() => setSeoMeta({ ...seoMeta, robots: value })}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="space-y-0.5">
                        <p className="text-xs font-mono font-medium text-foreground leading-none">{label}{value === "" && <span className="ml-1.5 text-muted-foreground font-sans font-normal">(default)</span>}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="seo-priority">
                  Priority
                </label>
                <input
                  id="seo-priority"
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={seoMeta.priority}
                  onChange={(e) => setSeoMeta({ ...seoMeta, priority: e.target.value })}
                  placeholder="e.g. 0.8"
                  className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="input-seo-priority"
                />
                <p className="text-xs text-muted-foreground">
                  Sitemap crawl priority (0.0–1.0). Leave empty to use the default.
                </p>
              </div>

              {/* Change Frequency */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="seo-change-frequency">
                  Change Frequency
                </label>
                <select
                  id="seo-change-frequency"
                  value={seoMeta.change_frequency}
                  onChange={(e) => setSeoMeta({ ...seoMeta, change_frequency: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="select-seo-change-frequency"
                >
                  <option value="">Default</option>
                  <option value="always">always</option>
                  <option value="hourly">hourly</option>
                  <option value="daily">daily</option>
                  <option value="weekly">weekly</option>
                  <option value="monthly">monthly</option>
                  <option value="yearly">yearly</option>
                  <option value="never">never</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  How frequently the page content is likely to change. Used in the sitemap.
                </p>
              </div>

              {/* Locations (landing pages only) */}
              {contentInfo.type === "landing" && seoAvailableLocations.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      Locations
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        {seoLocations.length === 0 ? "All (session-based)" : `${seoLocations.length} selected`}
                      </span>
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Choose which campus locations appear on this landing page. If none are selected, the visitor's nearest location is used automatically.
                    </p>
                  </div>

                  {seoLocations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {seoLocations.map((locSlug) => {
                        const locInfo = seoAvailableLocations.find(l => l.slug === locSlug);
                        return (
                          <span
                            key={locSlug}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-sm"
                            data-testid={`chip-location-${locSlug}`}
                          >
                            <span className="truncate max-w-[180px]">
                              {locInfo ? `${locInfo.city}, ${locInfo.country}` : locSlug}
                            </span>
                            <button
                              onClick={() => setSeoLocations(prev => prev.filter(s => s !== locSlug))}
                              className="ml-0.5 rounded-sm hover-elevate"
                              data-testid={`button-remove-location-${locSlug}`}
                            >
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          </span>
                        );
                      })}
                      <button
                        onClick={() => setSeoLocations([])}
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                        data-testid="button-clear-all-locations"
                      >
                        Clear all
                      </button>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={seoLocationSearch}
                      onChange={(e) => setSeoLocationSearch(e.target.value)}
                      placeholder="Search locations..."
                      className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      data-testid="input-location-search"
                    />
                    <div className="max-h-[160px] overflow-y-auto rounded-md border">
                      {seoAvailableLocations
                        .filter(loc => {
                          if (seoLocations.includes(loc.slug)) return false;
                          if (!seoLocationSearch) return true;
                          const q = seoLocationSearch.toLowerCase();
                          return loc.name.toLowerCase().includes(q)
                            || loc.city.toLowerCase().includes(q)
                            || loc.country.toLowerCase().includes(q)
                            || loc.slug.toLowerCase().includes(q);
                        })
                        .map(loc => (
                          <button
                            key={loc.slug}
                            onClick={() => setSeoLocations(prev => [...prev, loc.slug])}
                            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover-elevate"
                            data-testid={`button-add-location-${loc.slug}`}
                          >
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span>{loc.city}, {loc.country}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{loc.slug}</span>
                          </button>
                        ))
                      }
                      {seoAvailableLocations.filter(loc => {
                        if (seoLocations.includes(loc.slug)) return false;
                        if (!seoLocationSearch) return true;
                        const q = seoLocationSearch.toLowerCase();
                        return loc.name.toLowerCase().includes(q)
                          || loc.city.toLowerCase().includes(q)
                          || loc.country.toLowerCase().includes(q)
                          || loc.slug.toLowerCase().includes(q);
                      }).length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                          {seoLocationSearch ? "No matching locations" : "All locations already added"}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── Redirects tab ──────────────────────────────────────── */}
            <TabsContent value="redirects" className="space-y-4 pt-4">
              <div>
                <h4 className="text-sm font-semibold">Redirects</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Old URL paths that should redirect to this page (301). Each entry is a path relative to the site root, e.g. <code className="font-mono bg-muted px-1 rounded">/old-page-slug</code>.
                </p>
              </div>

              {seoMeta.redirects.length > 0 ? (
                <div className="space-y-1.5">
                  {seoMeta.redirects.map((redirect, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border bg-muted/40 text-sm font-mono"
                      data-testid={`row-redirect-${idx}`}
                    >
                      <span className="flex-1 truncate text-xs">{redirect}</span>
                      <button
                        onClick={() => setSeoMeta({ ...seoMeta, redirects: seoMeta.redirects.filter((_, i) => i !== idx) })}
                        className="shrink-0 rounded-sm hover-elevate"
                        data-testid={`button-remove-redirect-${idx}`}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-redirects-note">
                <Info className="h-3.5 w-3.5 shrink-0" />
                To add or update redirects, visit the{" "}
                <a
                  href="/private/redirects"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                  data-testid="link-redirects-page"
                >
                  Redirects page
                </a>.
              </p>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertTriangle className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Could not load SEO data for this page.</p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-seo"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSeoSave}
            disabled={seoSaving || seoLoading || !seoData}
            data-testid="button-save-seo"
          >
            {seoSaving ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ImagePickerDialog
      open={imagePickerOpen}
      onOpenChange={setImagePickerOpen}
      title="Choose Social Image"
      defaultTagFilter="og-image"
      ensureTagsOnSave={[...OG_IMAGE_ENSURE_TAGS]}
      initialSrc={seoMeta.og_image}
      onSave={(src) => {
        setSeoMeta({ ...seoMeta, og_image: src });
        setOgImageError(false);
        setOgImageTooSmall(false);
      }}
    />
    </>
  );
}
