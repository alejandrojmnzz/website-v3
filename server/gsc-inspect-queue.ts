/**
 * Process-wide Search Console URL Inspection queue.
 * One Google call at a time across all sites, ~1.5s apart, max 2000 per job.
 * Does not request indexing. Restart drops the in-memory remainder; sidecar cache stays.
 */

import { child } from "./logger";
import type { DebugSitemapUrl } from "./sitemap";
import {
  getRecord,
  inspectAndStore,
  isGscPropertyAccessDenied,
  isPreviewLoc,
  isStale,
  type InspectUrlResult,
} from "./gsc-url-inspection";

const log = child({ module: "gsc-inspect-queue" });

export const GSC_INSPECT_INTERVAL_MS = 1500;
export const GSC_INSPECT_MAX_PER_JOB = 2000;

export type GscInspectMode = "never" | "stale" | "all";
export type GscInspectAborted = "permission_denied" | "cancelled" | null;

export interface GscInspectQueueStats {
  pending: number;
  active: string | null;
  completed: number;
  failed: number;
  mode: GscInspectMode | null;
  running: boolean;
  aborted: GscInspectAborted;
  contentRootName: string | null;
  queued: number;
  capped: boolean;
}

export interface GscInspectEnqueueResult {
  queued: number;
  capped: boolean;
  mode: GscInspectMode;
  queue: GscInspectQueueStats;
}

export interface SelectGscInspectLocsResult {
  locs: string[];
  eligible: number;
  capped: boolean;
}

export type GscInspectOneFn = (opts: {
  loc: string;
  contentRootName: string;
  contentRoot: string;
  force: boolean;
  debugUrls: DebugSitemapUrl[];
}) => Promise<InspectUrlResult>;

export class GscInspectAlreadyRunningError extends Error {
  readonly code = "inspect_already_running";
  readonly queue: GscInspectQueueStats;

  constructor(queue: GscInspectQueueStats) {
    super("A bulk Search Console inspect is already running");
    this.name = "GscInspectAlreadyRunningError";
    this.queue = queue;
  }
}

type JobState = {
  pending: string[];
  active: string | null;
  completed: number;
  failed: number;
  mode: GscInspectMode | null;
  aborted: GscInspectAborted;
  contentRootName: string | null;
  contentRoot: string | null;
  debugUrls: DebugSitemapUrl[];
  force: boolean;
  queued: number;
  capped: boolean;
  pumping: boolean;
};

function emptyJob(): JobState {
  return {
    pending: [],
    active: null,
    completed: 0,
    failed: 0,
    mode: null,
    aborted: null,
    contentRootName: null,
    contentRoot: null,
    debugUrls: [],
    force: false,
    queued: 0,
    capped: false,
    pumping: false,
  };
}

let job = emptyJob();
let pumpGeneration = 0;

let delayMs = GSC_INSPECT_INTERVAL_MS;
let delayFn: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
let inspectOneFn: GscInspectOneFn | null = null;

function isRunning(): boolean {
  return job.pumping || job.pending.length > 0 || job.active !== null;
}

export function getGscInspectQueueStats(): GscInspectQueueStats {
  return {
    pending: job.pending.length,
    active: job.active,
    completed: job.completed,
    failed: job.failed,
    mode: job.mode,
    running: isRunning(),
    aborted: job.aborted,
    contentRootName: job.contentRootName,
    queued: job.queued,
    capped: job.capped,
  };
}

export function isGscInspectEligibleLoc(u: DebugSitemapUrl): boolean {
  return Boolean(u.inSitemap && !u.isDraft && !isPreviewLoc(u.loc));
}

export function selectGscInspectLocs(opts: {
  mode: GscInspectMode;
  contentRootName: string;
  debugUrls: DebugSitemapUrl[];
  max?: number;
}): SelectGscInspectLocsResult {
  const max = opts.max ?? GSC_INSPECT_MAX_PER_JOB;
  const seen = new Set<string>();
  const publicLocs: string[] = [];
  for (const u of opts.debugUrls) {
    if (!isGscInspectEligibleLoc(u) || seen.has(u.loc)) continue;
    seen.add(u.loc);
    publicLocs.push(u.loc);
  }

  const selected =
    opts.mode === "never"
      ? publicLocs.filter((loc) => !getRecord(opts.contentRootName, loc))
      : opts.mode === "stale"
        ? publicLocs.filter((loc) => isStale(getRecord(opts.contentRootName, loc)))
        : publicLocs;

  const capped = selected.length > max;
  return {
    locs: selected.slice(0, max),
    eligible: selected.length,
    capped,
  };
}

async function defaultInspectOne(opts: {
  loc: string;
  contentRootName: string;
  contentRoot: string;
  force: boolean;
  debugUrls: DebugSitemapUrl[];
}): Promise<InspectUrlResult> {
  const [result] = await inspectAndStore({
    contentRootName: opts.contentRootName,
    contentRoot: opts.contentRoot,
    urls: [opts.loc],
    force: opts.force,
    debugUrls: opts.debugUrls,
  });
  return result;
}

function inspectErrorMessage(result: InspectUrlResult | undefined, thrown?: unknown): string | undefined {
  if (result?.error) return result.error;
  if (thrown instanceof Error) return thrown.message;
  if (thrown != null) return String(thrown);
  return undefined;
}

async function pump(generation: number): Promise<void> {
  job.pumping = true;
  try {
    while (job.pending.length > 0 && generation === pumpGeneration) {
      const loc = job.pending.shift();
      if (!loc || !job.contentRootName || !job.contentRoot) break;
      job.active = loc;

      let result: InspectUrlResult | undefined;
      let thrown: unknown;
      try {
        const inspectOne = inspectOneFn ?? defaultInspectOne;
        result = await inspectOne({
          loc,
          contentRootName: job.contentRootName,
          contentRoot: job.contentRoot,
          force: job.force,
          debugUrls: job.debugUrls,
        });
      } catch (err) {
        thrown = err;
        log.warn({ err, loc }, "GSC inspect queue item threw");
      }

      if (generation !== pumpGeneration) return;

      const message = inspectErrorMessage(result, thrown);
      if (isGscPropertyAccessDenied(message)) {
        job.failed += 1;
        job.active = null;
        job.pending = [];
        job.aborted = "permission_denied";
        log.warn({ loc, contentRootName: job.contentRootName }, "GSC inspect queue aborted: permission denied");
        return;
      }

      if (message) job.failed += 1;
      else job.completed += 1;
      job.active = null;

      if (job.pending.length > 0 && generation === pumpGeneration) {
        await delayFn(delayMs);
      }
    }
  } finally {
    if (generation === pumpGeneration) {
      job.active = null;
      job.pumping = false;
    }
  }
}

export function enqueueGscInspects(opts: {
  mode: GscInspectMode;
  contentRoot: string;
  contentRootName: string;
  debugUrls: DebugSitemapUrl[];
}): GscInspectEnqueueResult {
  if (isRunning()) {
    throw new GscInspectAlreadyRunningError(getGscInspectQueueStats());
  }

  const selected = selectGscInspectLocs({
    mode: opts.mode,
    contentRootName: opts.contentRootName,
    debugUrls: opts.debugUrls,
  });

  job = {
    pending: [...selected.locs],
    active: null,
    completed: 0,
    failed: 0,
    mode: opts.mode,
    aborted: null,
    contentRootName: opts.contentRootName,
    contentRoot: opts.contentRoot,
    debugUrls: opts.debugUrls,
    force: opts.mode === "all",
    queued: selected.locs.length,
    capped: selected.capped,
    pumping: false,
  };

  const result: GscInspectEnqueueResult = {
    queued: selected.locs.length,
    capped: selected.capped,
    mode: opts.mode,
    queue: getGscInspectQueueStats(),
  };

  if (selected.locs.length > 0) {
    const generation = pumpGeneration;
    void pump(generation);
  }

  return result;
}

/**
 * Stop the bulk inspect job. Drops remaining pending URLs; rows already written stay.
 * The in-flight Google call (if any) may still finish and write its sidecar row.
 */
export function cancelGscInspects(): { stopped: boolean; queue: GscInspectQueueStats } {
  if (!isRunning()) {
    return { stopped: false, queue: getGscInspectQueueStats() };
  }

  const dropped = job.pending.length + (job.active ? 1 : 0);
  pumpGeneration += 1;
  job.pending = [];
  job.active = null;
  job.pumping = false;
  job.aborted = "cancelled";
  log.info(
    { dropped, completed: job.completed, failed: job.failed, contentRootName: job.contentRootName },
    "GSC inspect queue cancelled by user",
  );
  return { stopped: true, queue: getGscInspectQueueStats() };
}

export function setGscInspectQueueHooksForTests(hooks: {
  delayMs?: number;
  delayFn?: (ms: number) => Promise<void>;
  inspectOneFn?: GscInspectOneFn | null;
}): void {
  if (hooks.delayMs != null) delayMs = hooks.delayMs;
  if (hooks.delayFn) delayFn = hooks.delayFn;
  if (hooks.inspectOneFn !== undefined) inspectOneFn = hooks.inspectOneFn;
}

export function resetGscInspectQueueForTests(): void {
  pumpGeneration += 1;
  job = emptyJob();
  delayMs = GSC_INSPECT_INTERVAL_MS;
  delayFn = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  inspectOneFn = null;
}
