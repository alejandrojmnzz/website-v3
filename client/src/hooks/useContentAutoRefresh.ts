import { useEffect } from "react";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { subscribeToContentUpdates, ContentUpdatedPayload } from "@/lib/contentEvents";

export function useContentAutoRefresh(
  contentType: string | undefined,
  slug: string | undefined,
  locale: string | undefined,
  refetch: () => void
): void {
  const editMode = useEditModeOptional();

  useEffect(() => {
    if (!editMode?.isEditMode || !contentType || !slug || !locale) {
      return;
    }

    const unsubscribe = subscribeToContentUpdates((payload: ContentUpdatedPayload) => {
      if (payload.contentType !== contentType || payload.slug !== slug) {
        return;
      }
      // Locale can differ slightly (e.g. "es" vs effectiveLocale); still refetch
      // when type+slug match so FAQ/dynamic sections don't stay on empty local state.
      if (payload.locale && locale && payload.locale !== locale) {
        const a = payload.locale.split("-")[0];
        const b = locale.split("-")[0];
        if (a !== b) return;
      }
      refetch();
    });

    return unsubscribe;
  }, [editMode?.isEditMode, contentType, slug, locale, refetch]);
}
