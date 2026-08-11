import { useState, useEffect, useCallback } from "react";
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

export function ManagedSeoModal({ open, onOpenChange, target, onSaved }: ManagedSeoModalProps) {
  const { toast } = useToast();
  const contentTypesMap = useContentTypes();

  const [seoLoading, setSeoLoading] = useState(false);
  const [seoData, setSeoData] = useState<{
    meta: Record<string, unknown>;
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

  const fetchSeoPreview = useCallback(async () => {
    if (!target?.contentType || !target?.slug) return;
    setSeoLoading(true);
    setSeoData(null);
    try {
      const res = await fetch(
        `/api/seo-preview/${encodeURIComponent(target.contentType)}/${encodeURIComponent(target.slug)}?locale=${encodeURIComponent(locale)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch SEO data");
      const data = await res.json();
      setSeoData(data);
      setSeoMeta({
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
      });
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
        description: "Could not fetch page SEO information.",
        variant: "destructive",
      });
    } finally {
      setSeoLoading(false);
    }
  }, [target?.contentType, target?.slug, locale, toast]);

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
      const existingMeta = { ...(seoData?.meta || {}) };
      const editableKeys = [
        "page_title",
        "description",
        "og_image",
        "canonical_url",
        "robots",
        "priority",
        "change_frequency",
      ] as const;
      for (const key of editableKeys) {
        if (seoMeta[key]) {
          existingMeta[key] = seoMeta[key];
        } else {
          delete existingMeta[key];
        }
      }
      if (seoMeta.redirects.length > 0) {
        existingMeta.redirects = seoMeta.redirects;
      } else {
        delete existingMeta.redirects;
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getDebugToken();
      if (token) headers["X-Debug-Token"] = token;
      const author = await resolveAuthorName();

      const metaRes = await fetch("/api/content/edit-sections", {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentType: target.contentType,
          slug: target.slug,
          locale,
          author: author || undefined,
          operations: [
            {
              action: "update_field",
              path: "meta",
              value: Object.keys(existingMeta).length > 0 ? existingMeta : null,
            },
          ],
        }),
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
        description: "Meta tags have been saved successfully.",
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
      setSeoMeta={setSeoMeta}
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
    />
  );
}
