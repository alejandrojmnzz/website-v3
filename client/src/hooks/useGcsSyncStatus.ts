import { useQuery } from "@tanstack/react-query";

export type GcsSyncStatusValue =
  | "active"
  | "local_dev"
  | "syncing"
  | "migration_required"
  | "unavailable"
  | "error";

export interface GcsKeyProbe {
  label: string;
  expectedKey: string;
  legacyKeys: string[];
  foundKey: string | null;
  exists: boolean;
  status: "found" | "legacy" | "missing";
  updated: string | null;
}

export interface GcsSiteArchitecture {
  siteFolder: string;
  syncFiles: GcsKeyProbe[];
  mediaSamples: string[];
  conversationSamples: string[];
  lighthouseSamples: string[];
  legacySyncSamples: string[];
}

export interface GcsPlatformArchitecture {
  userStore: GcsKeyProbe;
  mcpAuthSamples: string[];
}

export interface GcsArchitectureDiagnostics {
  migrationRequired: boolean;
  bucketName: string;
  mediaSegment: string;
  knownSitePrefixes: string[];
  hasOldLayout: boolean;
  hasNewLayout: boolean;
  newLayoutSamples: Record<string, string[]>;
  checkError?: string;
  platform?: GcsPlatformArchitecture;
  sites?: GcsSiteArchitecture[];
}

export interface GcsSyncStatus {
  available: boolean;
  bucketName: string | null;
  status: GcsSyncStatusValue;
  pendingUploads: number;
  pendingUploadKeys: string[];
  imageQueuePending: number;
  imageQueueBusy: boolean;
  migrationRequired: boolean;
  isProduction: boolean;
}

export type SyncInventoryStatus =
  | "synced"
  | "pending"
  | "missing"
  | "local_only"
  | "blocked";

export interface SyncInventoryRow {
  id: string;
  label: string;
  siteFolder: string | null;
  gcsKey: string;
  localPath: string | null;
  status: SyncInventoryStatus;
  lastSyncedAt: string | null;
  lastSyncedSource: "gcs" | "local" | null;
}

export interface GcsSyncStatusDetail extends GcsSyncStatus {
  diagnostics?: GcsArchitectureDiagnostics;
}

export interface GcsSyncInventoryResponse {
  rows: SyncInventoryRow[];
}

export function useGcsSyncStatus(options?: { enabled?: boolean; detail?: boolean; refetchInterval?: number }) {
  const enabled = options?.enabled !== false;
  const detail = options?.detail ?? false;

  return useQuery<GcsSyncStatusDetail>({
    queryKey: ["/api/admin/gcs-sync-status", detail ? "detail" : "compact"],
    queryFn: async () => {
      const url = detail
        ? "/api/admin/gcs-sync-status?detail=1"
        : "/api/admin/gcs-sync-status";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch GCS sync status");
      return res.json();
    },
    enabled,
    refetchInterval: options?.refetchInterval ?? (enabled ? 10_000 : false),
    staleTime: 5_000,
  });
}

export function useGcsSyncInventory(options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;

  return useQuery<GcsSyncInventoryResponse>({
    queryKey: ["/api/admin/gcs-sync-inventory"],
    queryFn: async () => {
      const res = await fetch("/api/admin/gcs-sync-inventory");
      if (!res.ok) throw new Error("Failed to fetch GCS sync inventory");
      return res.json();
    },
    enabled,
    staleTime: 15_000,
  });
}

export function gcsStatusLabel(status: GcsSyncStatusValue): string {
  switch (status) {
    case "active":
      return "Active";
    case "local_dev":
      return "Local dev";
    case "syncing":
      return "Syncing";
    case "migration_required":
      return "Migration required";
    case "unavailable":
      return "Unavailable";
    case "error":
      return "Error";
    default:
      return status;
  }
}

export function gcsStatusDescription(status: GcsSyncStatusValue): string {
  switch (status) {
    case "active":
      return "GCS is connected and up to date — no pending uploads or image queue work.";
    case "local_dev":
      return "Running locally. GCS may be configured, but bucket sync is not enforced in development.";
    case "syncing":
      return "Uploads or image processing are still in progress.";
    case "migration_required":
      return "The bucket uses the old flat layout. GCS writes are blocked until migration completes.";
    case "unavailable":
      return "GCS is not configured — no bucket name or credentials found.";
    case "error":
      return "Could not verify bucket architecture. Check credentials and bucket access.";
    default:
      return "";
  }
}

export function inventoryStatusLabel(status: SyncInventoryStatus): string {
  switch (status) {
    case "synced":
      return "Synced";
    case "pending":
      return "Pending";
    case "missing":
      return "Missing";
    case "local_only":
      return "Local only";
    case "blocked":
      return "Blocked";
    default:
      return status;
  }
}

export function inventoryCategoryDescription(label: string): string | null {
  switch (label) {
    case "Sync state":
      return "Tracks GitHub content sync for this site — last synced commit, per-file sync metadata, and webhook config. Stored locally and in GCS so deploys resume from the same state.";
    case "Sync log":
      return "Rolling log of GitHub sync activity for this site (recent events and commit markers). Helps debug sync issues across instances.";
    case "Versioning state":
      return "A/B test and content versioning allocations for pages on this site — which variants are active and their traffic splits.";
    case "Form registry":
      return "Index of form sections across this site's YAML content: conversion names, automations, and metadata used by the forms admin tools.";
    case "Media":
      return "Site images from the local images/ folder, mirrored to the GCS media prefix. Shows whether cloud copies exist and when they were last updated.";
    case "Lighthouse reports":
      return "Stored Lighthouse audit results for this site (GCS only). Used by admin diagnostics and performance monitoring.";
    case "AI conversation snapshots":
      return "Backups of AI editor conversations for this site, stored in GCS so chat history survives deploys and restarts.";
    case "User/auth store":
      return "Platform-wide user and session data shared across all sites — not stored under a site folder. Synced between local disk and GCS in production.";
    case "Pending upload":
      return "A GCS object queued for upload from this instance, usually during an in-flight save or image processing job.";
    default:
      return null;
  }
}
