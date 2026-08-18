import { once } from "events";
import type { Writable } from "stream";
import { crc32, deflateRawSync } from "zlib";

const UTF8_FLAG = 0x0800;
const ZIP64_LIMIT = 0xffffffff;
const ZIP64_COUNT = 0xffff;

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time: dosTime, date: dosDate };
}

function zip64Extra(values: number[]): Buffer {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  let o = 4;
  for (const n of values) {
    extra.writeBigUInt64LE(BigInt(n), o);
    o += 8;
  }
  return extra;
}

type CentralEntry = {
  nameBuf: Buffer;
  crc: number;
  compressed: number;
  uncompressed: number;
  localOffset: number;
  time: number;
  date: number;
};

/**
 * Writes a zip to `out` one entry at a time so the full archive is never held
 * in memory. ZIP64 is used when entry count, offsets, or sizes exceed 32-bit
 * zip limits.
 */
export class ZipStreamWriter {
  private offset = 0;
  private readonly centrals: CentralEntry[] = [];
  private finalized = false;

  constructor(private readonly out: Writable) {}

  get entryCount(): number {
    return this.centrals.length;
  }

  async addFile(name: string, data: Buffer, date: Date = new Date()): Promise<void> {
    if (this.finalized) throw new Error("zip already finalized");
    const posixName = name.replace(/\\/g, "/");
    const nameBuf = Buffer.from(posixName, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data) >>> 0;
    const { time, date: dosDate } = dosDateTime(date);
    const localOffset = this.offset;

    const zip64Sizes = data.length > ZIP64_LIMIT || compressed.length > ZIP64_LIMIT;
    const extra = zip64Sizes ? zip64Extra([data.length, compressed.length]) : Buffer.alloc(0);
    const versionNeeded = zip64Sizes ? 45 : 20;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(versionNeeded, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(zip64Sizes ? ZIP64_LIMIT : compressed.length, 18);
    localHeader.writeUInt32LE(zip64Sizes ? ZIP64_LIMIT : data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(extra.length, 28);

    await this.write(Buffer.concat([localHeader, nameBuf, extra, compressed]));

    this.centrals.push({
      nameBuf,
      crc,
      compressed: compressed.length,
      uncompressed: data.length,
      localOffset,
      time,
      date: dosDate,
    });
  }

  async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;

    const cdStart = this.offset;
    for (const entry of this.centrals) {
      const zip64Values: number[] = [];
      if (entry.uncompressed > ZIP64_LIMIT) zip64Values.push(entry.uncompressed);
      if (entry.compressed > ZIP64_LIMIT) zip64Values.push(entry.compressed);
      if (entry.localOffset > ZIP64_LIMIT) zip64Values.push(entry.localOffset);
      const extra = zip64Values.length ? zip64Extra(zip64Values) : Buffer.alloc(0);
      const versionNeeded = extra.length ? 45 : 20;

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(versionNeeded, 4);
      central.writeUInt16LE(versionNeeded, 6);
      central.writeUInt16LE(UTF8_FLAG, 8);
      central.writeUInt16LE(8, 10);
      central.writeUInt16LE(entry.time, 12);
      central.writeUInt16LE(entry.date, 14);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(Math.min(entry.compressed, ZIP64_LIMIT), 20);
      central.writeUInt32LE(Math.min(entry.uncompressed, ZIP64_LIMIT), 24);
      central.writeUInt16LE(entry.nameBuf.length, 28);
      central.writeUInt16LE(extra.length, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(Math.min(entry.localOffset, ZIP64_LIMIT), 42);
      await this.write(Buffer.concat([central, entry.nameBuf, extra]));
    }

    const cdSize = this.offset - cdStart;
    const count = this.centrals.length;
    const needZip64 =
      count > ZIP64_COUNT || cdStart > ZIP64_LIMIT || cdSize > ZIP64_LIMIT;

    if (needZip64) {
      const zip64EocdOffset = this.offset;
      const zip64Eocd = Buffer.alloc(56);
      zip64Eocd.writeUInt32LE(0x06064b50, 0);
      zip64Eocd.writeBigUInt64LE(44n, 4);
      zip64Eocd.writeUInt16LE(45, 12);
      zip64Eocd.writeUInt16LE(45, 14);
      zip64Eocd.writeUInt32LE(0, 16);
      zip64Eocd.writeUInt32LE(0, 20);
      zip64Eocd.writeBigUInt64LE(BigInt(count), 24);
      zip64Eocd.writeBigUInt64LE(BigInt(count), 32);
      zip64Eocd.writeBigUInt64LE(BigInt(cdSize), 40);
      zip64Eocd.writeBigUInt64LE(BigInt(cdStart), 48);
      await this.write(zip64Eocd);

      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeUInt32LE(0, 4);
      locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
      locator.writeUInt32LE(1, 16);
      await this.write(locator);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Math.min(count, ZIP64_COUNT), 8);
    eocd.writeUInt16LE(Math.min(count, ZIP64_COUNT), 10);
    eocd.writeUInt32LE(Math.min(cdSize, ZIP64_LIMIT), 12);
    eocd.writeUInt32LE(Math.min(cdStart, ZIP64_LIMIT), 16);
    eocd.writeUInt16LE(0, 20);
    await this.write(eocd);
  }

  private async write(buf: Buffer): Promise<void> {
    if (buf.length === 0) return;
    const ok = this.out.write(buf);
    this.offset += buf.length;
    if (!ok) await once(this.out, "drain");
  }
}
