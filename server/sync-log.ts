import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { gcs } from './gcs';
import { child as loggerChild } from './logger';

const syncLogLogger = loggerChild({ module: "SyncLog", worker: "SyncLog" });

const CONTENT_FOLDER = process.env.CONTENT_FOLDER || 'content';
const SYNC_LOG_PATH = path.join(process.cwd(), CONTENT_FOLDER, '.sync-log-state.txt');
const LEGACY_SYNC_LOG_PATH = path.join(process.cwd(), '4geeks-com', '.sync-log-state.txt');
const GCS_SYNC_LOG_KEY = 'sync/sync-log-state.txt';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_LOG_LINES = 500;

const INSTANCE_ID = crypto.randomBytes(2).toString('hex');

let REPLIT_CHECKPOINT = '?';
try {
  REPLIT_CHECKPOINT = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch {
  REPLIT_CHECKPOINT = '?';
}

let GITHUB_COMMIT: string | null = null;

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const cleanUrl = url.replace(/\.git$/, '');
    const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) return { owner: match[1], repo: match[2] };
    return null;
  } catch {
    return null;
  }
}

export async function refreshGithubCommit(): Promise<void> {
  const token = process.env.GITHUB_TOKEN || '';
  const repoUrl = process.env.GITHUB_REPO_URL || '';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const parsed = parseGitHubUrl(repoUrl);
  if (!token || !parsed) return;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?sha=${branch}&per_page=1`,
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (res.ok) {
      const commits = await res.json() as Array<{ sha: string }>;
      if (commits.length > 0) {
        GITHUB_COMMIT = commits[0].sha.slice(0, 8);
      }
    }
  } catch {
    // silently ignore - GITHUB_COMMIT stays as previous value or null
  }
}

export function getGithubCommit(): string | null {
  return GITHUB_COMMIT;
}

export type SyncLogCategory =
  | 'RESTART'
  | 'RECONCILE'
  | 'WEBHOOK'
  | 'AUTO-PULL'
  | 'COMMIT'
  | 'CONFLICT'
  | 'ERROR'
  | 'EDIT';

export type SyncLogEntry = {
  ts: string;
  category: SyncLogCategory;
  message: string;
  person?: string;
  meta?: Record<string, unknown>;
};

let logEntries: SyncLogEntry[] = [];
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function parseOldTextLine(line: string): SyncLogEntry | null {
  const m = line.match(/^(\S+) \[(\w[\w-]*)\] (.+)$/);
  if (!m) return null;
  const [, ts, category, message] = m;
  const personMatch = message.match(/ by (.+?)(?::|$)/);
  const person = personMatch ? personMatch[1].trim() : undefined;
  return { ts, category: category as SyncLogCategory, message, ...(person ? { person } : {}) };
}

function loadLocal(): void {
  try {
    const pathToRead = fs.existsSync(SYNC_LOG_PATH)
      ? SYNC_LOG_PATH
      : fs.existsSync(LEGACY_SYNC_LOG_PATH)
        ? LEGACY_SYNC_LOG_PATH
        : null;

    if (pathToRead) {
      const raw = fs.readFileSync(pathToRead, 'utf-8');
      logEntries = raw
        .split('\n')
        .filter(l => l.trim() !== '')
        .map(line => {
          try {
            return JSON.parse(line) as SyncLogEntry;
          } catch {
            return parseOldTextLine(line);
          }
        })
        .filter((e): e is SyncLogEntry => e !== null);
    } else {
      logEntries = [];
    }
  } catch {
    logEntries = [];
  }
  loaded = true;
}

function saveLocal(): void {
  try {
    const dir = path.dirname(SYNC_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = logEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(SYNC_LOG_PATH, content, 'utf-8');
  } catch (error) {
    syncLogLogger.error({ err: error }, "error saving local log");
  }
}

async function saveToBucket(): Promise<void> {
  if (!IS_PRODUCTION || !gcs.available) return;
  try {
    const content = logEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
    gcs.debouncedUpload(GCS_SYNC_LOG_KEY, Buffer.from(content, 'utf-8'), 'text/plain', 2_000);
  } catch (error) {
    syncLogLogger.error({ err: error }, "error saving log to bucket");
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    saveLocal();
    await saveToBucket();
  }, 2000);
}

function trimLog(): void {
  if (logEntries.length > MAX_LOG_LINES) {
    logEntries = logEntries.slice(logEntries.length - MAX_LOG_LINES);
  }
}

export async function loadSyncLog(): Promise<void> {
  if (loaded) return;

  if (IS_PRODUCTION && gcs.available) {
    try {
      const exists = await gcs.exists(GCS_SYNC_LOG_KEY);
      if (exists) {
        const data = await gcs.download(GCS_SYNC_LOG_KEY);
        if (data) {
          logEntries = data.toString('utf-8')
            .split('\n')
            .filter(l => l.trim() !== '')
            .map(line => {
              try {
                return JSON.parse(line) as SyncLogEntry;
              } catch {
                return parseOldTextLine(line);
              }
            })
            .filter((e): e is SyncLogEntry => e !== null);
          loaded = true;
          saveLocal();
          return;
        }
      }
    } catch (error) {
      syncLogLogger.error({ err: error }, "error loading from bucket");
    }
  }

  loadLocal();
}

export function logSync(category: SyncLogCategory, message: string, person?: string, meta?: Record<string, unknown>): void {
  if (!loaded) loadLocal();

  const entry: SyncLogEntry = {
    ts: new Date().toISOString(),
    category,
    message,
    ...(person ? { person } : {}),
    ...(meta ? { meta } : {}),
  };
  logEntries.push(entry);
  trimLog();
  scheduleSave();

  const legacyText = `${entry.ts} [${category}] ${message}`;
  syncLogLogger.info({ category, person }, legacyText);
}

export function getInstanceId(): string {
  return INSTANCE_ID;
}

export function getReplitCheckpoint(): string {
  return REPLIT_CHECKPOINT;
}

export function getSyncLogEntries(): SyncLogEntry[] {
  if (!loaded) loadLocal();
  return [...logEntries];
}

export function getSyncLogText(): string {
  if (!loaded) loadLocal();
  return logEntries.map(e => `${e.ts} [${e.category}] ${e.message}`).join('\n');
}

export function getRecentEntries(count: number = 20): SyncLogEntry[] {
  if (!loaded) loadLocal();
  return logEntries.slice(-count);
}

export async function flushSyncLog(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveLocal();
  await saveToBucket();
}

export async function clearSyncLog(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  logEntries = [];
  saveLocal();
  await saveToBucket();
  logSync('RESTART', `Log cleared (instance=${INSTANCE_ID}, checkpoint=${REPLIT_CHECKPOINT})`);
}

export async function clearSyncLogOlderThan(cutoffMs: number): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const before = logEntries.length;
  logEntries = logEntries.filter(e => new Date(e.ts).getTime() >= cutoffMs);
  const removed = before - logEntries.length;
  saveLocal();
  await saveToBucket();
  logSync('RESTART', `Cleared ${removed} log entr${removed !== 1 ? 'ies' : 'y'} older than ${new Date(cutoffMs).toISOString()} (instance=${INSTANCE_ID})`);
}
