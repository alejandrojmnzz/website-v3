/**
 * Id-based section merge for shared-template + per-entry overlays.
 * Used by DB single templates and static types with `single_template: true`.
 */

import { deepMerge } from "./utils/deepMerge";
import { resolveAnchorAlias } from "./utils/sectionAnchors";

/**
 * Accumulator for per-entry layer metadata collected during merge.
 */
export interface PerEntryAccum {
  /** Sections removed via `_remove: true` with their original index in the base. */
  removedSections: Array<{ section: Record<string, unknown>; originalIndex: number }>;
  /**
   * Stable reference map from section id → base template index, built ONCE before
   * any per-entry layers are applied. Ensures `originalIndex` is always relative to
   * the immutable shared template even when both _common.yml and {locale}.yml remove
   * sections (which would otherwise shift the idx counter in subsequent calls).
   */
  baseIndexById?: Map<string, number>;
}

/**
 * Applies a single per-entry layer (either _common.yml or {locale}.yml) on top
 * of the accumulated merged template. Non-sections fields are deep-merged normally.
 * If the layer declares a `sections` array, it is applied as an id-based patch:
 *   - Entries with `_remove: true` remove the matching base section by id.
 *   - Other entries deep-merge their properties into the matching base section by id.
 *   - Entries whose id does not match any base section are treated as new per-entry
 *     sections and appended to the result with `_perEntrySource: true`.
 * Sections without an id in either layer or base are left unchanged.
 */
export function applyPerEntryLayer(
  base: Record<string, unknown>,
  layer: Record<string, unknown>,
  accum?: PerEntryAccum,
  aliases?: Record<string, string | null>,
): Record<string, unknown> {
  const layerSections = Array.isArray(layer.sections)
    ? (layer.sections as Record<string, unknown>[])
    : null;

  if (layerSections === null) {
    // No sections in this layer — plain deep merge
    return deepMerge(base, layer);
  }

  // Merge all non-sections fields normally
  const { sections: _ignored, ...layerRest } = layer;
  let result = Object.keys(layerRest).length > 0 ? deepMerge(base, layerRest) : { ...base };

  // Apply id-based section patches
  const baseSections = Array.isArray(result.sections)
    ? (result.sections as unknown[]).filter((s): s is Record<string, unknown> => s != null && typeof s === "object")
    : [];

  // Build set of base section IDs for fast lookup
  const baseSectionIds = new Set<string>(
    baseSections
      .map((s) => (typeof s.id === "string" ? s.id : null))
      .filter(Boolean) as string[],
  );

  const removeIds = new Set<string>();
  const patchById = new Map<string, Record<string, unknown>>();
  const perEntryNewSections: Record<string, unknown>[] = [];

  for (const s of layerSections) {
    if (!s || typeof s !== "object") continue;
    const id = typeof s.id === "string" ? s.id : undefined;
    if (!id) continue;
    if (s._remove) {
      removeIds.add(id);
    } else if (baseSectionIds.has(id)) {
      patchById.set(id, s);
    } else {
      // Section exists in per-entry layer only — it's a new per-entry addition
      perEntryNewSections.push(s);
    }
  }

  // Collect removed sections with stable original indices.
  // Use baseIndexById (computed before any per-entry layers) when available so that
  // `originalIndex` is always relative to the immutable shared template, not the
  // partially-filtered base of a subsequent layer call.
  if (accum) {
    baseSections.forEach((s, idx) => {
      const id = typeof s.id === "string" ? s.id : undefined;
      if (id && removeIds.has(id)) {
        // Avoid duplicates when both _common.yml and {locale}.yml mark the same section removed
        const alreadyRecorded = accum.removedSections.some(
          (r) => typeof r.section.id === "string" && r.section.id === id,
        );
        if (!alreadyRecorded) {
          const originalIndex = accum.baseIndexById?.get(id) ?? idx;
          accum.removedSections.push({ section: s, originalIndex });
        }
      }
    });
  }

  const filteredAndPatched = baseSections
    .filter((s) => {
      const id = typeof s.id === "string" ? s.id : undefined;
      return !id || !removeIds.has(id);
    })
    .map((s) => {
      const id = typeof s.id === "string" ? s.id : undefined;
      if (!id) return s;
      const patch = patchById.get(id);
      if (!patch) return s;
      return { ...deepMerge(s, patch), _perEntryPatched: true };
    });

  // Tag per-entry-only sections; strip _insertAfterSectionId from final output (positioning hint only)
  const taggedNew = perEntryNewSections.map((s) => {
    const { _insertAfterSectionId: _pos, ...rest } = s as Record<string, unknown>;
    return { ...rest, _perEntrySource: true, _insertAfterSectionId: _pos };
  });

  // Resolve dangling _insertAfterSectionId values via the alias map.
  // Build a set of current base section IDs for fast lookup.
  if (aliases && Object.keys(aliases).length > 0) {
    const patchedIds = new Set<string>(
      filteredAndPatched
        .map((s) => (typeof s.id === "string" ? s.id : null))
        .filter(Boolean) as string[],
    );
    for (const s of taggedNew) {
      const anchorId = s._insertAfterSectionId;
      if (typeof anchorId === "string") {
        const resolved = resolveAnchorAlias(anchorId, patchedIds, aliases);
        if (resolved !== undefined) {
          // resolved is string | null — update the positioning hint
          s._insertAfterSectionId = resolved;
        }
      }
    }
  }

  // Place per-entry sections at their intended position using _insertAfterSectionId.
  // - _insertAfterSectionId === undefined  → no metadata (legacy/compat): append at end
  // - _insertAfterSectionId === null       → insert before all base sections
  // - _insertAfterSectionId === <id>       → insert immediately after the base section with that id
  const appendNew: typeof taggedNew = [];
  const insertBeforeAll: typeof taggedNew = [];
  const insertAfterMap = new Map<string, typeof taggedNew>();

  for (const s of taggedNew) {
    const anchorKey = s._insertAfterSectionId;
    if (anchorKey === undefined) {
      appendNew.push(s);
    } else if (anchorKey === null) {
      insertBeforeAll.push(s);
    } else {
      const key = anchorKey as string;
      if (!insertAfterMap.has(key)) insertAfterMap.set(key, []);
      insertAfterMap.get(key)!.push(s);
    }
  }

  // Strip the positioning hint from the final output — it's only needed at load time
  const stripHint = (s: Record<string, unknown>) => {
    const { _insertAfterSectionId: _discarded, ...rest } = s;
    return rest;
  };

  // Helper: resolve a section's lookup key — prefer `id`, fall back to `section_id`.
  // Template sections created before the `id` field was introduced only have `section_id`.
  const sectionKey = (s: Record<string, unknown>): string | undefined => {
    if (typeof s.id === "string" && s.id) return s.id;
    if (typeof s.section_id === "string" && s.section_id) return s.section_id;
    return undefined;
  };

  // Phase 1: Build finalSections using base section anchors
  const finalSections: Record<string, unknown>[] = [
    ...insertBeforeAll.map(stripHint),
  ];
  for (const s of filteredAndPatched) {
    finalSections.push(s);
    const id = sectionKey(s);
    if (id && insertAfterMap.has(id)) {
      for (const newS of insertAfterMap.get(id)!) {
        finalSections.push(stripHint(newS));
      }
      insertAfterMap.delete(id);
    }
  }

  // Phase 2: Handle anchors pointing to per-entry sections (those inserted in phase 1).
  // Iterate until stable — handles chained per-entry-after-per-entry insertions.
  let madeProgress = true;
  while (madeProgress && insertAfterMap.size > 0) {
    madeProgress = false;
    for (const [anchorId, sections] of [...insertAfterMap.entries()]) {
      const anchorIdx = finalSections.findIndex(
        (s) => sectionKey(s) === anchorId,
      );
      if (anchorIdx !== -1) {
        // Insert immediately after the anchor (in reverse to preserve order when splicing)
        for (let i = sections.length - 1; i >= 0; i--) {
          finalSections.splice(anchorIdx + 1, 0, stripHint(sections[i]));
        }
        insertAfterMap.delete(anchorId);
        madeProgress = true;
      }
    }
  }

  // Remaining unresolved anchors (anchor id never found) fall back to append-at-end
  for (const [, sections] of insertAfterMap) {
    for (const s of sections) appendNew.push(s);
  }
  for (const s of appendNew) {
    finalSections.push(stripHint(s));
  }

  result.sections = finalSections;

  return result;
}
