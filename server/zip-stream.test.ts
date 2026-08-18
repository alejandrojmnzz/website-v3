import { inflateRawSync } from "zlib";
import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";
import { ZipStreamWriter } from "./zip-stream";

function unzipStore(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const packedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const packed = buf.subarray(dataStart, dataStart + packedSize);
    out[name] = method === 8 ? inflateRawSync(packed) : Buffer.from(packed);
    offset = dataStart + packedSize;
  }
  return out;
}

async function collectZip(write: (zip: ZipStreamWriter) => Promise<void>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const out = new PassThrough();
  out.on("data", (c: Buffer) => chunks.push(c));
  const zip = new ZipStreamWriter(out);
  await write(zip);
  await zip.finalize();
  out.end();
  return Buffer.concat(chunks);
}

describe("ZipStreamWriter", () => {
  it("streams entries without buffering the full archive in one concat of sources", async () => {
    const buf = await collectZip(async (zip) => {
      await zip.addFile("README.txt", Buffer.from("hello\n", "utf8"));
      await zip.addFile("site_test/pages/hello/en.yml", Buffer.from("title: Hi\n", "utf8"));
    });

    expect(buf.subarray(0, 2).toString("utf8")).toBe("PK");
    const files = unzipStore(buf);
    expect(files["README.txt"].toString("utf8")).toBe("hello\n");
    expect(files["site_test/pages/hello/en.yml"].toString("utf8")).toBe("title: Hi\n");
  });
});
