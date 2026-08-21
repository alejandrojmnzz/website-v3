/**
 * Enable seo_monitoring on existing cluster participant content types.
 * Run: npx tsx scripts/admin/enable-seo-monitoring.ts [--content-root site_4geeks-com] [--dry-run]
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { SEO_MONITORING_MIGRATION_TYPES } from "../../server/seo-monitoring";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rootArg = args.find((a) => a.startsWith("--content-root="))?.split("=")[1];
const contentRoot = rootArg || "site_4geeks-com";
const configPath = path.join(process.cwd(), contentRoot, "content-types.yml");

if (!fs.existsSync(configPath)) {
  console.error("config not found:", configPath);
  process.exit(1);
}

const parsed = yaml.load(fs.readFileSync(configPath, "utf-8")) as Record<string, Record<string, unknown>>;
let touched = 0;

for (const type of SEO_MONITORING_MIGRATION_TYPES) {
  const entry = parsed[type];
  if (!entry || typeof entry !== "object") {
    console.warn("skip missing type:", type);
    continue;
  }
  const existing = entry.seo_monitoring as Record<string, unknown> | undefined;
  if (existing?.enabled === true && existing?.require_cluster === true) {
    console.log("already enabled:", type);
    continue;
  }
  entry.seo_monitoring = { enabled: true, require_cluster: true };
  touched++;
  console.log("enable seo_monitoring:", type);
}

if (touched === 0) {
  console.log("no changes");
  process.exit(0);
}

if (dryRun) {
  console.log("dry-run — would update", touched, "types");
  process.exit(0);
}

fs.writeFileSync(configPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true, sortKeys: false }), "utf-8");
console.log("updated", configPath, "types:", touched);
