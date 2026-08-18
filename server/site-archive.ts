import * as fs from "fs";
import * as path from "path";
import type { Writable } from "stream";
import { getContentFolder } from "./sync-state";
import { ZipStreamWriter } from "./zip-stream";

/** Same denylist as push-all — never ship webhook secrets / runtime state. */
const DENIED_FILENAMES = new Set([".sync-state.json", ".sync-state.txt", ".gitkeep"]);
const DENIED_SUFFIX_RE = /\.(sync-state|sync-log|webhook-state)\.(json|txt)$/i;

function posixRel(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isDeniedArchiveEntry(entryName: string): boolean {
  if (entryName.startsWith(".")) return true;
  if (DENIED_FILENAMES.has(entryName)) return true;
  if (DENIED_SUFFIX_RE.test(entryName)) return true;
  return false;
}

export function siteArchiveFilename(contentRoot: string): string {
  const folder = posixRel(getContentFolder(contentRoot)).replace(/[^a-zA-Z0-9._-]/g, "_");
  const day = new Date().toISOString().slice(0, 10);
  return `${folder}-site-backup-${day}.zip`;
}

function siteReadme(contentRoot: string): string {
  const folder = posixRel(getContentFolder(contentRoot));
  return (
    `Site backup — local snapshot of ${folder}\n\n` +
    `Exported: ${new Date().toISOString()}\n\n` +
    `This zip is a copy of the site content folder on this server.\n` +
    `It does not push to GitHub and does not change the commit queue.\n\n` +
    `Excluded: dotfiles, sync-state (may contain secrets), cache, and webhook state.\n\n` +
    `To restore: copy paths back into the app checkout (keep the site_* prefix).\n`
  );
}

async function addDir(
  zip: ZipStreamWriter,
  absDir: string,
  zipPrefix: string,
  rootAbs: string,
): Promise<void> {
  const entries = await fs.promises.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || isDeniedArchiveEntry(entry.name)) continue;
    const abs = path.join(absDir, entry.name);
    const resolved = path.resolve(abs);
    if (resolved !== rootAbs && !resolved.startsWith(rootAbs + path.sep)) continue;

    const zipPath = posixRel(`${zipPrefix}/${entry.name}`);
    if (entry.isDirectory()) {
      await addDir(zip, resolved, zipPath, rootAbs);
      continue;
    }
    if (!entry.isFile()) continue;
    const data = await fs.promises.readFile(resolved);
    const st = await fs.promises.stat(resolved);
    await zip.addFile(zipPath, data, st.mtime);
  }
}

/**
 * Stream a zip of the site content folder to `out`. Does not buffer the archive.
 * Reads one file at a time.
 */
export async function streamSiteArchiveZip(opts: {
  contentRoot: string;
  out: Writable;
}): Promise<{ filename: string; files: number }> {
  const contentRoot = opts.contentRoot?.trim();
  if (!contentRoot) throw new Error("contentRoot is required");

  const folder = posixRel(getContentFolder(contentRoot));
  const rootAbs = path.resolve(
    path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot),
  );
  if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) {
    throw new Error(`Site folder not found: ${folder}`);
  }

  const zip = new ZipStreamWriter(opts.out);
  await zip.addFile("README.txt", Buffer.from(siteReadme(contentRoot), "utf8"));
  await addDir(zip, rootAbs, folder, rootAbs);
  await zip.finalize();

  return { filename: siteArchiveFilename(contentRoot), files: Math.max(0, zip.entryCount - 1) };
}
