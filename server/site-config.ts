import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { child } from "./logger";

const log = child({ module: "site-config" });

export interface SiteConfig {
  domain: string;
  contentFolder: string;
  githubRepoUrl?: string;
}

let _cached: SiteConfig[] | null = null;

export function getSiteConfigs(): SiteConfig[] {
  if (_cached) return _cached;

  const sitesYml = path.join(process.cwd(), "sites.yml");

  if (fs.existsSync(sitesYml)) {
    try {
      const raw = fs.readFileSync(sitesYml, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const configs: SiteConfig[] = [];
        for (const [domain, config] of Object.entries(parsed)) {
          if (config && typeof config === "object") {
            const c = config as Record<string, unknown>;
            configs.push({
              domain,
              contentFolder: (c.content_folder as string) || (c.contentFolder as string) || "default-site-content",
              githubRepoUrl: (c.github_repo_url as string) || (c.githubRepoUrl as string) || undefined,
            });
          }
        }
        if (configs.length > 0) {
          log.info(`[SiteConfig] Loaded ${configs.length} site(s) from sites.yml`);
          _cached = configs;
          return _cached;
        }
      }
    } catch (err) {
      log.error({ err }, "[SiteConfig] Failed to parse sites.yml — falling back to single-site mode");
    }
  }

  const contentFolder = process.env.CONTENT_FOLDER || "default-site-content";
  const githubRepoUrl = process.env.GITHUB_REPO_URL || undefined;
  let domain = "localhost";
  if (process.env.SITE_URL) {
    try {
      domain = new URL(process.env.SITE_URL).hostname;
    } catch {}
  }

  log.info(`[SiteConfig] Single-site mode: contentFolder="${contentFolder}", domain="${domain}"`);
  _cached = [{ domain, contentFolder, githubRepoUrl }];
  return _cached;
}

export function isMultiSiteMode(): boolean {
  const configs = getSiteConfigs();
  return configs.length > 1;
}

export function resetSiteConfigs(): void {
  _cached = null;
}
