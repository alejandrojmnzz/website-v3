/**
 * GitHub API utility for committing content changes directly to the repository.
 * Used in production to sync content edits back to the main branch.
 * 
 * IMPORTANT: This module does NOT use git CLI commands.
 * All operations use GitHub's REST API to work in production environments
 * where git CLI may not be available (e.g., Replit deployments).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getAllDirectories } from './content-types';
import {
  detectPendingChanges,
  getLastSyncedCommit,
  updateSyncStateAfterCommit,
  markFileAsModified,
  loadSyncState,
  saveSyncState,
  computeFileSha,
  type PendingChange,
} from './sync-state';
import { child } from "./logger";
const log = child({ module: "github" });


interface GitHubCommitOptions {
  filePath: string;
  content: string;
  message: string;
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

interface GitHubFileResponse {
  sha?: string;
  content?: string;
}

export { PendingChange, markFileAsModified };

/**
 * Get the current file's SHA (required for updates)
 */
async function getFileSha(config: GitHubConfig, filePath: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${config.branch}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (response.status === 404) {
      return null; // File doesn't exist yet
    }
    
    if (!response.ok) {
      log.error('GitHub API error getting file SHA:', response.status, await response.text());
      return null;
    }
    
    const data: GitHubFileResponse = await response.json();
    return data.sha || null;
  } catch (error) {
    log.error({ err: error }, 'Error getting file SHA from GitHub:');
    return null;
  }
}

/**
 * Parse GitHub repo URL to extract owner and repo name
 * Supports formats like:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - github.com/owner/repo
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    // Remove .git suffix if present
    const cleanUrl = url.replace(/\.git$/, '');
    
    // Try to extract owner/repo from the URL
    const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Commit a file to the GitHub repository
 */
export async function commitToGitHub(options: GitHubCommitOptions): Promise<{ success: boolean; error?: string; commitUrl?: string }> {
  // Get config from environment variables
  const token = process.env.GITHUB_TOKEN || '';
  const repoUrl = process.env.GITHUB_REPO_URL || '';
  const branch = process.env.GITHUB_BRANCH || 'main';
  
  // Parse owner/repo from URL
  const parsed = parseGitHubUrl(repoUrl);
  
  const config: GitHubConfig = {
    token,
    owner: parsed?.owner || '',
    repo: parsed?.repo || '',
    branch,
  };
  
  // Check if GitHub sync is enabled (defaults to false)
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
  
  // Validate config
  if (!config.token || !config.owner || !config.repo) {
    // If sync is enabled but not configured, return an error
    if (syncEnabled) {
      return { 
        success: false, 
        error: "GitHub integration not configured (missing GITHUB_TOKEN or GITHUB_REPO_URL)" 
      };
    }
    // If sync is disabled, silently skip
    return { success: true };
  }
  
  // If sync is disabled, skip even if configured
  if (!syncEnabled) {
    return { success: true };
  }
  
  try {
    // Get current file SHA (required for updating existing files)
    const sha = await getFileSha(config, options.filePath);
    
    // Prepare the request body
    const body: Record<string, string> = {
      message: options.message,
      content: Buffer.from(options.content).toString('base64'),
      branch: config.branch,
    };
    
    // Include SHA if file exists (for update)
    if (sha) {
      body.sha = sha;
    }
    
    // Make the commit via GitHub Contents API
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${options.filePath}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      log.error('GitHub API error:', response.status, errorText);
      return { 
        success: false, 
        error: `GitHub API error: ${response.status}` 
      };
    }
    
    const data = await response.json();
    const commitUrl = data.commit?.html_url;
    
    log.info(`Content committed to GitHub: ${options.filePath}`);
    if (commitUrl) {
      log.info(`Commit URL: ${commitUrl}`);
    }
    
    return { success: true, commitUrl };
  } catch (error) {
    log.error({ err: error }, 'Error committing to GitHub:');
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Check if GitHub integration is configured
 */
export function isGitHubConfigured(repoUrl?: string): boolean {
  const url = repoUrl || process.env.GITHUB_REPO_URL || '';
  const parsed = parseGitHubUrl(url);
  return !!(process.env.GITHUB_TOKEN && parsed?.owner && parsed?.repo);
}

/**
 * Fetch all content-folder files from a commit tree.
 * Used when there's no lastSyncedCommit to compare against.
 * @param contentFolder - relative content folder name (e.g. "4geeks-com"); defaults to CONTENT_FOLDER env var
 */
async function fetchFilesFromTree(config: GitHubConfig, commitSha: string, contentFolder?: string): Promise<string[]> {
  const folder = contentFolder || process.env.CONTENT_FOLDER || 'content';
  try {
    // Get the tree for the commit recursively
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees/${commitSha}?recursive=1`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error fetching tree:');
      return [];
    }
    
    const data = await response.json();
    
    // Filter to files in this site's content folder only
    const files: string[] = (data.tree || [])
      .filter((item: any) => item.type === 'blob' && item.path.startsWith(`${folder}/`))
      .map((item: any) => item.path);
    
    return files;
  } catch (error) {
    log.error({ err: error }, 'Error fetching files from tree:');
    return [];
  }
}

/**
 * Get GitHub config from environment variables
 */
export function getGitHubConfig(repoUrl?: string): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN || '';
  const url = repoUrl || process.env.GITHUB_REPO_URL || '';
  const branch = process.env.GITHUB_BRANCH || 'main';
  
  const parsed = parseGitHubUrl(url);
  if (!token || !parsed) return null;
  
  return {
    token,
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
  };
}

interface GitHubBranchRef {
  ref: string;
  object: {
    sha: string;
    type: string;
  };
}

export interface GitHubSyncStatus {
  configured: boolean;
  syncEnabled: boolean;
  localCommit: string | null;
  remoteCommit: string | null;
  status: 'in-sync' | 'behind' | 'ahead' | 'diverged' | 'unknown' | 'not-configured' | 'invalid-credentials';
  behindBy?: number;
  aheadBy?: number;
  repoUrl?: string;
  branch?: string;
}

/**
 * Get list of pending changes in 4geeks-com directory
 * Uses file hash comparison instead of git status
 */
export async function getPendingChanges(): Promise<PendingChange[]> {
  return detectPendingChanges();
}

/**
 * Create a blob in the GitHub repository
 */
async function createBlob(config: GitHubConfig, content: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/blobs`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        content: Buffer.from(content).toString('base64'),
        encoding: 'base64',
      }),
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error creating blob:');
      return null;
    }
    
    const data = await response.json();
    return data.sha;
  } catch (error) {
    log.error({ err: error }, 'Error creating blob:');
    return null;
  }
}

/**
 * Get the current tree SHA for a commit
 */
async function getTreeSha(config: GitHubConfig, commitSha: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits/${commitSha}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error getting commit:');
      return null;
    }
    
    const data = await response.json();
    return data.tree?.sha || null;
  } catch (error) {
    log.error({ err: error }, 'Error getting tree SHA:');
    return null;
  }
}

/**
 * Create a new tree with updated files
 */
async function createTree(
  config: GitHubConfig,
  baseTreeSha: string,
  files: Array<{ path: string; blobSha: string | null; mode?: string }>
): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees`;
  
  const tree = files.map(file => ({
    path: file.path,
    mode: file.mode || '100644',
    type: 'blob' as const,
    sha: file.blobSha,
  }));
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree,
      }),
    });
    
    if (!response.ok) {
      log.error('GitHub API error creating tree:', response.status, await response.text());
      return null;
    }
    
    const data = await response.json();
    return data.sha;
  } catch (error) {
    log.error({ err: error }, 'Error creating tree:');
    return null;
  }
}

/**
 * Create a new commit
 */
async function createCommitObject(
  config: GitHubConfig,
  message: string,
  treeSha: string,
  parentSha: string
): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [parentSha],
      }),
    });
    
    if (!response.ok) {
      log.error('GitHub API error creating commit:', response.status, await response.text());
      return null;
    }
    
    const data = await response.json();
    return data.sha;
  } catch (error) {
    log.error({ err: error }, 'Error creating commit:');
    return null;
  }
}

/**
 * Update branch ref to point to new commit
 */
async function updateBranchRef(
  config: GitHubConfig,
  commitSha: string,
  force: boolean = false
): Promise<boolean> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/refs/heads/${config.branch}`;
  
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        sha: commitSha,
        force,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      log.error('GitHub API error updating ref:', response.status, errorText);
      return false;
    }
    
    return true;
  } catch (error) {
    log.error({ err: error }, 'Error updating branch ref:');
    return false;
  }
}

/**
 * Get the date of the most recent commit that touched a specific file.
 * Uses the GitHub Commits API filtered by path — returns the file-specific
 * last-change date, not the branch HEAD date.
 * Returns ISO string or null on failure.
 */
async function getFileCommitDate(config: GitHubConfig, filePath: string): Promise<string | null> {
  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(config.branch)}&per_page=1`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const commit = data[0].commit;
    return commit?.committer?.date || commit?.author?.date || null;
  } catch {
    return null;
  }
}

/**
 * Get the current branch HEAD SHA
 */
async function getBranchHeadSha(config: GitHubConfig): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/ref/heads/${config.branch}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error getting branch head:');
      return null;
    }
    
    const data = await response.json();
    return data.object?.sha || null;
  } catch (error) {
    log.error({ err: error }, 'Error getting branch head:');
    return null;
  }
}

/**
 * Commit all pending changes with a custom message using GitHub API
 * This method uses the Git Data API: create blobs → create tree → create commit → update ref
 */
export async function commitAndPush(
  message: string,
  options?: { force?: boolean; files?: string[]; repoUrl?: string; contentRoot?: string }
): Promise<{ success: boolean; error?: string; commitHash?: string }> {
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
  
  if (!syncEnabled) {
    return { success: false, error: "GitHub sync is not enabled" };
  }
  
  const config = getGitHubConfig(options?.repoUrl);
  if (!config) {
    return { success: false, error: "GitHub not configured (missing GITHUB_TOKEN or GITHUB_REPO_URL)" };
  }
  
  try {
    const allPendingChanges = detectPendingChanges(options?.contentRoot);
    const pendingChanges = options?.files?.length
      ? allPendingChanges.filter(c => options.files!.includes(c.file))
      : allPendingChanges;

    if (pendingChanges.length === 0) {
      return { success: false, error: "No pending changes to commit" };
    }
    
    const currentHeadSha = await getBranchHeadSha(config);
    if (!currentHeadSha) {
      return { success: false, error: "Could not get current branch HEAD" };
    }
    
    const lastSyncedCommit = getLastSyncedCommit(options?.contentRoot);
    if (lastSyncedCommit && lastSyncedCommit !== currentHeadSha && !options?.force) {
      return { 
        success: false, 
        error: "Remote has new commits. Please sync before committing, or use force commit." 
      };
    }
    
    const baseTreeSha = await getTreeSha(config, currentHeadSha);
    if (!baseTreeSha) {
      return { success: false, error: "Could not get base tree" };
    }
    
    const treeEntries: Array<{ path: string; blobSha: string | null }> = [];
    const committedFiles: string[] = [];
    
    for (const change of pendingChanges) {
      if (change.status === 'deleted') {
        treeEntries.push({ path: change.file, blobSha: null });
        committedFiles.push(change.file);
      } else {
        const fullPath = path.join(process.cwd(), change.file);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const blobSha = await createBlob(config, content);
          if (!blobSha) {
            return { success: false, error: `Failed to create blob for ${change.file}` };
          }
          treeEntries.push({ path: change.file, blobSha });
          committedFiles.push(change.file);
        }
      }
    }
    
    const newTreeSha = await createTree(config, baseTreeSha, treeEntries);
    if (!newTreeSha) {
      return { success: false, error: "Failed to create tree" };
    }
    
    const newCommitSha = await createCommitObject(config, message, newTreeSha, currentHeadSha);
    if (!newCommitSha) {
      return { success: false, error: "Failed to create commit" };
    }
    
    const updated = await updateBranchRef(config, newCommitSha, options?.force);
    if (!updated) {
      return { success: false, error: "Failed to update branch ref" };
    }
    
    updateSyncStateAfterCommit(newCommitSha, committedFiles, options?.contentRoot);
    
    log.info(`Committed and pushed to GitHub via API: ${newCommitSha}`);
    return { success: true, commitHash: newCommitSha };
  } catch (error) {
    log.error({ err: error }, 'Error committing and pushing:');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

/**
 * Get the sync status between local and remote GitHub repository
 * Uses stored lastSyncedCommit from sync-state instead of git CLI
 */
export async function getGitHubSyncStatus(): Promise<GitHubSyncStatus> {
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
  const autoCommitEnabled = syncEnabled && process.env.GITHUB_AUTO_COMMIT_ENABLED === 'true';
  const autoPullEnabled = syncEnabled && process.env.GITHUB_AUTO_PULL_ENABLED === 'true';
  const config = getGitHubConfig();
  
  if (!config) {
    return {
      configured: false,
      syncEnabled,
      autoCommitEnabled,
      autoPullEnabled,
      localCommit: null,
      remoteCommit: null,
      status: 'not-configured',
    };
  }
  
  try {
    const localCommit = getLastSyncedCommit();
    
    const remoteCommit = await getBranchHeadSha(config);
    
    if (!remoteCommit) {
      return {
        configured: true,
        syncEnabled,
        autoCommitEnabled,
        autoPullEnabled,
        localCommit,
        remoteCommit: null,
        status: 'unknown',
        repoUrl: process.env.GITHUB_REPO_URL,
        branch: config.branch,
      };
    }
    
    if (!localCommit) {
      return {
        configured: true,
        syncEnabled,
        autoCommitEnabled,
        autoPullEnabled,
        localCommit: null,
        remoteCommit,
        status: 'behind',
        repoUrl: process.env.GITHUB_REPO_URL,
        branch: config.branch,
      };
    }
    
    if (localCommit === remoteCommit) {
      const pendingChanges = detectPendingChanges();
      const hasPendingChanges = pendingChanges.length > 0;
      
      return {
        configured: true,
        syncEnabled,
        autoCommitEnabled,
        autoPullEnabled,
        localCommit,
        remoteCommit,
        status: hasPendingChanges ? 'ahead' : 'in-sync',
        aheadBy: hasPendingChanges ? pendingChanges.length : 0,
        repoUrl: process.env.GITHUB_REPO_URL,
        branch: config.branch,
      };
    }
    
    return {
      configured: true,
      syncEnabled,
      autoCommitEnabled,
      autoPullEnabled,
      localCommit,
      remoteCommit,
      status: 'behind',
      repoUrl: process.env.GITHUB_REPO_URL,
      branch: config.branch,
    };
  } catch (error) {
    log.error({ err: error }, 'Error checking GitHub sync status:');
    return {
      configured: true,
      syncEnabled,
      autoCommitEnabled,
      autoPullEnabled,
      localCommit: null,
      remoteCommit: null,
      status: 'unknown',
      repoUrl: process.env.GITHUB_REPO_URL,
      branch: config?.branch,
    };
  }
}

export interface RemoteCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  files: string[];
}

export interface ConflictInfo {
  hasConflict: boolean;
  behindBy: number;
  commits: RemoteCommit[];
  changedFiles: string[];  // All files changed between lastSyncedCommit and remoteCommit
  fileBlobShas: Record<string, string>;  // Map of filename → Git blob SHA from remote
  lastSyncedCommit: string | null;
  remoteCommit: string | null;
}

/**
 * Get detailed conflict information including missed commits and changed files
 * Uses GitHub Compare API to fetch commits between lastSyncedCommit and current HEAD
 */
export async function getConflictInfo(): Promise<ConflictInfo> {
  const config = getGitHubConfig();
  
  if (!config) {
    return {
      hasConflict: false,
      behindBy: 0,
      commits: [],
      changedFiles: [],
      fileBlobShas: {},
      lastSyncedCommit: null,
      remoteCommit: null,
    };
  }
  
  const lastSyncedCommit = getLastSyncedCommit();
  const remoteCommit = await getBranchHeadSha(config);
  
  if (!remoteCommit) {
    return {
      hasConflict: false,
      behindBy: 0,
      commits: [],
      changedFiles: [],
      fileBlobShas: {},
      lastSyncedCommit,
      remoteCommit: null,
    };
  }
  
  if (!lastSyncedCommit || lastSyncedCommit === remoteCommit) {
    if (!lastSyncedCommit && remoteCommit) {
      const changedFiles = await fetchFilesFromTree(config, remoteCommit);
      return {
        hasConflict: true,
        behindBy: 1,
        commits: [],
        changedFiles,
        fileBlobShas: {},
        lastSyncedCommit,
        remoteCommit,
      };
    }
    return {
      hasConflict: false,
      behindBy: 0,
      commits: [],
      changedFiles: [],
      fileBlobShas: {},
      lastSyncedCommit,
      remoteCommit,
    };
  }
  
  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/compare/${lastSyncedCommit}...${remoteCommit}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error comparing commits:');
      return {
        hasConflict: true,
        behindBy: 1,
        commits: [],
        changedFiles: [],
        fileBlobShas: {},
        lastSyncedCommit,
        remoteCommit,
      };
    }
    
    const data = await response.json();
    
    const commits: RemoteCommit[] = (data.commits || []).map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit?.message || '',
      author: commit.commit?.author?.name || commit.author?.login || 'Unknown',
      date: commit.commit?.author?.date || '',
      files: [],
    }));
    
    const changedFiles: string[] = (data.files || []).map((f: any) => f.filename);
    
    const fileBlobShas: Record<string, string> = {};
    for (const f of (data.files || [])) {
      if (f.filename && f.sha) {
        fileBlobShas[f.filename] = f.sha;
      }
    }
    
    if (commits.length > 0 && changedFiles.length > 0) {
      commits[commits.length - 1].files = changedFiles;
    }
    
    return {
      hasConflict: commits.length > 0 || changedFiles.length > 0,
      behindBy: data.behind_by || commits.length,
      commits,
      changedFiles,
      fileBlobShas,
      lastSyncedCommit,
      remoteCommit,
    };
  } catch (error) {
    log.error({ err: error }, 'Error getting conflict info:');
    return {
      hasConflict: true,
      behindBy: 1,
      commits: [],
      changedFiles: [],
      fileBlobShas: {},
      lastSyncedCommit,
      remoteCommit,
    };
  }
}

export interface PullConflictCheck {
  hasConflicts: boolean;
  conflictingFiles: string[];
  localPendingFiles: string[];
  remoteChangedFiles: string[];
}

/**
 * Check if pulling from remote would conflict with pending local changes
 * Returns list of files that exist in both local pending changes and remote changes
 */
export async function checkPullConflicts(): Promise<PullConflictCheck> {
  const pendingChanges = await getPendingChanges();
  const conflictInfo = await getConflictInfo();
  
  // Get all local pending file paths
  const localPendingFiles = pendingChanges.map(c => c.file);
  
  // Use changedFiles directly from conflictInfo (filtered by shouldTrackFile)
  const { shouldTrackFile } = await import("./sync-state");
  const remoteChangedFiles = conflictInfo.changedFiles.filter(f => shouldTrackFile(f));
  
  // Find overlapping files
  const localFileSet = new Set(localPendingFiles);
  const conflictingFiles = remoteChangedFiles.filter(f => localFileSet.has(f));
  
  return {
    hasConflicts: conflictingFiles.length > 0,
    conflictingFiles,
    localPendingFiles,
    remoteChangedFiles,
  };
}

/**
 * Get all sync changes - both local changes that need to be uploaded
 * and incoming remote changes that can be downloaded.
 * Returns unified list with source field indicating the type.
 * 
 * Conflict detection: A file is a conflict only if:
 * 1. It has local changes (localSha differs from remoteSha in sync state)
 * 2. AND it appears in remote changes (remote has commits affecting this file)
 * 3. AND the local change has a remoteSha stored (meaning we've synced before)
 */
export async function getAllSyncChanges(contentFolder?: string): Promise<PendingChange[]> {
  const localChanges = await getPendingChanges();
  const conflictInfo = await getConflictInfo();
  
  // Use changedFiles directly from conflictInfo (filtered by shouldTrackFile)
  const { shouldTrackFile } = await import("./sync-state");
  const remoteChangedFiles = conflictInfo.changedFiles.filter(f => shouldTrackFile(f, undefined, contentFolder));
  const remoteFileSet = new Set(remoteChangedFiles);
  
  // Build maps for file metadata from commits
  // Extract author from commit message [Author: Name] or fall back to commit author
  const fileAuthorMap = new Map<string, string>();
  const fileDateMap = new Map<string, string>();
  const fileCommitShaMap = new Map<string, string>();
  
  for (const commit of conflictInfo.commits) {
    // Try to extract author from commit message format: [Author: Full Name]
    const authorMatch = commit.message.match(/\[Author:\s*([^\]]+)\]/);
    const author = authorMatch ? authorMatch[1].trim() : commit.author;
    
    for (const file of commit.files || []) {
      // Only set if not already set (first commit wins - most recent)
      if (!fileAuthorMap.has(file)) {
        fileAuthorMap.set(file, author);
        fileDateMap.set(file, commit.date);
        fileCommitShaMap.set(file, commit.sha);
      }
    }
  }
  
  // Create a map of local changes for quick lookup
  const localFileMap = new Map(localChanges.map(c => [c.file, c]));
  
  // Build the unified list
  const changes: PendingChange[] = [];
  
  // Add local changes - check if they're also conflicts
  for (const change of localChanges) {
    // A true conflict requires:
    // 1. File appears in remote changes AND
    // 2. The local change has a remoteSha (we've synced this file before)
    // If no remoteSha, it's a new local file - mark as local, not conflict
    const isRemoteChanged = remoteFileSet.has(change.file);
    const hasSyncedBefore = !!change.remoteSha;
    const isConflict = isRemoteChanged && hasSyncedBefore;
    
    changes.push({
      ...change,
      source: isConflict ? 'conflict' : 'local',
      // For conflicts, include the remote author/date/commitSha
      // For local changes, use stored author from sync state (undefined for legacy entries without author tracking)
      author: isConflict ? fileAuthorMap.get(change.file) : change.author,
      date: isConflict ? fileDateMap.get(change.file) : (change.date || new Date().toISOString()),
      // Use specific commit SHA if mapped, otherwise fall back to remoteCommit (HEAD)
      commitSha: isConflict ? (fileCommitShaMap.get(change.file) || conflictInfo.remoteCommit || undefined) : undefined,
    });
  }
  
  // Add incoming changes (files changed on remote but not locally modified)
  // Filter out files that have already been individually pulled from the current remote commit
  const { wasFilePulledFromCommit } = await import("./sync-state");
  const currentRemoteCommit = conflictInfo.remoteCommit;
  
  for (const filePath of remoteChangedFiles) {
    if (!localFileMap.has(filePath)) {
      // Skip files that have already been pulled from the current remote commit
      if (currentRemoteCommit && wasFilePulledFromCommit(filePath, currentRemoteCommit)) {
        continue;
      }
      
      // Parse content type and slug from file path
      const allDirs = [...getAllDirectories(), "component-registry"];
      const _cf = contentFolder || process.env.CONTENT_FOLDER || 'content';
      const _cfEsc = _cf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pathMatch = filePath.match(new RegExp(`${_cfEsc}\\/(${allDirs.join("|")})\\/([^\\/]+)`));
      changes.push({
        file: filePath,
        status: 'modified',
        source: 'incoming',
        contentType: pathMatch?.[1] || 'unknown',
        slug: pathMatch?.[2] || filePath.split('/').pop()?.replace(/\.(yml|yaml)$/, '') || 'unknown',
        localSha: '',
        author: fileAuthorMap.get(filePath),
        date: fileDateMap.get(filePath),
        // Use specific commit SHA if mapped, otherwise fall back to remoteCommit (HEAD)
        commitSha: fileCommitShaMap.get(filePath) || conflictInfo.remoteCommit || undefined,
      });
    }
  }
  
  return changes;
}

/**
 * Sync local state with remote by updating lastSyncedCommit
 * Call this after user chooses to "refresh" and accept remote changes
 * Rebuilds the file hash cache so pending changes shows 0 after sync
 */
export async function syncWithRemote(): Promise<{ success: boolean; error?: string }> {
  const config = getGitHubConfig();
  
  if (!config) {
    return { success: false, error: "GitHub not configured" };
  }
  
  try {
    const remoteCommit = await getBranchHeadSha(config);
    if (!remoteCommit) {
      return { success: false, error: "Could not get remote HEAD" };
    }
    
    // Rebuild sync state from current local files
    // Since local = remote after sync, all hashes should match
    const { rebuildSyncStateFromLocal } = await import("./sync-state");
    rebuildSyncStateFromLocal(remoteCommit);
    
    return { success: true };
  } catch (error) {
    log.error({ err: error }, 'Error syncing with remote:');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Reconcile sync state on startup by comparing local file hashes against remote blob SHAs.
 * If local files already match the remote (e.g., after a deploy where files were pulled in dev),
 * silently updates the sync state instead of showing false "incoming" changes.
 * Uses only 2 API calls: HEAD SHA + compare (no per-file fetches).
 */
export async function reconcileSyncStateOnStartup(opts?: { repoUrl?: string; contentRoot?: string }): Promise<void> {
  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) return;

  const { logSync, refreshGithubCommit } = await import("./sync-log");
  refreshGithubCommit();

  try {
    const { getLastSyncedCommit } = await import("./sync-state");
    const lastSyncedCommit = getLastSyncedCommit(opts?.contentRoot);
    const remoteCommit = await getBranchHeadSha(config);

    if (!remoteCommit || !lastSyncedCommit) {
      return;
    }

    const { shouldTrackFile, computeGitBlobSha, computeFileSha, updateFileAfterPull, loadSyncState } = await import("./sync-state");

    if (lastSyncedCommit === remoteCommit) {
      const state = loadSyncState(opts?.contentRoot);
      const staleFiles: string[] = [];

      for (const [filePath, fileInfo] of Object.entries(state.files)) {
        if (!shouldTrackFile(filePath, undefined, opts?.contentRoot) || !fileInfo.remoteSha) continue;

        const fullPath = path.join(process.cwd(), filePath);
        if (!fs.existsSync(fullPath)) {
          staleFiles.push(filePath);
          continue;
        }

        const localContent = fs.readFileSync(fullPath, 'utf-8');
        const localSha = computeFileSha(localContent);
        if (localSha !== fileInfo.remoteSha) {
          staleFiles.push(filePath);
        }
      }

      if (staleFiles.length === 0) {
        logSync('RECONCILE', `Already in sync at ${lastSyncedCommit.slice(0, 7)}`);
        return;
      }

      logSync('RECONCILE', `Commits match at ${remoteCommit.slice(0, 7)} but ${staleFiles.length} local file(s) are stale (deploy snapshot), pulling from GitHub...`);
      let pulledCount = 0;
      const pullErrors: string[] = [];

      for (const filePath of staleFiles) {
        try {
          const result = await pullSingleFile(filePath);
          if (result.success) {
            pulledCount++;
          } else {
            pullErrors.push(`${filePath}: ${result.error}`);
          }
        } catch (e) {
          pullErrors.push(`${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }

      const { rebuildSyncStateFromLocal } = await import("./sync-state");
      rebuildSyncStateFromLocal(remoteCommit, opts?.contentRoot);

      if (pulledCount > 0) {
        const _cfRec = opts?.contentRoot ? (path.isAbsolute(opts.contentRoot) ? path.relative(process.cwd(), opts.contentRoot) : opts.contentRoot) : (process.env.CONTENT_FOLDER || 'content');
        logSync('RECONCILE', `Pulled ${pulledCount} stale file(s) from GitHub: ${staleFiles.slice(0, 5).map(f => f.replace(`${_cfRec}/`, '')).join(', ')}${staleFiles.length > 5 ? ` (+${staleFiles.length - 5} more)` : ''}`);
      }
      if (pullErrors.length > 0) {
        logSync('ERROR', `Failed to pull ${pullErrors.length} stale file(s): ${pullErrors.join('; ')}`);
      }
      return;
    }

    logSync('RECONCILE', `Local ${lastSyncedCommit.slice(0, 7)} ≠ remote ${remoteCommit.slice(0, 7)}, checking file hashes...`);

    const conflictInfo = await getConflictInfo();

    const trackedFiles = conflictInfo.changedFiles.filter(f => shouldTrackFile(f, undefined, opts?.contentRoot));
    if (trackedFiles.length === 0) {
      const { rebuildSyncStateFromLocal } = await import("./sync-state");
      rebuildSyncStateFromLocal(remoteCommit, opts?.contentRoot);
      logSync('RECONCILE', `No tracked files changed, updated to ${remoteCommit.slice(0, 7)}`);
      return;
    }

    let allReconciled = true;
    let reconciledCount = 0;

    for (const filePath of trackedFiles) {
      const remoteBlobSha = conflictInfo.fileBlobShas[filePath];
      if (!remoteBlobSha) {
        allReconciled = false;
        continue;
      }

      const fullPath = path.join(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) {
        allReconciled = false;
        continue;
      }

      const localContent = fs.readFileSync(fullPath, 'utf-8');
      const localBlobSha = computeGitBlobSha(localContent);

      if (localBlobSha === remoteBlobSha) {
        const fileCommitDate = await getFileCommitDate(config, filePath);
        updateFileAfterPull(filePath, remoteCommit, fileCommitDate || undefined);
        reconciledCount++;
      } else {
        allReconciled = false;
      }
    }

    if (allReconciled) {
      const { rebuildSyncStateFromLocal } = await import("./sync-state");
      rebuildSyncStateFromLocal(remoteCommit, opts?.contentRoot);
      logSync('RECONCILE', `All ${reconciledCount} files match remote, updated to ${remoteCommit.slice(0, 7)}`);
    } else {
      logSync('RECONCILE', `${reconciledCount}/${trackedFiles.length} files match remote, ${trackedFiles.length - reconciledCount} still differ`);
    }
  } catch (error) {
    logSync('ERROR', `Reconciliation error: ${error instanceof Error ? error.message : String(error)}`);
    log.error({ err: error }, '[SyncReconcile] Error during reconciliation:');
  }
}

/**
 * Auto-pull non-conflicting incoming files from remote.
 * For each changed file: if no local modifications exist, pull silently.
 * Files with local edits are left untouched for manual resolution.
 * @param changedFiles - optional list of file paths from webhook payload; if omitted, uses getAllSyncChanges
 * @param remoteCommitSha - optional commit SHA from webhook payload
 */
export async function autoPullNonConflicting(changedFiles?: string[], remoteCommitSha?: string, opts?: { repoUrl?: string; contentRoot?: string }): Promise<{
  pulled: string[];
  conflicted: string[];
  errors: string[];
}> {
  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) return { pulled: [], conflicted: [], errors: ['GitHub not configured'] };

  const contentFolder = opts?.contentRoot
    ? (path.isAbsolute(opts.contentRoot) ? path.relative(process.cwd(), opts.contentRoot) : opts.contentRoot)
    : (process.env.CONTENT_FOLDER || 'content');

  const pulled: string[] = [];
  const conflicted: string[] = [];
  const errors: string[] = [];

  try {
    const { shouldTrackFile } = await import("./sync-state");

    if (changedFiles) {
      const tracked = changedFiles.filter(f => shouldTrackFile(f, undefined, opts?.contentRoot));
      if (tracked.length === 0) return { pulled, conflicted, errors };

      const localChanges = await getPendingChanges();
      const localFileSet = new Set(localChanges.map(c => c.file));

      for (const filePath of tracked) {
        if (localFileSet.has(filePath)) {
          conflicted.push(filePath);
          continue;
        }
        try {
          const result = await pullSingleFile(filePath);
          if (result.success) {
            pulled.push(filePath);
          } else {
            errors.push(`${filePath}: ${result.error}`);
          }
        } catch (e) {
          errors.push(`${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
    } else {
      const allChanges = await getAllSyncChanges(contentFolder);
      const incomingOnly = allChanges.filter(c => c.source === 'incoming');
      if (incomingOnly.length === 0) return { pulled, conflicted, errors };

      for (const change of incomingOnly) {
        try {
          const result = await pullSingleFile(change.file);
          if (result.success) {
            pulled.push(change.file);
          } else {
            errors.push(`${change.file}: ${result.error}`);
          }
        } catch (e) {
          errors.push(`${change.file}: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }

      const conflictChanges = allChanges.filter(c => c.source === 'conflict');
      conflicted.push(...conflictChanges.map(c => c.file));
    }

    if (pulled.length > 0 && conflicted.length === 0) {
      const { rebuildSyncStateFromLocal } = await import("./sync-state");
      const commitSha = remoteCommitSha || await getBranchHeadSha(config);
      if (commitSha) {
        rebuildSyncStateFromLocal(commitSha, opts?.contentRoot);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown error');
  }

  return { pulled, conflicted, errors };
}

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Get the base URL of this application for webhook registration.
 */
function getWebhookBaseUrl(): string | null {
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/$/, '');
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return null;
}

/**
 * Ensure a GitHub webhook exists for push events.
 * Checks sync state for existing webhook, verifies it's active, creates one if needed.
 * Auto-generates a random secret and stores webhookId + secret in sync state.
 */
export async function ensureWebhook(opts?: { repoUrl?: string; contentRoot?: string }): Promise<void> {
  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) return;

  const { logSync } = await import("./sync-log");

  const baseUrl = getWebhookBaseUrl();
  if (!baseUrl) {
    logSync('WEBHOOK', 'No SITE_URL or REPLIT_DEV_DOMAIN set, skipping webhook setup');
    return;
  }

  const webhookUrl = `${baseUrl}/api/github/webhook`;

  try {
    const { getWebhookInfo, setWebhookInfo, clearWebhookInfo } = await import("./sync-state");
    const cr = opts?.contentRoot;
    const existing = getWebhookInfo(cr);

    if (existing) {
      if (existing.webhookUrl === webhookUrl) {
        const isActive = await verifyWebhookExists(config, existing.webhookId);
        if (isActive) {
          logSync('WEBHOOK', `Verified: webhook #${existing.webhookId} is active at ${webhookUrl}`);
          return;
        }
        logSync('WEBHOOK', `Webhook #${existing.webhookId} no longer exists on GitHub, recreating...`);
      } else {
        logSync('WEBHOOK', `URL changed from ${existing.webhookUrl} to ${webhookUrl}, recreating...`);
        await deleteWebhook(config, existing.webhookId);
      }
      clearWebhookInfo(cr);
    }

    const secret = crypto.randomBytes(32).toString('hex');

    const existingHook = await findExistingWebhookOnGitHub(config, webhookUrl);
    let webhookId: number | null = null;

    if (existingHook) {
      webhookId = await adoptWebhook(config, existingHook.id, secret);
      if (webhookId) {
        setWebhookInfo({
          webhookId,
          webhookSecret: secret,
          webhookUrl,
          createdAt: new Date().toISOString(),
        }, cr);
        logSync('WEBHOOK', `Adopted existing webhook #${webhookId} at ${webhookUrl}`);
      } else {
        logSync('ERROR', `Failed to adopt existing webhook #${existingHook.id}, falling back to create`);
        webhookId = await createWebhook(config, webhookUrl, secret);
        if (webhookId) {
          setWebhookInfo({
            webhookId,
            webhookSecret: secret,
            webhookUrl,
            createdAt: new Date().toISOString(),
          }, cr);
          logSync('WEBHOOK', `Created webhook #${webhookId} at ${webhookUrl}`);
        } else {
          logSync('ERROR', `Failed to create webhook at ${webhookUrl} (check token permissions: needs admin:repo_hook scope)`);
        }
      }
    } else {
      webhookId = await createWebhook(config, webhookUrl, secret);
      if (webhookId) {
        setWebhookInfo({
          webhookId,
          webhookSecret: secret,
          webhookUrl,
          createdAt: new Date().toISOString(),
        }, cr);
        logSync('WEBHOOK', `Created webhook #${webhookId} at ${webhookUrl}`);
      } else {
        logSync('ERROR', `Failed to create webhook at ${webhookUrl} (check token permissions: needs admin:repo_hook scope)`);
      }
    }

    if (webhookId) {
      const deleted = await cleanupDuplicateWebhooks(config, webhookId, webhookUrl);
      if (deleted.length > 0) {
        logSync('WEBHOOK', `Cleaned up ${deleted.length} duplicate webhook(s): #${deleted.join(', #')}`);
      }
    }
  } catch (error) {
    logSync('ERROR', `Webhook setup error: ${error instanceof Error ? error.message : String(error)}`);
    log.error({ err: error }, '[Webhook] Error ensuring webhook:');
  }
}

async function verifyWebhookExists(config: GitHubConfig, webhookId: number): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks/${webhookId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function findExistingWebhookOnGitHub(config: GitHubConfig, url: string): Promise<{ id: number; config: { url: string } } | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks?per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    if (!response.ok) return null;
    const hooks: Array<{ id: number; config: { url: string } }> = await response.json();
    return hooks.find(h => h.config.url === url) ?? null;
  } catch {
    return null;
  }
}

async function adoptWebhook(config: GitHubConfig, hookId: number, newSecret: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks/${hookId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          active: true,
          config: {
            secret: newSecret,
          },
        }),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      log.error({ err: text }, `[Webhook] GitHub API error adopting webhook: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.id;
  } catch (error) {
    log.error({ err: error }, '[Webhook] Error adopting webhook:');
    return null;
  }
}

async function createWebhook(config: GitHubConfig, url: string, secret: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          name: 'web',
          active: true,
          events: ['push'],
          config: {
            url,
            content_type: 'json',
            secret,
            insecure_ssl: '0',
          },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      log.error({ err: text }, `[Webhook] GitHub API error creating webhook: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.id;
  } catch (error) {
    log.error({ err: error }, '[Webhook] Error creating webhook:');
    return null;
  }
}

export async function cleanupDuplicateWebhooks(config: GitHubConfig, activeWebhookId: number, webhookUrl: string): Promise<number[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks?per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    if (!response.ok) return [];
    const hooks: Array<{ id: number; config: { url: string } }> = await response.json();
    const duplicates = hooks.filter(h => h.config.url === webhookUrl && h.id !== activeWebhookId);
    await Promise.all(duplicates.map(h => deleteWebhook(config, h.id)));
    return duplicates.map(h => h.id);
  } catch {
    return [];
  }
}

async function deleteWebhook(config: GitHubConfig, webhookId: number): Promise<void> {
  try {
    await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks/${webhookId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
  } catch {
    // best-effort deletion
  }
}

/**
 * Get file content from GitHub remote
 */
export async function getRemoteFileContent(filePath: string): Promise<{ 
  success: boolean; 
  content?: string; 
  sha?: string;
  error?: string;
}> {
  const config = getGitHubConfig();
  
  if (!config) {
    return { success: false, error: "GitHub not configured" };
  }
  
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${config.branch}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (response.status === 404) {
      return { success: false, error: "File not found on remote" };
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `GitHub API error: ${response.status} - ${errorText}` };
    }
    
    const data = await response.json();
    
    if (!data.content) {
      if (data.download_url) {
        try {
          const dlResponse = await fetch(data.download_url, {
            headers: {
              'Authorization': `Bearer ${config.token}`,
            },
          });
          if (dlResponse.ok) {
            const content = await dlResponse.text();
            return { success: true, content, sha: data.sha };
          }
        } catch (dlError) {
          log.error({ err: dlError }, 'Error downloading file via download_url:');
        }
      }
      return { success: false, error: "No content in response" };
    }
    
    // GitHub returns content as base64
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    
    return { success: true, content, sha: data.sha };
  } catch (error) {
    log.error({ err: error }, 'Error fetching remote file:');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Pull a single file from remote to local
 */
export async function pullSingleFile(filePath: string): Promise<{ 
  success: boolean; 
  error?: string;
}> {
  const config = getGitHubConfig();
  
  if (!config) {
    return { success: false, error: "GitHub not configured" };
  }
  
  // Get current remote commit SHA for tracking
  const remoteCommit = await getBranchHeadSha(config);
  
  // Fetch file content from remote
  const remoteResult = await getRemoteFileContent(filePath);
  
  // If file doesn't exist on remote, delete it locally (reset to remote state)
  if (remoteResult.error === "File not found on remote") {
    try {
      const fullPath = path.join(process.cwd(), filePath);
      
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        
        // Try to remove parent directory if empty
        const dir = path.dirname(fullPath);
        try {
          const filesInDir = fs.readdirSync(dir);
          if (filesInDir.length === 0) {
            fs.rmdirSync(dir);
          }
        } catch {
          // Ignore errors removing empty directory
        }
      }
      
      // Remove from sync state
      const { removeFileFromState } = await import("./sync-state");
      removeFileFromState(filePath);
      
      return { success: true };
    } catch (error) {
      log.error({ err: error }, 'Error deleting local file:');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  if (!remoteResult.success || !remoteResult.content) {
    return { success: false, error: remoteResult.error || "Failed to get remote content" };
  }
  
  try {
    // Write to local filesystem
    const fullPath = path.join(process.cwd(), filePath);
    const dir = path.dirname(fullPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, remoteResult.content, 'utf-8');
    
    // Fetch file-specific commit date from GitHub API for accurate lastmod in sitemap.
    // We use the commits-by-path API so that unrelated newer commits on the branch
    // do not inflate the lastmod date for this file.
    let committedAt: string | undefined;
    if (config) {
      const date = await getFileCommitDate(config, filePath);
      if (date) committedAt = date;
    }

    // Update sync state with the commit we pulled from
    const { updateFileAfterPull } = await import("./sync-state");
    updateFileAfterPull(filePath, remoteCommit || undefined, committedAt);
    
    return { success: true };
  } catch (error) {
    log.error({ err: error }, 'Error writing file:');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Commit a single file to remote
 */
export async function commitSingleFile(options: {
  filePath: string;
  message: string;
  author?: string;
}): Promise<{ 
  success: boolean; 
  commitSha?: string;
  error?: string;
}> {
  const config = getGitHubConfig();
  
  if (!config) {
    return { success: false, error: "GitHub not configured" };
  }
  
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
  if (!syncEnabled) {
    return { success: false, error: "GitHub sync is disabled" };
  }
  
  const fullPath = path.join(process.cwd(), options.filePath);
  
  // Check if file exists
  if (!fs.existsSync(fullPath)) {
    return { success: false, error: "File not found locally" };
  }
  
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    
    // Format commit message with author prefix
    let message = options.message;
    if (options.author) {
      message = `[Author: ${options.author}] ${message}`;
    }
    
    // Get current file SHA (required for updating existing files)
    const sha = await getFileSha(config, options.filePath);
    
    // Prepare the request body
    const body: Record<string, string> = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch: config.branch,
    };
    
    if (sha) {
      body.sha = sha;
    }
    
    // Make the commit via GitHub Contents API
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${options.filePath}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      log.error('GitHub API error:', response.status, errorText);
      return { success: false, error: `GitHub API error: ${response.status}` };
    }
    
    const data = await response.json();
    const commitSha = data.commit?.sha;
    
    const { updateFileAfterCommit } = await import("./sync-state");
    updateFileAfterCommit(options.filePath, commitSha || '');

    const { logSync, refreshGithubCommit } = await import("./sync-log");
    const displayPath = options.filePath.split('/').slice(1).join('/') || options.filePath;
    logSync('COMMIT', `${displayPath} → ${commitSha?.slice(0, 7) || '?'}${options.author ? ` by ${options.author}` : ''}`);
    refreshGithubCommit();
    
    return { success: true, commitSha };
  } catch (error) {
    log.error({ err: error }, 'Error committing file:');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get file status comparing local vs remote
 */
export async function getRemoteFileStatus(filePath: string): Promise<{
  exists: boolean;
  localSha: string | null;
  remoteSha: string | null;
  hasConflict: boolean;
  status: 'synced' | 'local-only' | 'remote-only' | 'modified' | 'conflict';
  localContent?: string;
  remoteContent?: string;
}> {
  const { getFileStatus, computeFileSha } = await import("./sync-state");
  const localStatus = getFileStatus(filePath);
  
  // Get remote file info
  const remoteResult = await getRemoteFileContent(filePath);
  
  const fullPath = path.join(process.cwd(), filePath);
  let localContent: string | undefined;
  let localSha: string | null = null;
  
  if (fs.existsSync(fullPath)) {
    localContent = fs.readFileSync(fullPath, 'utf-8');
    localSha = computeFileSha(localContent);
  }
  
  const remoteSha = remoteResult.sha || null;
  const remoteContent = remoteResult.content;
  
  // Compute remote content SHA for comparison
  let remoteContentSha: string | null = null;
  if (remoteContent) {
    remoteContentSha = computeFileSha(remoteContent);
  }
  
  // Determine status
  if (!localSha && !remoteContentSha) {
    return { exists: false, localSha: null, remoteSha: null, hasConflict: false, status: 'synced' };
  }
  
  if (localSha && !remoteContentSha) {
    return { exists: true, localSha, remoteSha: null, hasConflict: false, status: 'local-only', localContent };
  }
  
  if (!localSha && remoteContentSha) {
    return { exists: false, localSha: null, remoteSha: remoteContentSha, hasConflict: false, status: 'remote-only', remoteContent };
  }
  
  if (localSha === remoteContentSha) {
    return { exists: true, localSha, remoteSha: remoteContentSha, hasConflict: false, status: 'synced', localContent, remoteContent };
  }
  
  // Check if there's a conflict (both local and remote have been modified)
  // Conflict = stored remoteSha differs from current remote, AND local differs from stored remote
  const hasConflict = localStatus.remoteSha !== null && 
                      localStatus.remoteSha !== remoteContentSha && 
                      localSha !== localStatus.remoteSha;
  
  return { 
    exists: true, 
    localSha, 
    remoteSha: remoteContentSha, 
    hasConflict, 
    status: hasConflict ? 'conflict' : 'modified',
    localContent,
    remoteContent,
  };
}

/**
 * Live progress state for bootstrapContentFromRemote().
 * Updated in-place as the bootstrap runs so the status API can stream progress.
 */
export interface BootstrapState {
  running: boolean;
  total: number;
  pulled: number;
  errors: string[];
  startedAt: number | null;
  doneAt: number | null;
  success: boolean | null;
  commitSha: string | null;
}

const _bootstrapState: BootstrapState = {
  running: false,
  total: 0,
  pulled: 0,
  errors: [],
  startedAt: null,
  doneAt: null,
  success: null,
  commitSha: null,
};

export function getBootstrapState(): Readonly<BootstrapState> {
  return { ..._bootstrapState };
}

/**
 * Path to the marker file written on a successful bootstrap.
 * Its absence signals an incomplete bootstrap so the next startup re-attempts.
 */
export const BOOTSTRAP_COMPLETE_FLAG = path.join(
  process.cwd(),
  process.env.CONTENT_FOLDER || 'content',
  '.bootstrap-complete',
);

function bootstrapFlagPath(contentRoot?: string): string {
  if (!contentRoot) return BOOTSTRAP_COMPLETE_FLAG;
  const abs = path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
  return path.join(abs, '.bootstrap-complete');
}

/**
 * Returns true if a previous bootstrap run completed without errors.
 * Accepts an optional contentRoot to support per-site bootstrap tracking.
 */
export function isBootstrapComplete(contentRoot?: string): boolean {
  return fs.existsSync(bootstrapFlagPath(contentRoot));
}

/**
 * Pull a single file with up to `maxRetries` attempts using exponential back-off.
 * Retries on any failure; returns the last error if all attempts are exhausted.
 */
async function pullWithRetry(
  filePath: string,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<{ success: boolean; error?: string }> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await pullSingleFile(filePath);
      if (result.success) return result;
      lastError = result.error;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      log.warn(
        { filePath, attempt, maxRetries, delayMs: delay },
        'Bootstrap: pullSingleFile failed, retrying after back-off...',
      );
      await new Promise<void>(r => setTimeout(r, delay));
    }
  }
  return { success: false, error: lastError };
}

export async function bootstrapContentFromRemote(opts?: { repoUrl?: string; contentRoot?: string }): Promise<{
  success: boolean;
  pulled: number;
  errors: string[];
  commitSha: string | null;
}> {
  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) {
    return { success: false, pulled: 0, errors: ['GitHub not configured (missing GITHUB_TOKEN or GITHUB_REPO_URL)'], commitSha: null };
  }

  const { logSync } = await import('./sync-log');
  logSync('AUTO-PULL', 'Bootstrap: starting full content pull from remote...');

  // Reset and mark as running
  _bootstrapState.running = true;
  _bootstrapState.total = 0;
  _bootstrapState.pulled = 0;
  _bootstrapState.errors = [];
  _bootstrapState.startedAt = Date.now();
  _bootstrapState.doneAt = null;
  _bootstrapState.success = null;
  _bootstrapState.commitSha = null;

  const headSha = await getBranchHeadSha(config);
  if (!headSha) {
    _bootstrapState.running = false;
    _bootstrapState.doneAt = Date.now();
    _bootstrapState.success = false;
    _bootstrapState.errors = ['Could not get remote branch HEAD SHA'];
    return { success: false, pulled: 0, errors: _bootstrapState.errors, commitSha: null };
  }

  _bootstrapState.commitSha = headSha;

  const contentFolder = opts?.contentRoot
    ? (path.isAbsolute(opts.contentRoot) ? path.relative(process.cwd(), opts.contentRoot) : opts.contentRoot)
    : (process.env.CONTENT_FOLDER || 'content');
  const files = await fetchFilesFromTree(config, headSha, contentFolder);
  if (files.length === 0) {
    logSync('AUTO-PULL', `Bootstrap: no ${contentFolder} files found on remote`);
    // Mark as complete even when there's nothing to pull — directory is in sync.
    writeBootstrapCompleteFlag(opts?.contentRoot);
    _bootstrapState.running = false;
    _bootstrapState.doneAt = Date.now();
    _bootstrapState.success = true;
    return { success: true, pulled: 0, errors: [], commitSha: headSha };
  }

  _bootstrapState.total = files.length;
  logSync('AUTO-PULL', `Bootstrap: found ${files.length} files on remote, downloading...`);

  let pulled = 0;
  const errors: string[] = [];

  for (const filePath of files) {
    const result = await pullWithRetry(filePath);
    if (result.success) {
      pulled++;
      _bootstrapState.pulled = pulled;
    } else {
      const errMsg = `${filePath}: ${result.error || 'unknown error'}`;
      errors.push(errMsg);
      _bootstrapState.errors = [...errors];
    }
  }

  // Only mark sync state as up-to-date when every file was pulled successfully.
  // If any files failed, leave lastSyncedCommit unset so the next startup
  // (or the next reconcile/auto-pull run) can detect and recover the missing files.
  if (errors.length === 0) {
    const { rebuildSyncStateFromLocal } = await import('./sync-state');
    rebuildSyncStateFromLocal(headSha, opts?.contentRoot);
    writeBootstrapCompleteFlag(opts?.contentRoot);
    logSync('AUTO-PULL', `Bootstrap: pulled ${pulled} files successfully — sync state updated to ${headSha.slice(0, 7)}`);
  } else {
    // Log each failed file clearly so operators know exactly what is missing.
    logSync(
      'ERROR',
      `Bootstrap: pulled ${pulled}/${files.length} files; ${errors.length} failed after retries — ${errors.join(' | ')}`,
    );
    log.error(
      { failedFiles: errors },
      'Bootstrap: the following files could not be pulled after all retries; bootstrap is marked INCOMPLETE and will be re-attempted on next startup',
    );
    logSync('AUTO-PULL', `Bootstrap: sync state NOT updated — next startup will re-attempt the bootstrap`);
  }

  log.info(`Bootstrap complete: pulled=${pulled}, errors=${errors.length}, sha=${headSha}`);

  _bootstrapState.running = false;
  _bootstrapState.pulled = pulled;
  _bootstrapState.doneAt = Date.now();
  _bootstrapState.success = errors.length === 0;

  return { success: errors.length === 0, pulled, errors, commitSha: headSha };
}

/**
 * Write (or overwrite) the bootstrap-complete marker file so future startups
 * know the content directory is fully populated.
 * Also exported so the startup routine can stamp existing deployments that
 * predate the flag (migration path).
 */
export function writeBootstrapCompleteFlag(contentRoot?: string): void {
  try {
    const flagPath = bootstrapFlagPath(contentRoot);
    const dir = path.dirname(flagPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(flagPath, new Date().toISOString(), 'utf-8');
  } catch (e) {
    log.warn({ err: e }, 'Bootstrap: could not write bootstrap-complete flag');
  }
}

/**
 * Walk the local 4geeks-com/ directory and commit every file to the
 * configured remote GitHub repo using commitToGitHub (one file at a time).
 *
 * Intended as a one-time seed operation when creating a fresh content repo
 * from an existing folder.
 *
 * Returns a summary of committed files and any errors encountered.
 */
/**
 * Compute the git blob SHA for a buffer — identical to what GitHub stores.
 * Formula: sha1("blob " + byteLength + "\0" + content)
 */
function computeGitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`);
  const hash = crypto.createHash('sha1');
  hash.update(header);
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Fetch a map of { path → blobSha } for every file in the remote tree under
 * the given commit.  Returns an empty map on failure so callers fall back to
 * uploading everything.
 */
async function fetchRemoteTreeShas(
  config: GitHubConfig,
  commitSha: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees/${commitSha}?recursive=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return map;
    const data = await res.json() as { tree?: Array<{ type: string; path: string; sha: string }> };
    for (const item of data.tree ?? []) {
      if (item.type === 'blob') map.set(item.path, item.sha);
    }
  } catch {
    // silently return empty map — caller will upload everything
  }
  return map;
}

export async function pushAllContentToRemote(opts?: { contentRoot?: string; repoUrl?: string }): Promise<{
  committed: string[];
  skipped: string[];
  errors: string[];
}> {
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === 'true';
  if (!syncEnabled) {
    return { committed: [], skipped: [], errors: ['GitHub sync is not enabled (GITHUB_SYNC_ENABLED != true)'] };
  }

  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) {
    return { committed: [], skipped: [], errors: ['GitHub not configured (missing GITHUB_TOKEN or GITHUB_REPO_URL)'] };
  }

  const { logSync } = await import('./sync-log');

  const contentDir = opts?.contentRoot
    ? (path.isAbsolute(opts.contentRoot) ? opts.contentRoot : path.join(process.cwd(), opts.contentRoot))
    : path.join(process.cwd(), process.env.CONTENT_FOLDER || 'content');
  const contentFolderName = path.relative(process.cwd(), contentDir);
  if (!fs.existsSync(contentDir)) {
    return { committed: [], skipped: [], errors: [`${contentFolderName}/ directory does not exist`] };
  }

  // Explicit denylist: internal runtime state files that must never be pushed
  // to a public/shared content repo because they may contain webhook secrets
  // or other deployment-specific credentials.
  const DENIED_FILENAMES = new Set(['.sync-state.json', '.sync-state.txt', '.gitkeep']);
  const DENIED_SUFFIX_RE = /\.(sync-state|sync-log|webhook-state)\.(json|txt)$/i;

  function isSafeToCommit(entryName: string): boolean {
    if (entryName.startsWith('.')) return false;
    if (DENIED_FILENAMES.has(entryName)) return false;
    if (DENIED_SUFFIX_RE.test(entryName)) return false;
    return true;
  }

  function walkDir(dir: string, base: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!isSafeToCommit(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.join(base, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) results.push(...walkDir(full, rel));
      else results.push(rel);
    }
    return results;
  }

  const allFiles = walkDir(contentDir, contentFolderName);

  // ── Step 1: get current HEAD + fetch remote tree SHAs for diffing ──
  const headSha = await getBranchHeadSha(config);
  const remoteShas = headSha ? await fetchRemoteTreeShas(config, headSha) : new Map<string, string>();

  logSync(
    'AUTO-PULL',
    `Push-all: ${allFiles.length} local files, ${remoteShas.size} remote files — diffing...`
  );

  // ── Step 2: diff — only upload blobs for new/changed files ──
  const errors: string[] = [];
  const skipped: string[] = [];
  // GitHub secondary rate limit kicks in with too many concurrent writes.
  // 3 parallel blob uploads + a short pause between batches stays well under it.
  const CONCURRENCY = 3;
  const BATCH_PAUSE_MS = 300;
  const blobEntries: Array<{ path: string; blobSha: string }> = [];

  // Separate files that need uploading from those already in sync
  const filesToUpload: Array<{ relPath: string; content: Buffer }> = [];
  for (const relPath of allFiles) {
    try {
      const fullPath = path.join(process.cwd(), relPath);
      const content = fs.readFileSync(fullPath);
      const localSha = computeGitBlobSha(content);
      const remoteSha = remoteShas.get(relPath);
      if (remoteSha && remoteSha === localSha) {
        skipped.push(relPath);
        // Still include in blobEntries using the known remote SHA (tree needs it)
        blobEntries.push({ path: relPath, blobSha: remoteSha });
      } else {
        filesToUpload.push({ relPath, content });
      }
    } catch (e) {
      errors.push(`${relPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log.info(
    `Push-all: ${filesToUpload.length} changed/new, ${skipped.length} unchanged (skipping upload), ${errors.length} read errors`
  );

  if (filesToUpload.length === 0 && errors.length === 0) {
    logSync('AUTO-PULL', `Push-all: nothing to do — all ${skipped.length} files already up to date`);
    return { committed: [], skipped, errors: [] };
  }

  // ── Step 3: upload blobs only for changed/new files ──
  for (let i = 0; i < filesToUpload.length; i += CONCURRENCY) {
    const batch = filesToUpload.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ relPath, content }) => {
        try {
          const response = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/git/blobs`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
              },
              body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
            }
          );
          if (!response.ok) {
            const msg = await response.text();
            errors.push(`${relPath}: blob upload failed (${response.status}): ${msg}`);
            return null;
          }
          const data = await response.json() as { sha: string };
          return { path: relPath, blobSha: data.sha };
        } catch (e) {
          errors.push(`${relPath}: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) blobEntries.push(r);
    }
    log.info(
      `Push-all: blobs uploaded ${Math.min(i + CONCURRENCY, filesToUpload.length)}/${filesToUpload.length}`
    );
    // Pause between batches to avoid GitHub secondary rate limits
    if (i + CONCURRENCY < filesToUpload.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  const changedEntries = blobEntries.filter(e => !skipped.includes(e.path));
  if (changedEntries.length === 0) {
    return { committed: [], skipped, errors };
  }

  // ── Step 4: create a single tree with ALL files (changed + unchanged) ──
  let treeSha: string | null = headSha ? await getTreeSha(config, headSha) : null;
  const parentShas = headSha ? [headSha] : [];

  const treePayload = blobEntries.map(e => ({
    path: e.path,
    mode: '100644' as const,
    type: 'blob' as const,
    sha: e.blobSha,
  }));

  const treeBody: Record<string, unknown> = { tree: treePayload };
  if (treeSha) treeBody.base_tree = treeSha;

  const treeRes = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(treeBody),
    }
  );
  if (!treeRes.ok) {
    const msg = await treeRes.text();
    return { committed: [], skipped, errors: [`Tree creation failed (${treeRes.status}): ${msg}`, ...errors] };
  }
  const newTreeSha = ((await treeRes.json()) as { sha: string }).sha;

  // ── Step 5: create commit ──
  const commitBody: Record<string, unknown> = {
    message: `[push-all] sync ${changedEntries.length} changed file(s) from ${contentFolderName}/`,
    tree: newTreeSha,
  };
  if (parentShas.length) commitBody.parents = parentShas;

  const commitRes = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(commitBody),
    }
  );
  if (!commitRes.ok) {
    const msg = await commitRes.text();
    return { committed: [], skipped, errors: [`Commit creation failed (${commitRes.status}): ${msg}`, ...errors] };
  }
  const newCommitSha = ((await commitRes.json()) as { sha: string }).sha;

  // ── Step 6: update (or create) branch ref ──
  const updateRes = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/git/refs/heads/${config.branch}`,
    {
      method: headSha ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(
        headSha
          ? { sha: newCommitSha, force: true }
          : { ref: `refs/heads/${config.branch}`, sha: newCommitSha }
      ),
    }
  );
  if (!updateRes.ok) {
    const msg = await updateRes.text();
    return { committed: [], skipped, errors: [`Ref update failed (${updateRes.status}): ${msg}`, ...errors] };
  }

  const committed = changedEntries.map(e => e.path);
  logSync(
    'AUTO-PULL',
    `Push-all: commit ${newCommitSha.slice(0, 7)} — ${committed.length} synced, ${skipped.length} skipped, ${errors.length} errors`
  );
  log.info(`Push-all complete: commit=${newCommitSha}, synced=${committed.length}, skipped=${skipped.length}, errors=${errors.length}`);

  return { committed, skipped, errors };
}
