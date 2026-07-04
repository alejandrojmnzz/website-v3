import type { Bucket } from "@google-cloud/storage";
import {
  legacyConversationsGcsPrefix,
  legacyGlobalSyncGcsKey,
  legacyLighthouseGcsPrefixRoot,
  legacyPerSiteSyncGcsKey,
  platformUserStoreGcsKey,
  siteConversationsGcsPrefix,
  siteLighthouseGcsPrefixRoot,
  siteSyncGcsKey,
  SYNC_FILENAMES,
} from "@shared/gcsKeys";
import { jobId, listBucketKeys, type MigrationJob } from "./gcs-migration-core";

const SYNC_FILES = [
  SYNC_FILENAMES.syncState,
  SYNC_FILENAMES.syncLog,
  SYNC_FILENAMES.versioningState,
] as const;

async function resolveSyncFileSrcKey(
  bucket: Bucket,
  site: string,
  file: (typeof SYNC_FILES)[number],
  defaultSite: string,
): Promise<string> {
  const candidates = [legacyPerSiteSyncGcsKey(site, file)];
  if (site === defaultSite) {
    if (file === SYNC_FILENAMES.syncState || file === SYNC_FILENAMES.versioningState) {
      candidates.push(legacyGlobalSyncGcsKey(file));
    }
  }
  for (const key of candidates) {
    const [exists] = await bucket.file(key).exists();
    if (exists) return key;
  }
  return candidates[0];
}

export async function buildLayoutMigrationPlan(options: {
  bucket: Bucket;
  sites: string[];
  defaultSite: string;
  siteFilter?: string;
}): Promise<MigrationJob[]> {
  const jobsByDest = new Map<string, MigrationJob>();
  const sites = options.siteFilter
    ? options.sites.filter((s) => s === options.siteFilter)
    : options.sites;

  const add = (job: MigrationJob) => {
    if (!jobsByDest.has(job.destKey)) jobsByDest.set(job.destKey, job);
  };

  for (const site of sites) {
    for (const file of SYNC_FILES) {
      const srcKey = await resolveSyncFileSrcKey(
        options.bucket,
        site,
        file,
        options.defaultSite,
      );
      const destKey = siteSyncGcsKey(site, file);
      add({
        id: jobId(srcKey, destKey),
        srcKey,
        destKey,
        site,
        phase: "layout_copy",
      });
    }

    if (site === options.defaultSite) {
      const formSrc = legacyGlobalSyncGcsKey(SYNC_FILENAMES.formState);
      const formDest = siteSyncGcsKey(site, SYNC_FILENAMES.formState);
      add({
        id: jobId(formSrc, formDest),
        srcKey: formSrc,
        destKey: formDest,
        site,
        phase: "layout_copy",
      });
    }

    const legacyConvPrefix = legacyConversationsGcsPrefix(site);
    const convKeys = await listBucketKeys(options.bucket, legacyConvPrefix);
    for (const srcKey of convKeys) {
      const suffix = srcKey.slice(legacyConvPrefix.length);
      const destKey = `${siteConversationsGcsPrefix(site)}${suffix}`;
      add({
        id: jobId(srcKey, destKey),
        srcKey,
        destKey,
        site,
        phase: "layout_copy",
      });
    }
  }

  const usersSrc = legacyGlobalSyncGcsKey(SYNC_FILENAMES.usersState);
  const usersDest = platformUserStoreGcsKey();
  add({
    id: jobId(usersSrc, usersDest),
    srcKey: usersSrc,
    destKey: usersDest,
    site: options.defaultSite || sites[0] || "platform",
    phase: "layout_copy",
  });

  const lhRoot = legacyLighthouseGcsPrefixRoot();
  const lhKeys = await listBucketKeys(options.bucket, lhRoot);
  const targetSite = options.defaultSite || sites[0];
  if (targetSite) {
    for (const srcKey of lhKeys) {
      const suffix = srcKey.slice(lhRoot.length);
      const destKey = `${siteLighthouseGcsPrefixRoot(targetSite)}${suffix}`;
      add({
        id: jobId(srcKey, destKey),
        srcKey,
        destKey,
        site: targetSite,
        phase: "layout_copy",
      });
    }
  }

  return Array.from(jobsByDest.values());
}
