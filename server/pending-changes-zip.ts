import * as fs from "fs";
import * as path from "path";
import { detectPendingChanges, getContentFolder, shouldTrackFile } from "./sync-state";
import { buildZipBuffer, type ZipEntry } from "./zip-archive";

export type QueueBackupSkip = { file: string; reason: string };

export type QueueBackupResult =
  | { ok: true; buffer: Buffer; filename: string; included: string[]; skipped: QueueBackupSkip[] }
  | { ok: false; error: string; status: number };

function posixRel(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isSafeContentPath(filePath: string, contentRoot: string): boolean {
  const folder = posixRel(getContentFolder(contentRoot));
  const normalized = posixRel(path.normalize(filePath));
  if (!normalized || normalized.includes("\0") || normalized.includes("..")) return false;
  if (!normalized.startsWith(`${folder}/`)) return false;
  const resolved = path.resolve(process.cwd(), normalized);
  const root = path.resolve(process.cwd(), folder);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function backupFilename(contentRoot: string): string {
  const folder = posixRel(getContentFolder(contentRoot)).replace(/[^a-zA-Z0-9._-]/g, "_");
  const day = new Date().toISOString().slice(0, 10);
  return `${folder}-queue-backup-${day}.zip`;
}

/**
 * Zip local commit-queue files from disk. Does not call GitHub — safe when the
 * remote is down. Only paths already in the local pending set are included.
 */
export function buildQueueBackupZip(opts: {
  files?: string[];
  contentRoot: string;
}): QueueBackupResult {
  const contentRoot = opts.contentRoot?.trim();
  if (!contentRoot) {
    return { ok: false, error: "contentRoot is required", status: 400 };
  }

  const pending = detectPendingChanges(contentRoot);
  const pendingByFile = new Map(pending.map((c) => [posixRel(c.file), c]));
  const requested = (opts.files?.length ? opts.files : pending.map((c) => c.file))
    .map(posixRel);

  const included: string[] = [];
  const skipped: QueueBackupSkip[] = [];
  const zipEntries: ZipEntry[] = [];
  const seen = new Set<string>();

  for (const filePath of requested) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    if (!isSafeContentPath(filePath, contentRoot) || !shouldTrackFile(filePath, undefined, contentRoot)) {
      skipped.push({ file: filePath, reason: "not_allowed" });
      continue;
    }

    const change = pendingByFile.get(filePath);
    if (!change) {
      skipped.push({ file: filePath, reason: "not_in_queue" });
      continue;
    }

    if (change.status === "deleted") {
      skipped.push({ file: filePath, reason: "deleted" });
      continue;
    }

    const fullPath = path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      skipped.push({ file: filePath, reason: "not_found" });
      continue;
    }

    zipEntries.push({ name: filePath, data: fs.readFileSync(fullPath) });
    included.push(filePath);
  }

  if (included.length === 0) {
    return { ok: false, error: "No queue files to backup", status: 400 };
  }

  const exportedAt = new Date().toISOString();
  const skippedBlock = skipped.length
    ? `\nSkipped:\n${skipped.map((s) => `- ${s.file} (${s.reason})`).join("\n")}\n`
    : "";
  const readme =
    `Queue backup — local files not yet on GitHub\n\n` +
    `Exported: ${exportedAt}\n` +
    `Site folder: ${posixRel(getContentFolder(contentRoot))}\n` +
    `Included: ${included.length} file(s)\n\n` +
    `This zip is a local backup of Commit Queue files from GitHub Sync.\n` +
    `It does not push to GitHub and does not change the queue.\n\n` +
    `To restore: copy each path back into the app checkout (keep the site_* prefix),\n` +
    `then open GitHub Sync and push when GitHub is available.\n` +
    skippedBlock;

  zipEntries.unshift({ name: "README.txt", data: Buffer.from(readme, "utf8") });

  return {
    ok: true,
    buffer: buildZipBuffer(zipEntries),
    filename: backupFilename(contentRoot),
    included,
    skipped,
  };
}
