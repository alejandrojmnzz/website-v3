import { useState, useEffect, useCallback, useRef } from "react";
import { SeoModal, type SeoModalTab } from "@/components/DebugBubble/components/SeoModal";
import type { ContentInfo, SeoMeta, SeoLocation, SlugCheckStatus } from "@/components/DebugBubble/types";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { useContentTypes } from "@/hooks/useContentTypes";
import { normalizeLocale, buildContentUrlFromPattern } from "@/lib/locale";

export interface ManagedSeoModalTarget {
  contentType: string;
  slug: string;
  locale: string;
  /** When set, SEO reads/writes this variant file (draft or A/B). */
  variant?: string;
  initialTab?: SeoModalTab;
}

interface ManagedSeoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ManagedSeoModalTarget | null;
  onSaved?: () => void;
}

const EMPTY_SEO_META: SeoMeta = {
  page_title: "",
  description: "",
  og_image: "",
  canonical_url: "",
  robots: "",
  priority: "",
  change_frequency: "",
  redirects: [],
};

const EDITABLE_META_KEYS = [
  "page_title",
  "description",
  "og_image",
  "canonical_url",
  "robots",
  "priority",
  "change_frequency",
] as const;

type EditableMetaKey = (typeof EDITABLE_META_KEYS)[number];

function redirectsEqual(a: string[], b: unknown): boolean {
  const bArr = Array.isArray(b)
    ? b
        .map((r) => (typeof r === "string" ? r : (r as { path?: string })?.path))
        .filter((r): r is string => Boolean(r))
    : [];
  if (a.length !== bArr.length) return false;
  return a.every((v, i) => v === bArr[i]);
}

function valuesEqual(key: EditableMetaKey | "redirects", formVal: string | string[], liveVal: unknown): boolean {
  if (key === "redirects") {
    return redirectsEqual(formVal as string[], liveVal);
  }
  const liveStr = liveVal == null ? "" : String(liveVal);
  return String(formVal || "") === liveStr;
}

export function ManagedSeoModal({ open, onOpenChange, target, onSaved }: ManagedSeoModalProps) {
  const { toast } = useToast();
  const contentTypesMap = useContentTypes();

  const [seoLoading, setSeoLoading] = useState(false);
  const [seoData, setSeoData] = useState<{
    meta: Record<string, unknown>;
    liveMeta?: Record<string, unknown>;
    metaOverrides?: string[];
    context?: "live" | "variant";
    variant?: string;
    faqSchema: Record<string, unknown> | null;
    schemaOrg: Record<string, unknown>[];
    schemaOrgDocuments?: Array<{ schema: Record<string, unknown>; source: string }>;
    title: string;
    slug?: string;
  } | null>(null);
  const [seoMeta, setSeoMeta] = useState<SeoMeta>(EMPTY_SEO_META);
  const [seoSaving, setSeoSaving] = useState(false);
  const [seoLocations, setSeoLocations] = useState<string[]>([]);
  const [seoAvailableLocations, setSeoAvailableLocations] = useState<SeoLocation[]>([]);
  const [seoLocationSearch, setSeoLocationSearch] = useState("");

  const [metaOverrides, setMetaOverrides] = useState<string[]>([]);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const baselineMetaRef = useRef<SeoMeta>(EMPTY_SEO_META);

  const [newSlugValue, setNewSlugValue] = useState("");
  const [slugCheckStatus, setSlugCheckStatus] = useState<SlugCheckStatus>("idle");
  const [slugCheckReason, setSlugCheckReason] = useState<string | null>(null);
  const [slugRenaming, setSlugRenaming] = useState(false);
  const [slugRedirectPrompt, setSlugRedirectPrompt] = useState(false);
  const [slugOldUrl, setSlugOldUrl] = useState("");
  const [slugNewUrl, setSlugNewUrl] = useState("");

  const contentInfo: ContentInfo = {
    type: target?.contentType ?? null,
    slug: target?.slug ?? null,
    label: target?.slug ?? "SEO",
  };

  const locale = normalizeLocale(target?.locale || "en");
  const currentLocaleSlug = (seoData?.slug as string) || target?.slug || "";
  const seoContext = seoData?.context ?? (target?.variant ? "variant" : "live");
  const seoVariant = seoData?.variant ?? target?.variant;

  const applySeoMetaFromForm = useCallback((next: SeoMeta) => {
    setSeoMeta(next);
    const dirty = new Set<string>();
    for (const key of EDITABLE_META_KEYS) {
      if (next[key] !== baselineMetaRef.current[key]) dirty.add(key);
    }
    if (
      next.redirects.length !== baselineMetaRef.current.redirects.length ||
      next.redirects.some((r, i) => r !== baselineMetaRef.current.redirects[i])
    ) {
      dirty.add("redirects");
    }
    setDirtyKeys(dirty);
  }, []);

  const fetchSeoPreview = useCallback(async () => {
    if (!target?.contentType || !target?.slug) return;
    setSeoLoading(true);
    setSeoData(null);
    try {
      const params = new URLSearchParams({ locale });
      if (target.variant) params.set("variant", target.variant);
      const res = await fetch(
        `/api/seo-preview/${encodeURIComponent(target.contentType)}/${encodeURIComponent(target.slug)}?${params}`,
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          (errData as { error?: string }).error || "Failed to fetch SEO data",
        );
      }
      const data = await res.json();
      setSeoData(data);
      const nextMeta: SeoMeta = {
        page_title: (data.meta?.page_title as string) || "",
        description: (data.meta?.description as string) || "",
        og_image: (data.meta?.og_image as string) || "",
        canonical_url: (data.meta?.canonical_url as string) || "",
        robots: (data.meta?.robots as string) || "",
        priority: data.meta?.priority != null ? String(data.meta.priority) : "",
        change_frequency: (data.meta?.change_frequency as string) || "",
        redirects: ((data.meta?.redirects as Array<string | { path: string; status?: number }>) || [])
          .map((r) => (typeof r === "string" ? r : r?.path))
          .filter((r): r is string => Boolean(r)),
      };
      baselineMetaRef.current = nextMeta;
      setSeoMeta(nextMeta);
      setMetaOverrides(Array.isArray(data.metaOverrides) ? data.metaOverrides : []);
      setDirtyKeys(new Set());
      setSeoLocations((data.locations as string[]) || []);
      setSeoAvailableLocations(
        (data.availableLocations as SeoLocation[]) || [],
      );
      setSeoLocationSearch("");
      setNewSlugValue("");
      setSlugCheckStatus("idle");
      setSlugCheckReason(null);
      setSlugRedirectPrompt(false);
    } catch (error) {
      console.error("Error fetching SEO preview:", error);
      toast({
        title: "Failed to load SEO data",
        description:
          error instanceof Error ? error.message : "Could not fetch page SEO information.",
        variant: "destructive",
      });
    } finally {
      setSeoLoading(false);
    }
  }, [target?.contentType, target?.slug, target?.variant, locale, toast]);

  useEffect(() => {
    if (open && target) {
      fetchSeoPreview();
    }
  }, [open, target, fetchSeoPreview]);

  useEffect(() => {
    if (!newSlugValue || !target?.contentType || newSlugValue === currentLocaleSlug) {
      setSlugCheckStatus("idle");
      setSlugCheckReason(null);
      return;
    }
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!slugRegex.test(newSlugValue)) {
      setSlugCheckStatus("taken");
      setSlugCheckReason("Use only lowercase letters, numbers, and hyphens");
      return;
    }
    setSlugCheckStatus("available");
    setSlugCheckReason(null);
  }, [newSlugValue, target?.contentType, currentLocaleSlug]);

  const handleSlugRename = async (createRedirect: boolean) => {
    if (!target?.contentType || !target?.slug || !newSlugValue || slugCheckStatus !== "available") return;
    setSlugRenaming(true);
    setSlugRedirectPrompt(false);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getDebugToken();
      if (token) headers["X-Debug-Token"] = token;
      const res = await fetch("/api/content/rename-slug", {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentType: target.contentType,
          folderSlug: target.slug,
          locale,
          newSlug: newSlugValue,
          createRedirect,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to rename");
      }
      const result = await res.json();
      toast({
        title: "Slug renamed",
        description: `${result.oldSlug} → ${result.newSlug}${createRedirect ? " (redirect created)" : ""}`,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast({
        title: "Failed to rename slug",
        description: error instanceof Error ? error.message : "Could not rename content slug.",
        variant: "destructive",
      });
    } finally {
      setSlugRenaming(false);
    }
  };

  const handleSlugRenameClick = () => {
    if (!target?.contentType || !target?.slug || slugCheckStatus !== "available") return;
    const pattern = contentTypesMap?.[target.contentType]?.url_pattern;
    setSlugOldUrl(buildContentUrlFromPattern(pattern, currentLocaleSlug, locale));
    setSlugNewUrl(buildContentUrlFromPattern(pattern, newSlugValue, locale));
    setSlugRedirectPrompt(true);
  };

  const handleSeoSave = async () => {
    if (!target?.contentType || !target?.slug) return;
    setSeoSaving(true);
    try {
      const liveMeta = (seoData?.liveMeta || {}) as Record<string, unknown>;
      const isVariant = seoContext === "variant" && !!seoVariant;

      let metaPayload: Record<string, unknown>;

      if (isVariant) {
        metaPayload = {};
        // Preserve non-editable override keys already on the variant file
        for (const key of metaOverrides) {
          if (
            (EDITABLE_META_KEYS as readonly string[]).includes(key) ||
            key === "redirects"
          ) {
            continue;
          }
          if (seoData?.meta && seoData.meta[key] !== undefined) {
            metaPayload[key] = seoData.meta[key];
          }
        }
        for (const key of EDITABLE_META_KEYS) {
          const isDirty = dirtyKeys.has(key);
          const wasOverride = metaOverrides.includes(key);
          if (!isDirty && !wasOverride) continue;
          const formVal = seoMeta[key];
          if (isDirty) {
            if (!formVal) continue; // clear → re-inherit
            if (valuesEqual(key, formVal, liveMeta[key])) continue; // A1
            metaPayload[key] = formVal;
          } else if (formVal) {
            metaPayload[key] = formVal; // keep existing override
          }
        }
        {
          const isDirty = dirtyKeys.has("redirects");
          const wasOverride = metaOverrides.includes("redirects");
          if (isDirty || wasOverride) {
            if (isDirty) {
              if (
                seoMeta.redirects.length > 0 &&
                !valuesEqual("redirects", seoMeta.redirects, liveMeta.redirects)
              ) {
                metaPayload.redirects = seoMeta.redirects;
              }
              // cleared or A1 equal → omit
            } else if (seoMeta.redirects.length > 0) {
              metaPayload.redirects = seoMeta.redirects;
            }
          }
        }
      } else {
        metaPayload = { ...(seoData?.meta || {}) };
        for (const key of EDITABLE_META_KEYS) {
          if (seoMeta[key]) {
            metaPayload[key] = seoMeta[key];
          } else {
            delete metaPayload[key];
          }
        }
        if (seoMeta.redirects.length > 0) {
          metaPayload.redirects = seoMeta.redirects;
        } else {
          delete metaPayload.redirects;
        }
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getDebugToken();
      if (token) headers["X-Debug-Token"] = token;
      const author = await resolveAuthorName();

      const body: Record<string, unknown> = {
        contentType: target.contentType,
        slug: target.slug,
        locale,
        author: author || undefined,
        operations: [
          {
            action: "update_field",
            path: "meta",
            value: Object.keys(metaPayload).length > 0 ? metaPayload : null,
          },
        ],
      };
      if (isVariant && seoVariant) {
        body.variant = seoVariant;
      }

      const metaRes = await fetch("/api/content/edit-sections", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!metaRes.ok) {
        const errData = await metaRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save meta");
      }

      if (target.contentType === "landing" && seoAvailableLocations.length > 0) {
        const locRes = await fetch("/api/content/update-locations", {
          method: "POST",
          headers,
          body: JSON.stringify({
            contentType: "landing",
            slug: target.slug,
            locations: seoLocations,
            author: author || undefined,
          }),
        });
        if (!locRes.ok) {
          const locErr = await locRes.json().catch(() => ({}));
          throw new Error(locErr.error || "Failed to save locations");
        }
      }

      toast({
        title: "SEO updated",
        description: isVariant
          ? `Meta saved to variant "${seoVariant}".`
          : "Meta tags have been saved successfully.",
      });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error("Error saving SEO:", error);
      toast({
        title: "Failed to save SEO",
        description: error instanceof Error ? error.message : "Could not save meta changes.",
        variant: "destructive",
      });
    } finally {
      setSeoSaving(false);
    }
  };

  return (
    <SeoModal
      open={open}
      onOpenChange={onOpenChange}
      contentInfo={contentInfo}
      seoLoading={seoLoading}
      seoData={seoData}
      seoMeta={seoMeta}
      setSeoMeta={applySeoMetaFromForm}
      seoLocations={seoLocations}
      setSeoLocations={setSeoLocations}
      seoAvailableLocations={seoAvailableLocations}
      seoLocationSearch={seoLocationSearch}
      setSeoLocationSearch={setSeoLocationSearch}
      seoSaving={seoSaving}
      handleSeoSave={handleSeoSave}
      newSlugValue={newSlugValue}
      setNewSlugValue={setNewSlugValue}
      slugCheckStatus={slugCheckStatus}
      slugRenaming={slugRenaming}
      slugRedirectPrompt={slugRedirectPrompt}
      slugOldUrl={slugOldUrl}
      slugNewUrl={slugNewUrl}
      handleSlugRenameClick={handleSlugRenameClick}
      handleSlugRename={handleSlugRename}
      currentLocaleSlug={currentLocaleSlug}
      slugCheckReason={slugCheckReason}
      setSlugRedirectPrompt={setSlugRedirectPrompt}
      locale={locale}
      contentTypeLabel={
        target?.contentType
          ? target.contentType.charAt(0).toUpperCase() + target.contentType.slice(1)
          : undefined
      }
      initialTab={target?.initialTab}
      seoContext={seoContext}
      seoVariant={seoVariant}
      metaOverrides={metaOverrides}
    />
  );
}
