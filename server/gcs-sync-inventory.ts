import * as fs from "fs";
import * as path from "path";
import {
  formStateReadKeys,
  platformSitesYmlGcsKey,
  platformSitesYmlLocalFilename,
  platformSitesYmlReadKeys,
  platformUserStoreGcsKey,
  platformUserStoreLocalFilename,
  runtimeIssuesStateReadKeys,
  siteConversationsGcsPrefix,
  siteLighthouseGcsPrefixRoot,
  siteMediaGcsPrefix,
  siteSyncGcsKey,
  SYNC_FILENAMES,
  syncLogReadKeys,
  syncStateReadKeys,
  userStoreReadKeys,
  validationCacheReadKeys,
  versioningStateReadKeys,
} from "@shared/gcsKeys";
import { gcs } from "./gcs";
import { getSiteConfigs } from "./site-config";
import { getSiteContextMap } from "./site-manager";
import { createQueueContext, getQueueStats } from "./image-registry";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MEDIA_SEGMENT = process.env.GCS_BASE_PATH || "media";

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

function localMtime(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function siteContentRoot(contentFolder: string): string {
  return path.join(process.cwd(), contentFolder);
}

async function resolveRow(options: {
  id: string;
  label: string;
  gcsKey: string;
  readKeys?: string[];
  localPath: string | null;
  writesBlocked?: boolean;
  siteFolder?: string | null;
}): Promise<SyncInventoryRow> {
  const { id, label, gcsKey, localPath, writesBlocked, siteFolder = null } = options;
  const readKeys = options.readKeys ?? [gcsKey];
  const localDate = localPath ? localMtime(localPath) : null;
  const base = { id, label, siteFolder, gcsKey, localPath };

  if (readKeys.some((k) => gcs.isPendingUpload(k))) {
    return { ...base, status: "pending", lastSyncedAt: null, lastSyncedSource: null };
  }

  if (writesBlocked && gcs.migrationRequired) {
    return {
      ...base,
      status: "blocked",
      lastSyncedAt: localDate,
      lastSyncedSource: localDate ? "local" : null,
    };
  }

  if (!IS_PRODUCTION || !gcs.available) {
    return {
      ...base,
      status: "local_only",
      lastSyncedAt: localDate,
      lastSyncedSource: localDate ? "local" : null,
    };
  }

  let meta = { exists: false, updated: null as string | null, size: null as number | null };
  for (const key of readKeys) {
    const found = await gcs.getObjectMetadata(key);
    if (found.exists) {
      meta = found;
      break;
    }
  }

  if (meta.exists && meta.updated) {
    return { ...base, status: "synced", lastSyncedAt: meta.updated, lastSyncedSource: "gcs" };
  }

  if (localDate) {
    return {
      ...base,
      status: meta.exists ? "synced" : "local_only",
      lastSyncedAt: localDate,
      lastSyncedSource: "local",
    };
  }

  return { ...base, status: "missing", lastSyncedAt: null, lastSyncedSource: null };
}

export function aggregateImageQueuePending(): number {
  let total = 0;
  for (const site of getSiteContextMap().values()) {
    const registry = site.mediaGallery.getRegistry({ silent: true });
    if (!registry) continue;
    const ctx = createQueueContext(site.mediaGallery);
    const stats = getQueueStats(ctx);
    total += stats.queued;
  }
  return total;
}

export async function collectGcsSyncInventory(): Promise<SyncInventoryRow[]> {
  const rows: SyncInventoryRow[] = [];
  const siteConfigs = getSiteConfigs();
  const defaultSite = siteConfigs[0]?.contentFolder ?? null;

  for (const site of siteConfigs) {
    const root = siteContentRoot(site.contentFolder);
    const safeFolder = site.contentFolder.replace(/\\/g, "/").replace(/^\/|\/$/g, "");

    rows.push(
      await resolveRow({
        id: `sync-state-${safeFolder}`,
        label: "Sync state",
        siteFolder: site.contentFolder,
        gcsKey: siteSyncGcsKey(safeFolder, SYNC_FILENAMES.syncState),
        readKeys: syncStateReadKeys(safeFolder),
        localPath: path.join(root, ".sync-state.json"),
        writesBlocked: true,
      }),
      await resolveRow({
        id: `sync-log-${safeFolder}`,
        label: "Sync log",
        siteFolder: site.contentFolder,
        gcsKey: siteSyncGcsKey(safeFolder, SYNC_FILENAMES.syncLog),
        readKeys: syncLogReadKeys(safeFolder),
        localPath: path.join(root, ".sync-log-state.txt"),
        writesBlocked: true,
      }),
      await resolveRow({
        id: `versioning-${safeFolder}`,
        label: "Versioning state",
        siteFolder: site.contentFolder,
        gcsKey: siteSyncGcsKey(safeFolder, SYNC_FILENAMES.versioningState),
        readKeys: versioningStateReadKeys(safeFolder),
        localPath: path.join(root, ".versioning-state.json"),
        writesBlocked: true,
      }),
      await resolveRow({
        id: `form-state-${safeFolder}`,
        label: "Form registry",
        siteFolder: site.contentFolder,
        gcsKey: siteSyncGcsKey(safeFolder, SYNC_FILENAMES.formState),
        readKeys: formStateReadKeys(safeFolder, safeFolder === defaultSite),
        localPath: path.join(root, ".form-state.json"),
        writesBlocked: true,
      }),
      await resolveRow({
        id: `validation-cache-${safeFolder}`,
        label: "Validation cache",
        siteFolder: site.contentFolder,
        gcsKey: siteSyncGcsKey(safeFolder, SYNC_FILENAMES.validationCache),
        readKeys: validationCacheReadKeys(safeFolder),
        localPath: path.join(root, "validation-cache.json"),
        writesBlocked: true,
      }),
      await resolveRow({
        id: `runtime-issues-${safeFolder}`,
        label: "Runtime issues",
        siteFolder: site.contentFolder,
        gcsKey: siteSyncGcsKey(safeFolder, SYNC_FILENAMES.runtimeIssuesState),
        readKeys: runtimeIssuesStateReadKeys(safeFolder),
        localPath: path.join(root, `.${SYNC_FILENAMES.runtimeIssuesState}`),
        writesBlocked: true,
      }),
    );

    const mediaPrefix = siteMediaGcsPrefix(safeFolder, MEDIA_SEGMENT);
    const mediaLocal = path.join(root, "images");
    let mediaStatus: SyncInventoryStatus = "missing";
    let mediaLastSynced: string | null = localMtime(mediaLocal);
    let mediaSource: "gcs" | "local" | null = mediaLastSynced ? "local" : null;

    if (gcs.migrationRequired) {
      mediaStatus = "blocked";
    } else if (!IS_PRODUCTION || !gcs.available) {
      mediaStatus = mediaLastSynced ? "local_only" : "missing";
    } else {
      const newest = await gcs.getNewestObjectInPrefix(mediaPrefix);
      if (newest.exists && newest.updated) {
        mediaStatus = "synced";
        mediaLastSynced = newest.updated;
        mediaSource = "gcs";
      } else if (mediaLastSynced) {
        mediaStatus = "local_only";
      }
    }

    rows.push({
      id: `media-${safeFolder}`,
      label: "Media",
      siteFolder: site.contentFolder,
      gcsKey: `${mediaPrefix}*`,
      localPath: fs.existsSync(mediaLocal) ? mediaLocal : null,
      status: mediaStatus,
      lastSyncedAt: mediaLastSynced,
      lastSyncedSource: mediaSource,
    });

    if (gcs.available && IS_PRODUCTION) {
      const lhPrefix = siteLighthouseGcsPrefixRoot(safeFolder);
      const lhKeys = await gcs.list(lhPrefix);
      const dateDirs = [...new Set(
        lhKeys
          .map((k) => k.match(new RegExp(`^${lhPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^/]+)/`))?.[1])
          .filter((d): d is string => !!d),
      )].sort().reverse();

      rows.push({
        id: `lighthouse-${safeFolder}`,
        label: "Lighthouse reports",
        siteFolder: site.contentFolder,
        gcsKey: lhPrefix,
        localPath: null,
        status: dateDirs.length > 0 ? "synced" : "missing",
        lastSyncedAt: dateDirs[0] ? `${dateDirs[0]}T00:00:00.000Z` : null,
        lastSyncedSource: dateDirs.length > 0 ? "gcs" : null,
      });

      const convPrefix = siteConversationsGcsPrefix(safeFolder);
      const convKeys = await gcs.list(convPrefix);
      rows.push({
        id: `ai-conversations-${safeFolder}`,
        label: "AI conversation snapshots",
        siteFolder: site.contentFolder,
        gcsKey: `${convPrefix}*`,
        localPath: null,
        status: convKeys.length > 0 ? "synced" : "missing",
        lastSyncedAt: null,
        lastSyncedSource: convKeys.length > 0 ? "gcs" : null,
      });
    }
  }

  rows.push(
    await resolveRow({
      id: "multisite-platform-sites-yml",
      label: "Site registry (sites.yml)",
      siteFolder: null,
      gcsKey: platformSitesYmlGcsKey(),
      readKeys: platformSitesYmlReadKeys(),
      localPath: path.join(process.cwd(), platformSitesYmlLocalFilename()),
      writesBlocked: true,
    }),
    await resolveRow({
      id: "multisite-user-store",
      label: "User/auth store",
      siteFolder: null,
      gcsKey: platformUserStoreGcsKey(),
      readKeys: userStoreReadKeys(),
      localPath: path.join(process.cwd(), platformUserStoreLocalFilename()),
      writesBlocked: true,
    }),
  );

  for (const key of gcs.getPendingUploadKeys()) {
    if (rows.some((r) => r.gcsKey === key)) continue;
    rows.push({
      id: `pending-${key.replace(/[^a-z0-9]+/gi, "-")}`,
      label: "Pending upload",
      siteFolder: null,
      gcsKey: key,
      localPath: null,
      status: "pending",
      lastSyncedAt: null,
      lastSyncedSource: null,
    });
  }

  return rows;
}
