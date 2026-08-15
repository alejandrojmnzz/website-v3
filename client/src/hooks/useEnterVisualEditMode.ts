import { useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { detectContentInfo } from "@/components/DebugBubble/utils/debugHelpers";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { useContentTypes } from "@/hooks/useContentTypes";
import { enterVisualEditMode } from "@/lib/visual-edit-path";

export function useEnterVisualEditMode() {
  const editMode = useEditModeOptional();
  const [location, navigate] = useLocation();
  const contentTypes = useContentTypes();
  const { i18n } = useTranslation();

  return useCallback(
    (overrides?: { contentType?: string; slug?: string }) => {
      if (!editMode) return;
      const pathname = location.split("?")[0];
      const inferred = detectContentInfo(pathname, contentTypes);
      enterVisualEditMode({
        enableEditMode: editMode.enableEditMode,
        navigate,
        pathname,
        search: typeof window !== "undefined" ? window.location.search : "",
        contentType: overrides?.contentType || inferred.type || undefined,
        slug: overrides?.slug || inferred.slug || undefined,
        fallbackLocale: i18n.language,
      });
    },
    [editMode, location, navigate, contentTypes, i18n.language],
  );
}
