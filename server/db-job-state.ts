import * as fs from "fs";
import * as path from "path";
import { child } from "./logger";
const log = child({ module: "db-job-state" });



const STATE_PATH = path.join(
  process.cwd(),
  process.env.CONTENT_FOLDER || "content",
  ".db-job-state.json"
);

export type JobStatus = "idle" | "running" | "done" | "error";

export interface JobState {
  status: JobStatus;
  fetched?: number;
  total?: number | null;
  page?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

interface DbJobState {
  fetch: JobState;
  index: JobState;
}

type AllState = Record<string, DbJobState>;

const DEFAULT_JOB_STATE: JobState = { status: "idle" };

let stateCache: AllState | null = null;

function load(): AllState {
  if (stateCache) return stateCache;
  try {
    const content = fs.readFileSync(STATE_PATH, "utf8");
    stateCache = JSON.parse(content) as AllState;
  } catch {
    stateCache = {};
  }
  return stateCache;
}

function persist(): void {
  try {
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify(stateCache ?? {}, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    log.error({ err: err }, "[DbJobState] Failed to persist:");
  }
}

export function getJobState(dbName: string): DbJobState {
  const state = load();
  return state[dbName] ?? { fetch: DEFAULT_JOB_STATE, index: DEFAULT_JOB_STATE };
}

export function setJobState(
  dbName: string,
  jobType: "fetch" | "index",
  patch: Partial<JobState>
): void {
  const state = load();
  if (!state[dbName]) {
    state[dbName] = { fetch: { status: "idle" }, index: { status: "idle" } };
  }
  state[dbName][jobType] = { ...state[dbName][jobType], ...patch };
  persist();
}
