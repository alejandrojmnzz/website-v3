#!/usr/bin/env tsx
/**
 * Pull site content folders from GitHub (hash-diff by default).
 * Does not require the Express server or Sync UI.
 * Needs GITHUB_TOKEN + github_repo_url in sites.yml (GITHUB_SYNC_ENABLED not required).
 *
 * Usage:
 *   npm run content:pull
 *   npm run content:pull -- --force
 *   npm run content:pull -- --required   # exit 1 if GitHub is not configured for any site
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

process.env.LOG_LEVEL = "silent";

const { requireSiteConfigs } = await import("../server/site-config");
const {
  bootstrapContentFromRemote,
  getBootstrapState,
  isGitHubConfigured,
} = await import("../server/github");

type SiteConfig = import("../server/site-config").SiteConfig;

const BAR_WIDTH = 20;
const POLL_MS = 150;
const SEPARATOR = "─".repeat(40);

export interface ContentPullOptions {
  force?: boolean;
  /** Exit non-zero when a site has github_repo_url but GitHub is not configured. */
  required?: boolean;
  quiet?: boolean;
}

export interface ContentPullSiteResult {
  domain: string;
  contentFolder: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  pulled?: number;
  skippedFiles?: number;
  errors?: string[];
  commitSha?: string | null;
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
  force: boolean,
): Promise<{
  success: boolean;
  pulled: number;
  skipped: number;
  errors: string[];
  commitSha: string | null;
  cancelled?: boolean;
}> {
  const bootstrapPromise = bootstrapContentFromRemote({
    repoUrl,
    contentRoot: contentFolder,
    force,
  });

  let lastLine = "";
  const prefix = "        ↓ ";

  while (true) {
    const done = await Promise.race([
      bootstrapPromise.then(() => true as const),
      new Promise<false>((resolve) => setTimeout(resolve, POLL_MS)),
    ]);

    const state = getBootstrapState(contentFolder);
    const line = prefix + renderProgressBar(state.pulled + state.skipped, state.total);
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

export async function pullAllSitesContent(
  opts: ContentPullOptions = {},
): Promise<{ ok: boolean; results: ContentPullSiteResult[] }> {
  const force = opts.force === true;
  const required = opts.required === true;
  const log = opts.quiet
    ? () => {}
    : (...args: unknown[]) => console.log(...args);

  const sites = requireSiteConfigs();
  log(
    `Pulling content (${sites.length} site${sites.length === 1 ? "" : "s"} from sites.yml)` +
      `${force ? " [force]" : " [hash-diff]"}...\n`,
  );

  const results: ContentPullSiteResult[] = [];

  for (let i = 0; i < sites.length; i++) {
    const site: SiteConfig = sites[i];
    const header = `  [${i + 1}/${sites.length}] ${site.domain} → ${site.contentFolder}`;
    log(header);

    if (!site.githubRepoUrl) {
      const reason = "no github_repo_url in sites.yml";
      log(`        ⊘ skipped — ${reason}`);
      results.push({
        domain: site.domain,
        contentFolder: site.contentFolder,
        ok: !required,
        skipped: true,
        reason,
      });
      log("");
      continue;
    }

    if (!isGitHubConfigured(site.githubRepoUrl)) {
      const reason =
        "GITHUB_TOKEN not set or repo URL invalid — cannot pull. Set GITHUB_TOKEN in .env.";
      log(`        ✗ ${reason}`);
      results.push({
        domain: site.domain,
        contentFolder: site.contentFolder,
        ok: false,
        skipped: true,
        reason,
      });
      log("");
      continue;
    }

    const shortRepo = site.githubRepoUrl.replace(/^https?:\/\//, "");
    log(`        pulling from ${shortRepo} ...`);

    try {
      const result = await bootstrapWithProgress(
        site.contentFolder,
        site.githubRepoUrl,
        force,
      );

      if (result.cancelled) {
        log(
          `        ✗ cancelled (pulled=${result.pulled} skipped=${result.skipped})`,
        );
        results.push({
          domain: site.domain,
          contentFolder: site.contentFolder,
          ok: false,
          pulled: result.pulled,
          skippedFiles: result.skipped,
          errors: result.errors,
          commitSha: result.commitSha,
          reason: "cancelled",
        });
      } else if (result.errors.length > 0 && !result.success) {
        log(
          `        ✗ failed — pulled=${result.pulled} errors=${result.errors.length}`,
        );
        if (result.errors[0]) log(`          ${result.errors[0]}`);
        results.push({
          domain: site.domain,
          contentFolder: site.contentFolder,
          ok: false,
          pulled: result.pulled,
          skippedFiles: result.skipped,
          errors: result.errors,
          commitSha: result.commitSha,
        });
      } else {
        const sha = result.commitSha ? ` @ ${result.commitSha.slice(0, 7)}` : "";
        log(
          `        ✓ pulled=${result.pulled} skipped=${result.skipped}${sha}`,
        );
        if (result.errors.length > 0) {
          log(`        ⚠ ${result.errors.length} file(s) had errors`);
        }
        results.push({
          domain: site.domain,
          contentFolder: site.contentFolder,
          ok: result.errors.length === 0,
          pulled: result.pulled,
          skippedFiles: result.skipped,
          errors: result.errors,
          commitSha: result.commitSha,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`        ✗ ${msg}`);
      results.push({
        domain: site.domain,
        contentFolder: site.contentFolder,
        ok: false,
        reason: msg,
        errors: [msg],
      });
    }

    log("");
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    log(`${sites.length} site(s) pull finished OK`);
    return { ok: true, results };
  }

  log(SEPARATOR);
  log(`FAILED — ${failed.length} of ${sites.length} site(s)\n`);
  for (const site of failed) {
    log(`  ${site.domain} (${site.contentFolder})`);
    if (site.reason) log(`    ${site.reason}`);
    if (site.errors?.length) {
      for (const e of site.errors.slice(0, 3)) log(`    error: ${e}`);
    }
    log("");
  }
  log("Recovery: set GITHUB_TOKEN in .env, confirm github_repo_url in sites.yml, then retry.");
  log("Or use GitHub Sync in the Debug bubble once the server is running.");

  return { ok: false, results };
}

function parseArgs(argv: string[]): ContentPullOptions {
  return {
    force: argv.includes("--force"),
    required: argv.includes("--required"),
  };
}

const isMain =
  process.argv[1]?.endsWith("content-pull.ts") ||
  process.argv[1]?.endsWith("content-pull.js");

if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  pullAllSitesContent(opts)
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
