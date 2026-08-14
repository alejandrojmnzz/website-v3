/**
 * Per-source Set of relation pointer ids (value path, default slug).
 * One load per source per run — not queryEntries per pointer.
 */

import { extractByDotPath } from "@shared/validateEditorFieldTypes";

export function relationIndexKey(source: string, valuePath: string): string {
  return `${source}::${valuePath || "slug"}`;
}

export function idFromItem(
  item: Record<string, unknown>,
  valuePath: string,
): string | null {
  const raw =
    extractByDotPath(item, valuePath) ?? item.slug ?? item.bc_slug ?? item.id;
  if (raw == null || raw === "") return null;
  return String(raw);
}

export function collectIdsFromItems(
  items: Array<Record<string, unknown>>,
  valuePath: string,
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const id = idFromItem(item, valuePath);
    if (id) ids.add(id);
  }
  return ids;
}

export function relationTargetMissing(pointer: string, ids: Set<string>): boolean {
  return !ids.has(pointer);
}
