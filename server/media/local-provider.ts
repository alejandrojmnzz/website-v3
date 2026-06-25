import * as fs from "fs";
import * as path from "path";
import type { StorageProvider } from "./types";

const LOCAL_PREFIXES = [`/${process.env.CONTENT_FOLDER || "content"}/images/`, "/attached_assets/"];

export class LocalProvider implements StorageProvider {
  readonly name = "local";
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.cwd();
  }

  owns(src: string): boolean {
    return LOCAL_PREFIXES.some(p => src.startsWith(p));
  }

  extractKey(src: string): string | null {
    for (const prefix of LOCAL_PREFIXES) {
      if (src.startsWith(prefix)) {
        return src;
      }
    }
    return null;
  }

  async exists(key: string): Promise<boolean> {
    const normalizedKey = key.startsWith("/") ? key : `/${key}`;
    const diskPath = path.join(this.baseDir, normalizedKey);
    return fs.existsSync(diskPath);
  }

  async upload(key: string, data: Buffer, _contentType?: string): Promise<string> {
    const normalizedKey = key.startsWith("/") ? key : `/${key}`;
    const diskPath = path.join(this.baseDir, normalizedKey);
    const dir = path.dirname(diskPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(diskPath, data);
    return normalizedKey;
  }

  async delete(key: string): Promise<void> {
    const normalizedKey = key.startsWith("/") ? key : `/${key}`;
    const diskPath = path.join(this.baseDir, normalizedKey);
    if (fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath);
    }
  }

  getPublicUrl(key: string): string {
    return key.startsWith("/") ? key : `/${key}`;
  }
}
