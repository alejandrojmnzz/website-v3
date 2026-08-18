import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { inflateRawSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDeniedArchiveEntry, streamSiteArchiveZip } from "./site-archive";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-archive-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("streamSiteArchiveZip", () => {
  it("zips the site folder and skips sync-state secrets", async () => {
    const root = path.join(tempDir, "site_test");
    fs.mkdirSync(path.join(root, "pages", "hello"), { recursive: true });
    fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
    fs.writeFileSync(path.join(root, "pages", "hello", "en.yml"), "title: Hello\n");
    fs.writeFileSync(path.join(root, ".sync-state.json"), JSON.stringify({ webhook: { webhookSecret: "nope" } }));
    fs.writeFileSync(path.join(root, ".cache", "x.json"), "{}");

    const chunks: Buffer[] = [];
    const out = new PassThrough();
    out.on("data", (c: Buffer) => chunks.push(c));
    const result = await streamSiteArchiveZip({ contentRoot: "site_test", out });
    out.end();

    expect(result.files).toBe(1);
    expect(result.filename).toMatch(/^site_test-site-backup-\d{4}-\d{2}-\d{2}\.zip$/);

    const files = unzipStore(Buffer.concat(chunks));
    expect(files["README.txt"]).toContain("does not push to GitHub");
    expect(files["site_test/pages/hello/en.yml"]).toBe("title: Hello\n");
    expect(files["site_test/.sync-state.json"]).toBeUndefined();
    expect(files["site_test/.cache/x.json"]).toBeUndefined();
  });
});

describe("isDeniedArchiveEntry", () => {
  it("denies dotfiles and webhook state", () => {
    expect(isDeniedArchiveEntry(".sync-state.json")).toBe(true);
    expect(isDeniedArchiveEntry(".cache")).toBe(true);
    expect(isDeniedArchiveEntry("pages")).toBe(false);
    expect(isDeniedArchiveEntry("en.yml")).toBe(false);
  });
});
