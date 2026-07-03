import * as fs from "fs";
import * as path from "path";
import { child } from "./logger";
import { getDefaultContentRoot } from "./site-config";
const log = child({ module: "db-job-state" });

function getStatePath(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.join(root, ".db-job-state.json");
}

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

export interface DbJobState {
  fetch: JobState;
  index: JobState;
}

type AllState = Record<string, DbJobState>;

const DEFAULT_JOB_STATE: JobState = { status: "idle" };

let stateCache: AllState | null = null;

function load(): AllState {
  if (stateCache) return stateCache;
  try {
    const content = fs.readFileSync(getStatePath(), "utf8");
    stateCache = JSON.parse(content) as AllState;
  } catch {
    stateCache = {};
  }
  return stateCache;
}

function persist(): void {
  try {
    fs.writeFileSync(
      getStatePath(),
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

export function getAllJobStates(contentRoot?: string): Record<string, DbJobState> {
  try {
    const content = fs.readFileSync(getStatePath(contentRoot), "utf8");
    return JSON.parse(content) as Record<string, DbJobState>;
  } catch {
    return {};
  }
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
