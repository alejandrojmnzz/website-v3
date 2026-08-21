#!/usr/bin/env tsx
/**
 * Validate sites.yml structure and semantic rules (aliases, inherit, fallback).
 * Wired into prebuild — does not check content-folder scaffolds (see check:sites).
 */

process.env.LOG_LEVEL = "silent";

const { requireSiteConfigs, getBucketName } = await import("../server/site-config");

try {
  const sites = requireSiteConfigs();
  const bucket = getBucketName();
  console.log(
    `sites.yml OK — ${sites.length} site${sites.length === 1 ? "" : "s"}` +
      (bucket ? `, bucket_name=${bucket}` : ""),
  );
  for (const site of sites) {
    const bits = [site.contentFolder];
    if (site.inheritComponentsFrom) bits.push(`inherit=${site.inheritComponentsFrom}`);
    if (site.fallbackContentFolder) bits.push(`fallback=${site.fallbackContentFolder}`);
    if (site.aliases?.length) bits.push(`aliases=${site.aliases.join(",")}`);
    console.log(`  ${site.domain} → ${bits.join(", ")}`);
  }
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
