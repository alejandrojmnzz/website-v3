import * as fs from "fs";
import * as path from "path";
import { child } from "./logger";
const log = child({ module: "image-queue-state" });



const QUEUE_STATE_PATH = path.join(
  process.cwd(),
  process.env.CONTENT_FOLDER || "default-site-content",
  ".image-queue-state.json"
);

export interface QueueStateEntry {
  failed_at?: string;
  queued_at?: string;
  error?: string;
}

type QueueState = Record<string, QueueStateEntry>;

let stateCache: QueueState | null = null;

function load(): QueueState {
  if (stateCache) return stateCache;
  try {
    const content = fs.readFileSync(QUEUE_STATE_PATH, "utf8");
    stateCache = JSON.parse(content) as QueueState;
  } catch {
    stateCache = {};
  }
  return stateCache;
}

function persist(): void {
  try {
    fs.writeFileSync(
      QUEUE_STATE_PATH,
      JSON.stringify(stateCache ?? {}, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    log.error({ err: err }, "[ImageQueueState] Failed to persist:");
  }
}

export function getQueueState(id: string): QueueStateEntry {
  const state = load();
  return state[id] ?? {};
}

export function setQueueState(id: string, entry: QueueStateEntry): void {
  const state = load();
  if (entry.failed_at === undefined && entry.queued_at === undefined) {
    delete state[id];
  } else {
    state[id] = entry;
  }
  persist();
}

export function clearQueueState(id: string): void {
  const state = load();
  delete state[id];
  persist();
}

/**
 * Bulk-import entries from a migrated source (called once on registry load).
 * Only writes if there are actual values to migrate; never overwrites existing entries.
 */
export function importMigrated(entries: Record<string, QueueStateEntry>): void {
  if (Object.keys(entries).length === 0) return;
  const state = load();
  let dirty = false;
  for (const [id, entry] of Object.entries(entries)) {
    if (!state[id]) {
      state[id] = entry;
      dirty = true;
    }
  }
  if (dirty) persist();
}

export function getAllQueueState(): QueueState {
  return load();
}

/** Invalidate the in-memory cache (call after external writes to the file). */
export function invalidateQueueStateCache(): void {
  stateCache = null;
}
