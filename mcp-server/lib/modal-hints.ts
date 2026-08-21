/**
 * Hints when writing modal sections without section_id.
 *
 * Modals open only when location.hash equals section_id (CTA url: "#that-id").
 * See explain_site topic "sections".
 */

import type { McpWarning, NextAction } from "./respond.js";

export const MODAL_MISSING_SECTION_ID: McpWarning = {
  code: "modal_missing_section_id",
  message:
    "A type: modal section has no section_id — CTAs/links cannot open it via url: \"#…\". " +
    "Set section_id on the modal, then wire buttons to \"#that-exact-id\". " +
    "See explain_site topic 'sections'.",
};

function modalMissingId(
  section: Record<string, unknown>,
): boolean {
  if (section.type !== "modal") return false;
  const id = section.section_id;
  return typeof id !== "string" || id.trim() === "";
}

/**
 * After add_section: warn when the new section is a modal without section_id.
 */
export function hintsAfterAddModal(opts: {
  newSection: Record<string, unknown>;
  /** Insert index used for add_item; omit means append after existing length. */
  insertIndex?: number;
  existingSectionCount: number;
  slug: string;
  locale: string;
}): { warnings: McpWarning[]; next_actions: NextAction[] } {
  if (!modalMissingId(opts.newSection)) {
    return { warnings: [], next_actions: [] };
  }

  const index =
    opts.insertIndex !== undefined && opts.insertIndex >= 0
      ? opts.insertIndex
      : opts.existingSectionCount;

  return {
    warnings: [MODAL_MISSING_SECTION_ID],
    next_actions: [
      {
        tool: "update_fields",
        priority: "recommended",
        reason:
          "Set sections.N.section_id on the modal so CTAs can open it with url: \"#that-id\".",
        args_hint: {
          slug: opts.slug,
          locale: opts.locale,
          updates: [
            {
              field_path: `sections.${index}.section_id`,
              value: "apply-modal",
            },
          ],
          confirm_live_edit: true,
        },
      },
      {
        tool: "explain_site",
        priority: "optional",
        reason: "In-page CTA URL schemes (#section_id modal/scroll, inline#, #top/#bottom).",
        args_hint: { topic: "sections" },
      },
    ],
  };
}

/**
 * After replace_entry_sections: warn for every modal missing section_id.
 */
export function hintsAfterReplaceModals(opts: {
  sections: Array<Record<string, unknown>>;
  slug: string;
  locale: string;
}): { warnings: McpWarning[]; next_actions: NextAction[] } {
  const missing: number[] = [];
  opts.sections.forEach((s, i) => {
    if (modalMissingId(s)) missing.push(i);
  });
  if (missing.length === 0) {
    return { warnings: [], next_actions: [] };
  }

  const next_actions: NextAction[] = missing.map((index) => ({
    tool: "update_fields",
    priority: "recommended" as const,
    reason: `Set sections.${index}.section_id on the modal so CTAs can open it with url: "#that-id".`,
    args_hint: {
      slug: opts.slug,
      locale: opts.locale,
      updates: [
        {
          field_path: `sections.${index}.section_id`,
          value: "apply-modal",
        },
      ],
      confirm_live_edit: true,
    },
  }));

  next_actions.push({
    tool: "explain_site",
    priority: "optional",
    reason: "In-page CTA URL schemes (#section_id modal/scroll, inline#, #top/#bottom).",
    args_hint: { topic: "sections" },
  });

  return {
    warnings: [MODAL_MISSING_SECTION_ID],
    next_actions,
  };
}
