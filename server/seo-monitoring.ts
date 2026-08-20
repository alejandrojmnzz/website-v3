/**
 * SEO cluster monitoring scope — driven by content-types.yml `seo_monitoring`.
 * Omitted block = disabled (opt-in).
 */

import { getContentTypeConfig, type SeoMonitoringConfig as SeoMonitoringConfigRaw } from "./content-types";

export type SeoMonitoringConfig = {
  enabled: boolean;
  require_cluster: boolean;
};

export function resolveSeoMonitoringConfig(
  raw: SeoMonitoringConfigRaw | undefined | null,
): SeoMonitoringConfig {
  if (!raw || raw.enabled !== true) {
    return { enabled: false, require_cluster: false };
  }
  return {
    enabled: true,
    require_cluster: raw.require_cluster === true,
  };
}

export function getSeoMonitoringConfig(
  contentType: string,
  contentRoot?: string,
): SeoMonitoringConfig {
  const cfg = getContentTypeConfig(contentType, contentRoot);
  return resolveSeoMonitoringConfig(cfg?.seo_monitoring);
}

export function isSeoMonitoringEnabled(contentType: string, contentRoot?: string): boolean {
  return getSeoMonitoringConfig(contentType, contentRoot).enabled;
}

export function isClusterRequired(contentType: string, contentRoot?: string): boolean {
  return getSeoMonitoringConfig(contentType, contentRoot).require_cluster;
}

/** Types to enable in content-types.yml migration (existing cluster participants). */
export const SEO_MONITORING_MIGRATION_TYPES = [
  "blog",
  "program",
  "landing",
  "page",
  "location",
] as const;
