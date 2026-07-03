import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import { child } from "./logger";

const log = child({ module: "image-queue-state" });

export interface QueueStateEntry {
  failed_at?: string;
  queued_at?: string;
  error?: string;
}

type QueueState = Record<string, QueueStateEntry>;

const instances = new Map<string, ImageQueueState>();

export class ImageQueueState {
  private readonly queueStatePath: string;
  private stateCache: QueueState | null = null;

  constructor(contentRoot: string) {
    const abs = path.isAbsolute(contentRoot)
      ? contentRoot
      : path.join(process.cwd(), contentRoot);
    this.queueStatePath = path.join(abs, ".image-queue-state.json");
  }

  private load(): QueueState {
    if (this.stateCache) return this.stateCache;
    try {
      const content = fs.readFileSync(this.queueStatePath, "utf8");
      this.stateCache = JSON.parse(content) as QueueState;
    } catch {
      this.stateCache = {};
    }
    return this.stateCache;
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.queueStatePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.queueStatePath,
        JSON.stringify(this.stateCache ?? {}, null, 2) + "\n",
        "utf8",
      );
    } catch (err) {
      log.error({ err }, "[ImageQueueState] Failed to persist:");
    }
  }

  get(id: string): QueueStateEntry {
    const state = this.load();
    return state[id] ?? {};
  }

  set(id: string, entry: QueueStateEntry): void {
    const state = this.load();
    if (entry.failed_at === undefined && entry.queued_at === undefined) {
      delete state[id];
    } else {
      state[id] = entry;
    }
    this.persist();
  }

  clear(id: string): void {
    const state = this.load();
    delete state[id];
    this.persist();
  }

  importMigrated(entries: Record<string, QueueStateEntry>): void {
    if (Object.keys(entries).length === 0) return;
    const state = this.load();
    let dirty = false;
    for (const [id, entry] of Object.entries(entries)) {
      if (!state[id]) {
        state[id] = entry;
        dirty = true;
      }
    }
    if (dirty) this.persist();
  }

  getAll(): QueueState {
    return this.load();
  }

  invalidateCache(): void {
    this.stateCache = null;
  }
}

export function getImageQueueState(contentRoot: string): ImageQueueState {
  const abs = path.isAbsolute(contentRoot)
    ? contentRoot
    : path.join(process.cwd(), contentRoot);
  let instance = instances.get(abs);
  if (!instance) {
    instance = new ImageQueueState(abs);
    instances.set(abs, instance);
  }
  return instance;
}

function defaultContentRoot(): string {
  try {
    const { getDefaultSite } = require("./site-manager") as typeof import("./site-manager");
    return getDefaultSite().contentRoot;
  } catch {
    return getDefaultContentRoot();
  }
}

function defaultQueueState(): ImageQueueState {
  return getImageQueueState(defaultContentRoot());
}

/** @deprecated Use ImageQueueState via createQueueContext() */
export function getQueueState(id: string): QueueStateEntry {
  return defaultQueueState().get(id);
}

/** @deprecated Use ImageQueueState via createQueueContext() */
export function setQueueState(id: string, entry: QueueStateEntry): void {
  defaultQueueState().set(id, entry);
}

/** @deprecated Use ImageQueueState via createQueueContext() */
export function clearQueueState(id: string): void {
  defaultQueueState().clear(id);
}

/** @deprecated Use ImageQueueState via createQueueContext() */
export function importMigrated(entries: Record<string, QueueStateEntry>): void {
  defaultQueueState().importMigrated(entries);
}

/** @deprecated Use ImageQueueState via createQueueContext() */
export function getAllQueueState(): QueueState {
  return defaultQueueState().getAll();
}

/** @deprecated Use ImageQueueState via createQueueContext() */
export function invalidateQueueStateCache(): void {
  defaultQueueState().invalidateCache();
}
