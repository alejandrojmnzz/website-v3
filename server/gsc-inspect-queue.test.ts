import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { DebugSitemapUrl } from "./sitemap";
import {
  GSC_INSPECT_INTERVAL_MS,
  GSC_INSPECT_MAX_PER_JOB,
  GscInspectAlreadyRunningError,
  enqueueGscInspects,
  getGscInspectQueueStats,
  cancelGscInspects,
  resetGscInspectQueueForTests,
  selectGscInspectLocs,
  setGscInspectQueueHooksForTests,
} from "./gsc-inspect-queue";
import {
  resetGscInspectionMemory,
  setGscCacheRootForTests,
  upsertRecord,
} from "./gsc-url-inspection";

function url(partial: Partial<DebugSitemapUrl> & { loc: string }): DebugSitemapUrl {
  return {
    inSitemap: true,
    ...partial,
  };
}

const publicA = "https://example.com/us/a";
const publicB = "https://example.com/us/b";
const publicC = "https://example.com/us/c";

const sampleUrls: DebugSitemapUrl[] = [
  url({ loc: publicA, content_type: "blog", slug: "a" }),
  url({ loc: publicB, content_type: "blog", slug: "b" }),
  url({ loc: publicC, content_type: "blog", slug: "c" }),
  url({ loc: "https://example.com/us/draft", isDraft: true, content_type: "blog", slug: "draft" }),
  url({ loc: "https://example.com/private/preview/blog/x", content_type: "blog", slug: "x" }),
  url({ loc: "https://example.com/us/hidden", inSitemap: false, content_type: "blog", slug: "hidden" }),
];

async function waitUntilIdle(): Promise<void> {
  await vi.waitFor(() => {
    expect(getGscInspectQueueStats().running).toBe(false);
  });
}

describe("gsc-inspect-queue", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-q-"));
    setGscCacheRootForTests(tmp);
    resetGscInspectionMemory();
    resetGscInspectQueueForTests();
    setGscInspectQueueHooksForTests({
      delayFn: async () => {},
      inspectOneFn: async ({ loc }) => ({
        requested: loc,
        loc,
        record: { inspectedAt: "2026-08-16T00:00:00.000Z" },
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetGscInspectQueueForTests();
    setGscCacheRootForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("never inspects only locs with no sidecar row; all includes prior failures", () => {
    upsertRecord("site_demo", publicA, {
      inspectedAt: "2026-08-01T00:00:00.000Z",
      error: "quota",
    });
    upsertRecord("site_demo", publicB, {
      inspectedAt: "2026-08-01T00:00:00.000Z",
      verdict: "PASS",
    });

    const never = selectGscInspectLocs({
      mode: "never",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    expect(never.locs).toEqual([publicC]);
    expect(never.eligible).toBe(1);
    expect(never.capped).toBe(false);

    const all = selectGscInspectLocs({
      mode: "all",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    expect(all.locs).toEqual([publicA, publicB, publicC]);
    expect(all.eligible).toBe(3);
  });

  it("stale includes missing and 8-day-old rows and excludes 1-day-old", () => {
    const now = Date.now();
    upsertRecord("site_demo", publicA, {
      inspectedAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
      verdict: "PASS",
    });
    upsertRecord("site_demo", publicB, {
      inspectedAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
      verdict: "PASS",
    });

    const stale = selectGscInspectLocs({
      mode: "stale",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    expect(stale.locs).toEqual([publicA, publicC]);
    expect(stale.eligible).toBe(2);
  });

  it("excludes drafts, preview paths, and URLs not in the sitemap", () => {
    const selected = selectGscInspectLocs({
      mode: "all",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    expect(selected.locs).toEqual([publicA, publicB, publicC]);
    expect(selected.locs.some((loc) => loc.includes("draft") || loc.includes("preview") || loc.includes("hidden"))).toBe(
      false,
    );
  });

  it("caps a job at 2000 URLs", () => {
    const debugUrls = Array.from({ length: GSC_INSPECT_MAX_PER_JOB + 5 }, (_, i) =>
      url({ loc: `https://example.com/p/${i}` }),
    );
    const selected = selectGscInspectLocs({
      mode: "all",
      contentRootName: "site_demo",
      debugUrls,
    });
    expect(selected.eligible).toBe(GSC_INSPECT_MAX_PER_JOB + 5);
    expect(selected.locs).toHaveLength(GSC_INSPECT_MAX_PER_JOB);
    expect(selected.capped).toBe(true);
  });

  it("rejects a second bulk enqueue while a job is running", async () => {
    const first = enqueueGscInspects({
      mode: "all",
      contentRoot: "site_a",
      contentRootName: "site_a",
      debugUrls: sampleUrls,
    });
    expect(first.queued).toBe(3);
    expect(first.queue.running).toBe(true);

    expect(() =>
      enqueueGscInspects({
        mode: "never",
        contentRoot: "site_a",
        contentRootName: "site_a",
        debugUrls: sampleUrls,
      }),
    ).toThrow(GscInspectAlreadyRunningError);

    try {
      enqueueGscInspects({
        mode: "all",
        contentRoot: "site_b",
        contentRootName: "site_b",
        debugUrls: sampleUrls,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GscInspectAlreadyRunningError);
      expect((err as GscInspectAlreadyRunningError).code).toBe("inspect_already_running");
      expect((err as GscInspectAlreadyRunningError).queue.contentRootName).toBe("site_a");
    }

    await waitUntilIdle();
  });

  it("aborts the rest of the job on the first permission-denied 403", async () => {
    const calls: string[] = [];
    setGscInspectQueueHooksForTests({
      delayFn: async () => {},
      inspectOneFn: async ({ loc }) => {
        calls.push(loc);
        return {
          requested: loc,
          loc,
          error: "Search Console inspect failed (403): PERMISSION_DENIED",
        };
      },
    });

    enqueueGscInspects({
      mode: "all",
      contentRoot: "site_demo",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    await waitUntilIdle();

    expect(calls).toEqual([publicA]);
    const stats = getGscInspectQueueStats();
    expect(stats.aborted).toBe("permission_denied");
    expect(stats.pending).toBe(0);
    expect(stats.failed).toBe(1);
    expect(stats.completed).toBe(0);
    expect(stats.running).toBe(false);
  });

  it("continues after a non-permission error", async () => {
    const calls: string[] = [];
    setGscInspectQueueHooksForTests({
      delayFn: async () => {},
      inspectOneFn: async ({ loc }) => {
        calls.push(loc);
        if (loc === publicA) {
          return { requested: loc, loc, error: "quota exceeded" };
        }
        return { requested: loc, loc, record: { inspectedAt: "t" } };
      },
    });

    enqueueGscInspects({
      mode: "all",
      contentRoot: "site_demo",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    await waitUntilIdle();

    expect(calls).toEqual([publicA, publicB, publicC]);
    const stats = getGscInspectQueueStats();
    expect(stats.aborted).toBeNull();
    expect(stats.failed).toBe(1);
    expect(stats.completed).toBe(2);
  });

  it("cancelGscInspects drops remaining URLs and keeps completed rows", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    setGscInspectQueueHooksForTests({
      delayFn: async () => {},
      inspectOneFn: async ({ loc }) => {
        calls.push(loc);
        if (loc === publicA) await firstGate;
        return { requested: loc, loc, record: { inspectedAt: "t" } };
      },
    });

    enqueueGscInspects({
      mode: "all",
      contentRoot: "site_demo",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });

    await vi.waitFor(() => {
      expect(getGscInspectQueueStats().active).toBe(publicA);
    });

    const cancelled = cancelGscInspects();
    expect(cancelled.stopped).toBe(true);
    expect(cancelled.queue.running).toBe(false);
    expect(cancelled.queue.aborted).toBe("cancelled");
    expect(cancelled.queue.pending).toBe(0);

    releaseFirst();
    await waitUntilIdle();

    expect(calls).toEqual([publicA]);
    expect(getGscInspectQueueStats().aborted).toBe("cancelled");
    expect(getGscInspectQueueStats().running).toBe(false);

    const idle = cancelGscInspects();
    expect(idle.stopped).toBe(false);
  });

  it("waits the inspect interval between Google calls", async () => {
    resetGscInspectQueueForTests();
    vi.useFakeTimers();
    const calls: string[] = [];
    setGscInspectQueueHooksForTests({
      inspectOneFn: async ({ loc }) => {
        calls.push(loc);
        return { requested: loc, loc, record: { inspectedAt: "t" } };
      },
    });

    enqueueGscInspects({
      mode: "all",
      contentRoot: "site_demo",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([publicA]);

    await vi.advanceTimersByTimeAsync(GSC_INSPECT_INTERVAL_MS - 1);
    expect(calls).toEqual([publicA]);

    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([publicA, publicB]);

    await vi.advanceTimersByTimeAsync(GSC_INSPECT_INTERVAL_MS);
    expect(calls).toEqual([publicA, publicB, publicC]);
    expect(getGscInspectQueueStats().running).toBe(false);
  });

  it("uses force inspect for all and not for never or stale", async () => {
    const forces: boolean[] = [];
    setGscInspectQueueHooksForTests({
      delayFn: async () => {},
      inspectOneFn: async ({ loc, force }) => {
        forces.push(force);
        return { requested: loc, loc, record: { inspectedAt: "t" } };
      },
    });

    enqueueGscInspects({
      mode: "never",
      contentRoot: "site_demo",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    await waitUntilIdle();
    expect(forces.every((f) => f === false)).toBe(true);

    forces.length = 0;
    enqueueGscInspects({
      mode: "stale",
      contentRoot: "site_demo",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    await waitUntilIdle();
    expect(forces.every((f) => f === false)).toBe(true);

    forces.length = 0;
    enqueueGscInspects({
      mode: "all",
      contentRoot: "site_demo",
      contentRootName: "site_demo",
      debugUrls: sampleUrls,
    });
    await waitUntilIdle();
    expect(forces.every((f) => f === true)).toBe(true);
    expect(forces).toHaveLength(3);
  });
});
