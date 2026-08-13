import { createContext, useContext } from "react";

export interface SectionContextValue {
  isPriority: boolean;
  sectionIndex: number;
  contentType: string;
  slug: string;
  locale: string;
  /** Current page entry bag (same as {{ single.* }}); used by form source.relation */
  singleEntry?: Record<string, unknown>;
  variableFields?: Record<string, string>;
  variableKeys?: Record<string, string>;
  imageSizes: Record<string, string>;
}

const defaultValue: SectionContextValue = {
  isPriority: false,
  sectionIndex: -1,
  contentType: "",
  slug: "",
  locale: "",
  singleEntry: undefined,
  variableFields: undefined,
  variableKeys: undefined,
  imageSizes: {},
};

const SectionContext = createContext<SectionContextValue>(defaultValue);

export const SectionContextProvider = SectionContext.Provider;

export function useSectionContext(): SectionContextValue {
  return useContext(SectionContext);
}

export function useSectionPriority(): boolean {
  return useContext(SectionContext).isPriority;
}
