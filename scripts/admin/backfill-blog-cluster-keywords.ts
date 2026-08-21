#!/usr/bin/env tsx
/**
 * Retired. Blog cluster_keyword / cluster_url holding columns were migrated
 * to locale seo.is_pillar / seo.pillar_path (and hub seo.main_keyword if empty).
 *
 * Use:
 *   npx tsx scripts/admin/migrate-blog-cluster-to-seo.ts
 *   npx tsx scripts/admin/migrate-blog-cluster-to-seo.ts --write
 */

import { fileURLToPath } from "url";

export interface BackfillBlogClusterOptions {
  csvPath?: string;
  blogRoot?: string;
  dryRun?: boolean;
}

export interface BackfillResultItem {
  id: string;
  src?: string;
  status: string;
  reason?: string;
}

export interface BackfillBlogClusterResult {
  message: string;
  remappedCount: number;
  skippedCount: number;
  errorCount: number;
  results: BackfillResultItem[];
}

const RETIRED =
  "backfill-blog-cluster-keywords is retired. Holding columns were migrated to seo.*. Run scripts/admin/migrate-blog-cluster-to-seo.ts instead.";

export async function backfillBlogClusterKeywords(
  _options: BackfillBlogClusterOptions = {},
): Promise<BackfillBlogClusterResult> {
  return {
    message: RETIRED,
    remappedCount: 0,
    skippedCount: 0,
    errorCount: 1,
    results: [{ id: "retired", status: "error", reason: RETIRED }],
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  console.error(RETIRED);
  process.exit(1);
}
