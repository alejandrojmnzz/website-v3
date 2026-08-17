import fs from "fs";
import os from "os";
import path from "path";
import { inflateRawSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildQueueBackupZip } from "./pending-changes-zip";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function unzipStore(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(compressed) : compressed;
    out[name] = Buffer.from(data).toString("utf8");
    offset = dataStart + compSize;
  }
  return out;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-zip-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "pages", "hello"), { recursive: true });
  fs.mkdirSync(path.join(contentRoot, "pages", "other"), { recursive: true });
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("buildQueueBackupZip", () => {
  it("zips selected pending files and skips paths outside the queue", () => {
    const a = "site_test/pages/hello/en.yml";
    const b = "site_test/pages/other/en.yml";
    fs.writeFileSync(path.join(tempDir, a), "title: Hello\n", "utf8");
    fs.writeFileSync(path.join(tempDir, b), "title: Other\n", "utf8");

    const result = buildQueueBackupZip({
      files: [a, "site_test/../../../etc/passwd", "site_test/pages/missing/en.yml"],
      contentRoot: "site_test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.included).toEqual([a]);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(["not_allowed", "not_in_queue"]);
    expect(result.filename).toMatch(/^site_test-queue-backup-\d{4}-\d{2}-\d{2}\.zip$/);

    const files = unzipStore(result.buffer);
    expect(files[a]).toBe("title: Hello\n");
    expect(files["README.txt"]).toContain("does not push to GitHub");
    const manifest = JSON.parse(files["manifest.json"]);
    expect(manifest.included).toEqual([a]);
    expect(files[b]).toBeUndefined();
  });

  it("zips the full local queue when files is omitted", () => {
    const a = "site_test/pages/hello/en.yml";
    const b = "site_test/pages/other/en.yml";
    fs.writeFileSync(path.join(tempDir, a), "title: Hello\n", "utf8");
    fs.writeFileSync(path.join(tempDir, b), "title: Other\n", "utf8");

    const result = buildQueueBackupZip({ contentRoot: "site_test" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.included.sort()).toEqual([a, b].sort());
  });
});
