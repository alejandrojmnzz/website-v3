/**
 * One-off admin script: merge repo-defined aliases into the canonical
 * sites.yml copy in GCS (task: www→4geeks.com redirect broken in prod).
 *
 * Usage: tsx scripts/fix-gcs-sites-yml-aliases.ts [--dry-run]
 */
import fs from "fs";
import path from "path";
import { Storage } from "@google-cloud/storage";
import { platformSitesYmlGcsKey, platformSitesYmlReadKeys } from "../shared/gcsKeys";
import { mergeMissingAliases, diffSitesYmlStructure } from "../server/sites-yml-store";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const bucketName = process.env.GCS_BUCKET_NAME;
  const credsJson = process.env.GCS_CREDENTIALS_JSON;
  if (!bucketName || !credsJson) throw new Error("GCS_BUCKET_NAME / GCS_CREDENTIALS_JSON not set");

  const storage = new Storage({ credentials: JSON.parse(credsJson) });
  const bucket = storage.bucket(bucketName);

  let key: string | null = null;
  let canonical: string | null = null;
  for (const k of platformSitesYmlReadKeys()) {
    const file = bucket.file(k);
    const [exists] = await file.exists();
    if (exists) {
      const [data] = await file.download();
      key = k;
      canonical = data.toString("utf-8");
      break;
    }
  }
  if (!canonical || !key) {
    console.log("No canonical sites.yml found in GCS — nothing to merge.");
    return;
  }
  console.log(`Found canonical copy at gs://${bucketName}/${key}\n---\n${canonical}\n---`);

  const repoContent = fs.readFileSync(path.join(process.cwd(), "sites.yml"), "utf-8");
  const diffs = diffSitesYmlStructure(repoContent, canonical);
  if (diffs.length) console.log("Divergence vs repo:", diffs);

  const merge = mergeMissingAliases(repoContent, canonical);
  if (!merge.changed) {
    console.log("No aliases missing — canonical copy already up to date.");
    return;
  }
  console.log("Aliases to add:", merge.added);
  console.log(`Merged result:\n---\n${merge.content}\n---`);

  if (dryRun) {
    console.log("[dry-run] Not uploading.");
    return;
  }
  // Always write to the primary key (legacy key readers fall back to it last).
  const targetKey = platformSitesYmlGcsKey();
  await bucket.file(targetKey).save(Buffer.from(merge.content, "utf-8"), {
    contentType: "application/x-yaml",
  });
  console.log(`Uploaded merged sites.yml to gs://${bucketName}/${targetKey}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
