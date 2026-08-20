/**
 * MCP-only virtual field seo.include_in_clustering — mirrors staff
 * "Include in SEO clustering" toggle. Never persisted to YAML; expands to
 * seo.pillar_path / seo.is_pillar before edit-sections.
 */

import {
  SEO_YAML_KEY,
  isKnownSeoFieldPath,
} from "../../server/content-types.js";
import {
  isPillarPathExplicitlyNull,
  mergeSeoUpdates,
  type SeoBlock,
} from "../../server/seo-fields.js";
import { isSeoMonitoringEnabled } from "../../server/seo-monitoring.js";
import type { McpWarning, NextAction } from "./respond.js";

export const SEO_INCLUDE_IN_CLUSTERING = `${SEO_YAML_KEY}.include_in_clustering` as const;
export const SEO_PILLAR_PATH = `${SEO_YAML_KEY}.pillar_path` as const;
export const SEO_IS_PILLAR = `${SEO_YAML_KEY}.is_pillar` as const;

export const SEO_CLUSTER_MONITORING_DISABLED_WARNING: McpWarning = {
  code: "seo_cluster_monitoring_disabled",
  message:
    "Cluster monitoring was disabled for this entry (seo.pillar_path: null). " +
    "The page is excluded from SEO clustering until include_in_clustering is turned on with a hub path or is_pillar.",
};

export type FieldUpdate = {
  field_path: string;
  value: unknown;
  meta_target?: "locale" | "common";
};

export type ExpandSeoClusterOk = {
  ok: true;
  updates: FieldUpdate[];
  warnings: McpWarning[];
  /** True when this write opts the page out (virtual off or raw pillar_path null). */
  cluster_monitoring_disabled: boolean;
};

export type ExpandSeoClusterFail = {
  ok: false;
  kind: "fail";
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ExpandSeoClusterActionRequired = {
  ok: false;
  kind: "action_required";
  action_required: string;
  code: string;
  message: string;
  next_actions: NextAction[];
  details?: Record<string, unknown>;
};

export type ExpandSeoClusterResult =
  | ExpandSeoClusterOk
  | ExpandSeoClusterFail
  | ExpandSeoClusterActionRequired;

export function isSeoIncludeInClusteringPath(fieldPath: string): boolean {
  return fieldPath === SEO_INCLUDE_IN_CLUSTERING;
}

/** True when the page is included (not explicit pillar_path: null opt-out). */
export function deriveIncludeInClustering(seo: unknown): boolean {
  if (!seo || typeof seo !== "object" || Array.isArray(seo)) return true;
  return !isPillarPathExplicitlyNull(seo as SeoBlock);
}

function isSeoWritablePath(fieldPath: string): boolean {
  return isKnownSeoFieldPath(fieldPath) || fieldPath === `${SEO_YAML_KEY}.pillar`;
}

function coerceBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function hasClusterMembership(seo: SeoBlock): boolean {
  if (seo.is_pillar === true) return true;
  return typeof seo.pillar_path === "string" && seo.pillar_path.trim() !== "";
}

function seoUpdatesRecord(updates: FieldUpdate[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const u of updates) {
    if (!isSeoWritablePath(u.field_path)) continue;
    out[u.field_path] = u.value;
  }
  return out;
}

function stripVirtualAndInject(
  updates: FieldUpdate[],
  inject: FieldUpdate[],
): FieldUpdate[] {
  const without = updates.filter((u) => !isSeoIncludeInClusteringPath(u.field_path));
  const injectPaths = new Set(inject.map((i) => i.field_path));
  const kept = without.filter((u) => !injectPaths.has(u.field_path));
  return [...kept, ...inject];
}

/**
 * Expand / validate seo.include_in_clustering before edit-sections.
 * When the virtual field is absent, passes updates through; raw pillar_path: null
 * sets cluster_monitoring_disabled for the caller to warn.
 */
export function expandSeoClusterToggle(opts: {
  contentType: string;
  contentRoot?: string;
  updates: FieldUpdate[];
  currentSeo?: SeoBlock | null;
  /** For action_required next_actions args_hint */
  slug?: string;
  locale?: string;
  site?: string;
  variant?: string;
  /** Test/override; default = isSeoMonitoringEnabled(contentType, contentRoot). */
  monitoringEnabled?: boolean;
}): ExpandSeoClusterResult {
  const { contentType, contentRoot, updates } = opts;
  const currentSeo: SeoBlock =
    opts.currentSeo && typeof opts.currentSeo === "object" ? { ...opts.currentSeo } : {};

  const virtualIndexes = updates
    .map((u, i) => (isSeoIncludeInClusteringPath(u.field_path) ? i : -1))
    .filter((i) => i >= 0);

  if (virtualIndexes.length === 0) {
    const rawNull = updates.some(
      (u) => u.field_path === SEO_PILLAR_PATH && u.value === null,
    );
    return {
      ok: true,
      updates,
      warnings: rawNull ? [SEO_CLUSTER_MONITORING_DISABLED_WARNING] : [],
      cluster_monitoring_disabled: rawNull,
    };
  }

  const monitored =
    opts.monitoringEnabled !== undefined
      ? opts.monitoringEnabled
      : isSeoMonitoringEnabled(contentType, contentRoot);
  if (!monitored) {
    return {
      ok: false,
      kind: "fail",
      code: "seo_type_not_monitored",
      message:
        `Content type '${contentType}' does not have seo_monitoring.enabled. ` +
        `Cannot use ${SEO_INCLUDE_IN_CLUSTERING}. Enable monitoring on the content type (staff Content Type manage), ` +
        `or write raw seo.pillar_path / seo.is_pillar / seo.main_keyword if you only need YAML fields.`,
      details: { contentType, field_path: SEO_INCLUDE_IN_CLUSTERING },
    };
  }

  const lastVirtual = updates[virtualIndexes[virtualIndexes.length - 1]!]!;
  const include = coerceBoolean(lastVirtual.value);
  if (include === null) {
    return {
      ok: false,
      kind: "fail",
      code: "seo_include_in_clustering_invalid",
      message: `${SEO_INCLUDE_IN_CLUSTERING} must be a boolean (true | false).`,
      details: { value: lastVirtual.value },
    };
  }

  const hintBase: Record<string, unknown> = {
    slug: opts.slug,
    locale: opts.locale ?? "en",
    contentType,
    confirm_live_edit: true,
    ...(opts.variant ? { variant: opts.variant } : {}),
    ...(opts.site ? { site: opts.site } : {}),
  };

  if (!include) {
    const conflictingPillar = updates.find(
      (u) =>
        u.field_path === SEO_PILLAR_PATH &&
        u.value !== null &&
        !isSeoIncludeInClusteringPath(u.field_path),
    );
    if (conflictingPillar) {
      return {
        ok: false,
        kind: "fail",
        code: "seo_cluster_toggle_conflict",
        message:
          `Cannot set ${SEO_INCLUDE_IN_CLUSTERING}: false together with a non-null ${SEO_PILLAR_PATH}. ` +
          `Omit ${SEO_PILLAR_PATH} when turning clustering off (off expands to pillar_path: null).`,
        details: { pillar_path_value: conflictingPillar.value },
      };
    }

    const expanded = stripVirtualAndInject(updates, [
      { field_path: SEO_PILLAR_PATH, value: null },
      { field_path: SEO_IS_PILLAR, value: false },
    ]);
    return {
      ok: true,
      updates: expanded,
      warnings: [SEO_CLUSTER_MONITORING_DISABLED_WARNING],
      cluster_monitoring_disabled: true,
    };
  }

  // include === true: membership required after merge (Option A)
  const withoutVirtual = updates.filter((u) => !isSeoIncludeInClusteringPath(u.field_path));
  const merged = mergeSeoUpdates(currentSeo, seoUpdatesRecord(withoutVirtual));
  if (!hasClusterMembership(merged)) {
    const next_actions: NextAction[] = [
      {
        tool: "update_fields",
        priority: "required",
        reason:
          `Turn clustering on with ${SEO_INCLUDE_IN_CLUSTERING}: true plus a hub: non-empty ${SEO_PILLAR_PATH} or ${SEO_IS_PILLAR}: true (same call).`,
        args_hint: {
          ...hintBase,
          updates: [
            { field_path: SEO_INCLUDE_IN_CLUSTERING, value: true },
            { field_path: SEO_PILLAR_PATH, value: "<hub public path e.g. /en/...>" },
            { field_path: SEO_IS_PILLAR, value: false },
          ],
        },
      },
      {
        tool: "get_entry_seo",
        priority: "recommended",
        reason: "Inspect current seo.pillar_path / is_pillar / include_in_clustering.",
        args_hint: {
          slug: opts.slug,
          locale: opts.locale ?? "en",
          contentType,
          ...(opts.variant ? { variant: opts.variant } : {}),
          ...(opts.site ? { site: opts.site } : {}),
        },
      },
    ];
    return {
      ok: false,
      kind: "action_required",
      action_required: "seo_cluster_membership_required",
      code: "seo_cluster_membership_required",
      message:
        `Turning ${SEO_INCLUDE_IN_CLUSTERING} on requires cluster membership after merge: ` +
        `non-empty ${SEO_PILLAR_PATH} or ${SEO_IS_PILLAR}: true. seo.main_keyword is optional.`,
      next_actions,
      details: {
        field_path: SEO_INCLUDE_IN_CLUSTERING,
        require: ["seo.pillar_path (non-empty)", "or seo.is_pillar: true"],
      },
    };
  }

  // Strip virtual only — real seo.* from the same call (and existing file) already satisfy membership
  return {
    ok: true,
    updates: withoutVirtual,
    warnings: [],
    cluster_monitoring_disabled: false,
  };
}
