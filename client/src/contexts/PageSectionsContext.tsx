import { createContext, useContext } from "react";

export type PageSectionsMap = Record<string, Record<string, unknown>>;

export type OrderedPageSection = {
  /** Stable key: section_id when set, otherwise `{type}-{index}`. */
  sectionKey: string;
  index: number;
  data: Record<string, unknown>;
};

type PageSectionsContextValue = {
  byId: PageSectionsMap;
  ordered: OrderedPageSection[];
};

const defaultValue: PageSectionsContextValue = {
  byId: {},
  ordered: [],
};

const PageSectionsContext = createContext<PageSectionsContextValue>(defaultValue);

export function PageSectionsProvider({
  value,
  children,
}: {
  value: PageSectionsContextValue;
  children: React.ReactNode;
}) {
  return (
    <PageSectionsContext.Provider value={value}>
      {children}
    </PageSectionsContext.Provider>
  );
}

/** Sections keyed by section_id (only those with an explicit id). */
export function usePageSections(): PageSectionsMap {
  return useContext(PageSectionsContext).byId;
}

/** All sections in page order (for cross-section features like toc_group). */
export function useOrderedPageSections(): OrderedPageSection[] {
  return useContext(PageSectionsContext).ordered;
}
