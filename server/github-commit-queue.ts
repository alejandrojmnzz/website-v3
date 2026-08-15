/**
 * MCP / queue:true GitHub commits — one files[] request, never parallel Contents PUTs.
 * Auto-commit on → mark pending and 202. Auto-commit off → mark then one tree commit.
 */

import { markFileAsModified, detectPendingChanges } from "./sync-state";
import { isAutoCommitEnabled } from "./auto-commit";
import { commitAndPush } from "./github";

export type QueueOrCommitResult =
  | { status: 202; queued: true; files: string[]; author: string }
  | { status: 200; success: true; commitHash?: string }
  | { status: 400; success: false; error: string };

export async function queueOrCommitFiles(opts: {
  files?: string[];
  message: string;
  author?: string;
  force?: boolean;
  contentRoot?: string;
  repoUrl?: string;
  logEdit?: (shortPath: string, author: string) => void;
}): Promise<QueueOrCommitResult> {
  let filesToQueue: string[];
  if (Array.isArray(opts.files) && opts.files.length > 0) {
    filesToQueue = opts.files;
  } else {
    filesToQueue = detectPendingChanges(opts.contentRoot).map((c) => c.file);
  }

  if (filesToQueue.length === 0) {
    return { status: 400, success: false, error: "No pending changes found to queue" };
  }

  const effectiveAuthor = (opts.author && opts.author.trim()) || "MCP";
  for (const filePath of filesToQueue) {
    markFileAsModified(filePath, effectiveAuthor, undefined, opts.contentRoot);
  }

  if (isAutoCommitEnabled()) {
    for (const filePath of filesToQueue) {
      const shortPath = filePath.split("/").slice(1).join("/") || filePath;
      opts.logEdit?.(shortPath, effectiveAuthor);
    }
    return { status: 202, queued: true, files: filesToQueue, author: effectiveAuthor };
  }

  const finalMsg = `[Author: ${effectiveAuthor}] ${opts.message.trim()}`;
  const result = await commitAndPush(finalMsg, {
    force: !!opts.force,
    files: filesToQueue,
    repoUrl: opts.repoUrl,
    contentRoot: opts.contentRoot,
  });

  if (result.success) {
    return { status: 200, success: true, commitHash: result.commitHash };
  }
  return { status: 400, success: false, error: result.error || "Failed to commit changes" };
}
