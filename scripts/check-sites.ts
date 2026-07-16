#!/usr/bin/env tsx
/**
 * Pre-dev site folder validation + optional GitHub bootstrap.
 * Required structure mirrors the scaffold in server/routes/admin.ts.
 */

import fs from "fs";
import path from "path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

process.env.LOG_LEVEL = "silent";

const { requireSiteConfigs } = await import("../server/site-config");
const {
  bootstrapContentFromRemote,
  getBootstrapState,
  isGitHubConfigured,
  writeBootstrapCompleteFlag,
} = await import("../server/github");
const { ensureSiteScaffold } = await import("../server/site-scaffold");

type SiteConfig = import("../server/site-config").SiteConfig;

const REQUIRED_DIRS = ["images", "menus", "pages"] as const;
const REQUIRED_FILES = [
  "settings.yml",
  "content-types.yml",
  "image-registry.json",
  "custom-redirects.yml",
] as const;

const BAR_WIDTH = 20;
const POLL_MS = 150;
const SEPARATOR = "─".repeat(40);

interface ValidationResult {
  ok: boolean;
  issues: string[];
}

interface SiteResult {
  domain: string;
  contentFolder: string;
  githubRepoUrl?: string;
  ok: boolean;
  missing: string[];
  remoteNote?: string;
  bootstrapNote?: string;
}

function validateSiteStructure(folderPath: string): ValidationResult {
  const issues: string[] = [];

  if (!fs.existsSync(folderPath)) {
    issues.push("folder missing");
    return { ok: false, issues };
  }

  if (!fs.statSync(folderPath).isDirectory()) {
    issues.push("not a directory");
    return { ok: false, issues };
  }

  for (const dir of REQUIRED_DIRS) {
    const dirPath = path.join(folderPath, dir);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      issues.push(`${dir}/`);
    }
  }

  for (const file of REQUIRED_FILES) {
    const filePath = path.join(folderPath, file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      issues.push(file);
    }
  }

  return { ok: issues.length === 0, issues };
}

function renderProgressBar(pulled: number, total: number): string {
  if (total <= 0) {
    return `[${"░".repeat(BAR_WIDTH)}] Fetching file list...`;
  }
  const pct = Math.min(100, Math.round((pulled / total) * 100));
  const filled = Math.round((pulled / total) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  return `[${bar}] ${pulled}/${total} (${pct}%)`;
}

function clearProgressLine(line: string): void {
  process.stdout.write(`\r${" ".repeat(line.length + 8)}\r`);
}

async function bootstrapWithProgress(
  contentFolder: string,
  repoUrl: string,
): Promise<{
  success: boolean;
  pulled: number;
  errors: string[];
}> {
  const bootstrapPromise = bootstrapContentFromRemote({
    repoUrl,
    contentRoot: contentFolder,
  });

  let lastLine = "";
  const prefix = "        ↓ ";

  while (true) {
    const done = await Promise.race([
      bootstrapPromise.then(() => true as const),
      new Promise<false>((resolve) => setTimeout(resolve, POLL_MS)),
    ]);

    const state = getBootstrapState(contentFolder);
    const line = prefix + renderProgressBar(state.pulled, state.total);
    if (line !== lastLine) {
      process.stdout.write(`\r${line}`);
      lastLine = line;
    }

    if (done) break;
  }

  if (lastLine) {
    clearProgressLine(lastLine);
  }

  return bootstrapPromise;
}

function formatMissingList(issues: string[]): string {
  return issues.join(", ");
}

function scaffoldDisplayName(site: SiteConfig): string {
  return site.domain || site.contentFolder.replace(/^site_/, "");
}

async function promptCreateLocalScaffold(domain: string, contentFolder: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const question =
      `\n        No content found in the remote repo for ${domain} (${contentFolder}).\n` +
      `        Create a simple local site scaffold? It will sync via GitHub sync. [y/N] `;
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function tryCreateLocalScaffold(site: SiteConfig): Promise<boolean> {
  const shouldCreate = await promptCreateLocalScaffold(site.domain, site.contentFolder);
  if (!shouldCreate) {
    console.log("        skipped — scaffold not created");
    return false;
  }

  ensureSiteScaffold({
    contentFolder: site.contentFolder,
    displayName: scaffoldDisplayName(site),
    includeSampleContent: true,
  });
  writeBootstrapCompleteFlag(site.contentFolder);
  console.log("        ✓ local scaffold created");
  return true;
}

async function ensureSite(
  site: SiteConfig,
  index: number,
  total: number,
): Promise<SiteResult> {
  const folderPath = path.join(process.cwd(), site.contentFolder);
  const header = `  [${index}/${total}] ${site.domain} → ${site.contentFolder}`;
  console.log(header);

  let validation = validateSiteStructure(folderPath);

  if (validation.ok) {
    console.log("        ✓ OK");
    return {
      domain: site.domain,
      contentFolder: site.contentFolder,
      githubRepoUrl: site.githubRepoUrl,
      ok: true,
      missing: [],
    };
  }

  console.log("        ✗ incomplete");

  let remoteNote: string | undefined;
  let bootstrapNote: string | undefined;

  if (site.githubRepoUrl && isGitHubConfigured(site.githubRepoUrl)) {
    const shortRepo = site.githubRepoUrl.replace(/^https?:\/\//, "");
    console.log(`        bootstrapping from ${shortRepo} ...`);

    const result = await bootstrapWithProgress(site.contentFolder, site.githubRepoUrl);

    if (result.pulled > 0) {
      bootstrapNote = `downloaded ${result.pulled} file(s)`;
      console.log(`        ✓ ${bootstrapNote}`);
    } else if (result.success) {
      remoteNote = `no files found under ${site.contentFolder}/ in ${site.githubRepoUrl}`;
      console.log(`        ✗ ${remoteNote}`);
    }

    if (result.errors.length > 0) {
      bootstrapNote = `${result.errors.length} file(s) failed`;
      console.log(`        ✗ bootstrap: ${bootstrapNote}`);
    }

    validation = validateSiteStructure(folderPath);
    if (validation.ok) {
      return {
        domain: site.domain,
        contentFolder: site.contentFolder,
        githubRepoUrl: site.githubRepoUrl,
        ok: true,
        missing: [],
        remoteNote,
        bootstrapNote,
      };
    }

    if (remoteNote?.startsWith("no files found")) {
      const created = await tryCreateLocalScaffold(site);
      if (created) {
        validation = validateSiteStructure(folderPath);
        if (validation.ok) {
          return {
            domain: site.domain,
            contentFolder: site.contentFolder,
            githubRepoUrl: site.githubRepoUrl,
            ok: true,
            missing: [],
            remoteNote,
            bootstrapNote: "local scaffold created",
          };
        }
      }
    }
  }

  return {
    domain: site.domain,
    contentFolder: site.contentFolder,
    githubRepoUrl: site.githubRepoUrl,
    ok: false,
    missing: validation.issues,
    remoteNote,
    bootstrapNote,
  };
}

async function main(): Promise<void> {
  const sites = requireSiteConfigs();
  console.log(`Checking site folders (${sites.length} site${sites.length === 1 ? "" : "s"} from sites.yml)...\n`);

  const results: SiteResult[] = [];
  for (let i = 0; i < sites.length; i++) {
    results.push(await ensureSite(sites[i], i + 1, sites.length));
    console.log("");
  }

  const failed = results.filter((result) => !result.ok);

  if (failed.length === 0) {
    console.log(`${sites.length} site folder(s) OK`);
    process.exit(0);
  }

  console.log(SEPARATOR);
  console.log(`FAILED — ${failed.length} of ${sites.length} sites not ready\n`);

  for (const site of failed) {
    console.log(`  ${site.domain} (${site.contentFolder})`);
    if (site.missing.length > 0) {
      console.log(`    missing: ${formatMissingList(site.missing)}`);
    }
    if (site.remoteNote) {
      console.log(`    remote:  ${site.remoteNote}`);
    } else if (site.bootstrapNote) {
      console.log(`    bootstrap: ${site.bootstrapNote}`);
    } else if (!site.githubRepoUrl) {
      console.log("    remote:  no github_repo_url configured in sites.yml");
    } else if (!isGitHubConfigured(site.githubRepoUrl)) {
      console.log("    remote:  GITHUB_TOKEN not set — cannot auto-download");
    }
    console.log("");
  }

  console.log("Set GITHUB_TOKEN in .env to auto-download content, or populate folders manually.");
  console.log("When a site is missing from the remote repo, run interactively to create a local scaffold.");
  console.log("Content folders are gitignored and are not included in git clone.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
