import { collectSharedMetaIssues, type SharedMetaIssue } from "@shared/metaIssueRules";

export type MetaIssue = SharedMetaIssue;

/** Client-side meta checks — shared codes with the meta validator; store remains authority after run. */
export function getMetaIssues(meta: Record<string, unknown> | null | undefined): MetaIssue[] {
  return collectSharedMetaIssues(meta);
}
