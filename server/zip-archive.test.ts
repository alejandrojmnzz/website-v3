import { inflateRawSync } from "zlib";
import { describe, expect, it } from "vitest";
import { buildZipBuffer } from "./zip-archive";

/** Read local-file entries from a zip we produced (no data descriptors). */
function unzipStore(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
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
    out[name] = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
    offset = dataStart + compSize;
  }
  return out;
}

describe("buildZipBuffer", () => {
  it("packs and round-trips text files with nested paths", () => {
    const zip = buildZipBuffer([
      { name: "README.txt", data: Buffer.from("hello\n", "utf8") },
      { name: "site_test/pages/hello/en.yml", data: Buffer.from("title: Hi\n", "utf8") },
    ]);

    expect(zip.subarray(0, 2).toString("utf8")).toBe("PK");
    const files = unzipStore(zip);
    expect(files["README.txt"].toString("utf8")).toBe("hello\n");
    expect(files["site_test/pages/hello/en.yml"].toString("utf8")).toBe("title: Hi\n");
  });
});
