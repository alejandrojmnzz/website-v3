import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useDebugAuth, getDebugToken } from "@/hooks/useDebugAuth";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { EditModeProvider } from "@/contexts/EditModeContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { SyncConflictBanner } from "@/components/SyncConflictBanner";
import { StaffSystemAlertBanner } from "@/components/StaffSystemAlertBanner";
import { PageHistoryProvider, usePageHistoryOptional } from "@/contexts/PageHistoryContext";
import { subscribeToEditStarted, emitVariantCreated } from "@/lib/contentEvents";
import { FirstEditPromptModal, type ExistingVariant } from "@/components/editing/FirstEditPromptModal";
import { navigate } from "wouter/use-browser-location";
import { useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { IconGitFork } from "@tabler/icons-react";
import type { Section } from "@shared/schema";

interface EditModeWrapperProps {
  children: React.ReactNode;
  sections?: Section[];
  contentType?: string;
  slug?: string;
  locale?: string;
}

// Sync wrapper that only renders when edit mode is active
// This ensures no GitHub API calls happen until user explicitly enters edit mode
function SyncWrapper({ children }: { children: React.ReactNode }) {
  const editMode = useEditModeOptional();
  
  // Only mount SyncProvider when edit mode is actually active
  // Regular browsers (even with debug capabilities) won't trigger any sync API calls
  if (!editMode?.isEditMode) {
    return <>{children}</>;
  }
  
  return (
    <SyncProvider>
      <SyncConflictBanner />
      {children}
    </SyncProvider>
  );
}

const AUTO_OPEN_KEY = "firstEdit_autoOpen";

interface PendingEdit {
  contentType: string;
  slug: string;
  locale: string;
  sectionIndex?: number;
  variant?: string;
  resume: () => void;
}

/**
 * Mounted once inside EditModeProvider. Subscribes to editStarted events and
 * intercepts the first edit on a promoted (default) variant page each session.
 */
function FirstEditGate({ children }: { children: React.ReactNode }) {
  const editMode = useEditModeOptional();
  const searchString = useSearch();
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [existingVariants, setExistingVariants] = useState<ExistingVariant[]>([]);
  const pendingRef = useRef<PendingEdit | null>(null);

  // Derive the active variant from the URL (?variant=xxx on private preview routes)
  const activeVariantFromUrl = (() => {
    const params = new URLSearchParams(searchString);
    return params.get("variant") ?? params.get("force_variant") ?? null;
  })();

  useEffect(() => {
    return subscribeToEditStarted((payload) => {
      if (!editMode?.isEditMode) {
        payload.resume();
        return;
      }

      const slug = payload.slug || "";
      const isOnPromotedVariant = !payload.variant || payload.variant === "";

      // Skip gate: already prompted this session OR already on a named variant
      if (!isOnPromotedVariant || editMode.promptedPageSlugs.has(slug)) {
        payload.resume();
        return;
      }

      // Hold the resume callback and show the modal
      const pending: PendingEdit = {
        contentType: payload.contentType,
        slug,
        locale: payload.locale,
        sectionIndex: payload.sectionIndex,
        variant: payload.variant,
        resume: payload.resume,
      };
      pendingRef.current = pending;
      setPendingEdit(pending);
      setExistingVariants([]);
      setModalOpen(true);

      // Fetch existing variants for this page in the background
      fetch(`/api/versioning/${encodeURIComponent(payload.contentType)}/${encodeURIComponent(slug)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data?.versioning) return;
          const localeData = data.versioning[payload.locale] ?? data.versioning[Object.keys(data.versioning)[0]];
          const variants: ExistingVariant[] = (localeData?.variants ?? []).map((v: { slug: string }) => ({ slug: v.slug }));
          setExistingVariants(variants);
        })
        .catch(() => {});
    });
  }, [editMode]);

  const handleEditLive = useCallback(() => {
    if (!editMode || !pendingRef.current) return;
    editMode.markPagePrompted(pendingRef.current.slug);
    setModalOpen(false);
    const resume = pendingRef.current.resume;
    pendingRef.current = null;
    setPendingEdit(null);
    resume();
  }, [editMode]);

  const handleSwitchToVariant = useCallback((variantSlug: string) => {
    if (!editMode || !pendingRef.current) return;
    const { contentType, slug, locale, sectionIndex } = pendingRef.current;
    editMode.markPagePrompted(slug);
    setModalOpen(false);

    // Persist section index so the variant page auto-opens the same editor
    if (typeof sessionStorage !== "undefined" && sectionIndex !== undefined) {
      sessionStorage.setItem(
        AUTO_OPEN_KEY,
        JSON.stringify({ sectionIndex, variantName: variantSlug })
      );
    }

    pendingRef.current = null;
    setPendingEdit(null);
    navigate(`/private/preview/${contentType}/${slug}?variant=${encodeURIComponent(variantSlug)}&locale=${locale}`);
  }, [editMode]);

  const handleCreateVariant = useCallback(async (variantName: string) => {
    if (!editMode || !pendingRef.current) return;
    const { contentType, slug, locale } = pendingRef.current;

    const token = getDebugToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Token ${token}`;

    const res = await fetch(`/api/versioning/${contentType}/${slug}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ variantSlug: variantName, locale }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to create variant");
    }

    emitVariantCreated({ contentType, slug, locale, variantSlug: variantName });
    editMode.markPagePrompted(slug);
    setModalOpen(false);

    // Persist the section index so the new variant page can auto-open the same editor
    if (typeof sessionStorage !== "undefined" && pendingRef.current?.sectionIndex !== undefined) {
      sessionStorage.setItem(
        AUTO_OPEN_KEY,
        JSON.stringify({ sectionIndex: pendingRef.current.sectionIndex, variantName })
      );
    }

    pendingRef.current = null;
    setPendingEdit(null);

    // Navigate to the new variant so subsequent edits happen in the variant context
    navigate(`/private/preview/${contentType}/${slug}?variant=${encodeURIComponent(variantName)}&locale=${locale}`);
  }, [editMode]);

  return (
    <>
      {children}
      {/* Variant indicator badge — visible whenever the URL carries a named variant */}
      {activeVariantFromUrl && editMode?.isEditMode && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none"
          data-testid="variant-indicator-badge"
        >
          <Badge
            variant="secondary"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm shadow-md pointer-events-auto"
          >
            <IconGitFork className="h-3.5 w-3.5" />
            Editing variant: <strong>{activeVariantFromUrl}</strong>
          </Badge>
        </div>
      )}
      {pendingEdit && (
        <FirstEditPromptModal
          isOpen={modalOpen}
          contentType={pendingEdit.contentType}
          slug={pendingEdit.slug}
          locale={pendingEdit.locale}
          existingVariants={existingVariants}
          onCreateVariant={handleCreateVariant}
          onSwitchToVariant={handleSwitchToVariant}
          onEditLive={handleEditLive}
        />
      )}
    </>
  );
}

// Inner component that uses the edit mode context
function EditModeInner({ 
  children, 
  sections, 
  contentType, 
  slug, 
  locale 
}: EditModeWrapperProps) {
  const pageHistory = usePageHistoryOptional();
  const [localSections, setLocalSections] = useState<Section[]>(sections || []);
  const localSectionsRef = useRef<Section[]>(localSections);
  
  // Keep ref in sync with state
  useEffect(() => {
    localSectionsRef.current = localSections;
  }, [localSections]);
  
  // Sync localSections when sections prop changes (e.g., after refetch)
  useEffect(() => {
    if (sections) {
      setLocalSections(sections);
    }
  }, [sections]);
  
  // Register page context with history provider
  // Keep context registered even when exiting edit mode so undo/redo still works
  useEffect(() => {
    if (pageHistory && contentType && slug && locale) {
      pageHistory.setPageContext({
        contentType: contentType || "page",
        slug,
        locale,
        onSectionsRestore: (restoredSections: Section[]) => {
          setLocalSections(restoredSections);
        },
        getCurrentSections: () => localSectionsRef.current,
      });
      
      return () => {
        pageHistory.setPageContext(null);
      };
    }
  }, [pageHistory, contentType, slug, locale]);
  
  return <>{children}</>;
}

// Main wrapper that provides the context
// Edit capabilities are checked but sync is deferred until edit mode is toggled on
export function EditModeWrapper({ 
  children, 
  sections, 
  contentType, 
  slug, 
  locale 
}: EditModeWrapperProps) {
  const { canEdit, isDebugMode, isLoading } = useDebugAuth();
  
  const withStaffAlerts = (node: ReactNode) => (
    <>
      <StaffSystemAlertBanner />
      {node}
    </>
  );
  
  // Non-debug users: render children directly (no overhead)
  if (!isDebugMode) {
    return <>{children}</>;
  }
  
  // While auth is loading, provide EditModeProvider so the toggle can appear
  // Once loaded, if user has no edit capabilities, they still see the toggle but can't edit
  if (isLoading) {
    // Provide context while loading so DebugBubble can show the toggle
    return withStaffAlerts(
      <EditModeProvider>
        <PageHistoryProvider enabled={true}>
          <FirstEditGate>
            <EditModeInner 
              sections={sections} 
              contentType={contentType} 
              slug={slug} 
              locale={locale}
            >
              {children}
            </EditModeInner>
          </FirstEditGate>
        </PageHistoryProvider>
      </EditModeProvider>
    );
  }
  
  // No edit capability: render children directly
  if (!canEdit) {
    return withStaffAlerts(<>{children}</>);
  }
  
  // Has edit capability: provide EditModeProvider for toggle UI
  // SyncWrapper only activates when user actually enters edit mode
  return withStaffAlerts(
    <EditModeProvider>
      <PageHistoryProvider enabled={true}>
        <SyncWrapper>
          <FirstEditGate>
            <EditModeInner 
              sections={sections} 
              contentType={contentType} 
              slug={slug} 
              locale={locale}
            >
              {children}
            </EditModeInner>
          </FirstEditGate>
        </SyncWrapper>
      </PageHistoryProvider>
    </EditModeProvider>
  );
}
