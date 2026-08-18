/**
 * Read/write helpers for site custom-redirects.yml (one-rule insert and move).
 */

import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { markFileAsModified } from "./sync-state";
import {
  escapeObjectVars,
  escapeTemplateVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "../shared/templateVars";

function safeYamlLoad(yamlStr: string): unknown {
  const { escaped, map } = escapeTemplateVars(yamlStr);
  const parsed = yaml.load(escaped);
  return unescapeObjectVars(parsed, map);
}

function safeYamlDump(obj: unknown, opts?: yaml.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, opts);
  return unescapeYamlDump(dumped, map);
}

export type CustomRedirectYamlEntry = {
  from: string;
  to: string | Record<string, string>;
  status?: number;
  priority?: string;
};

export type CustomRedirectWriteOk = { ok: true; file: string; index: number };
export type CustomRedirectWriteErr = { ok: false; status: number; error: string; code?: string };
export type CustomRedirectWriteResult = CustomRedirectWriteOk | CustomRedirectWriteErr;

function customFilePath(contentRoot: string): string {
  return path.join(contentRoot, "custom-redirects.yml");
}

export function customRedirectsRelativePath(contentRootName: string): string {
  return `${contentRootName}/custom-redirects.yml`;
}

function normalizeFrom(from: string): string {
  let n = from.startsWith("/") ? from : `/${from}`;
  n = n.toLowerCase();
  if (n.length > 1 && n.endsWith("/")) n = n.slice(0, -1);
  return n;
}

export function loadCustomRedirectsYaml(contentRoot: string): CustomRedirectYamlEntry[] {
  const filePath = customFilePath(contentRoot);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const loaded = safeYamlLoad(raw) as { redirects?: unknown[] } | null;
  if (!loaded || !Array.isArray(loaded.redirects)) return [];
  return loaded.redirects.filter(
    (r): r is CustomRedirectYamlEntry =>
      typeof r === "object" && r !== null && "from" in r && "to" in r,
  );
}

function persist(
  contentRoot: string,
  contentRootName: string,
  entries: CustomRedirectYamlEntry[],
  authorName?: string,
): string {
  const filePath = customFilePath(contentRoot);
  const yamlContent = safeYamlDump(
    { redirects: entries },
    { lineWidth: -1, noRefs: true },
  );
  fs.writeFileSync(filePath, yamlContent, "utf-8");
  markFileAsModified(filePath, authorName, undefined, contentRoot);
  return customRedirectsRelativePath(contentRootName);
}

function findIndex(entries: CustomRedirectYamlEntry[], from: string): number {
  const n = normalizeFrom(from);
  return entries.findIndex((r) => normalizeFrom(r.from || "") === n);
}

export function insertCustomRedirect(opts: {
  contentRoot: string;
  contentRootName: string;
  from: string;
  to: string | Record<string, string>;
  statusCode: number;
  priority: "before" | "fallback";
  authorName?: string;
  beforeFrom?: string;
}): CustomRedirectWriteResult {
  const entries = loadCustomRedirectsYaml(opts.contentRoot);
  const from = normalizeFrom(opts.from);

  if (entries.some((r) => normalizeFrom(r.from || "") === from)) {
    return {
      ok: false,
      status: 409,
      error: `Redirect "${from}" already exists in custom-redirects.yml`,
    };
  }

  const newEntry: CustomRedirectYamlEntry = { from, to: opts.to };
  if (opts.statusCode !== 301) newEntry.status = opts.statusCode;
  if (opts.priority === "fallback") newEntry.priority = "fallback";

  let index = entries.length;
  if (opts.beforeFrom && opts.beforeFrom.trim()) {
    const beforeIdx = findIndex(entries, opts.beforeFrom);
    if (beforeIdx < 0) {
      return {
        ok: false,
        status: 404,
        code: "before_from_not_found",
        error: `before_from "${normalizeFrom(opts.beforeFrom)}" not found in custom-redirects.yml`,
      };
    }
    index = beforeIdx;
    entries.splice(beforeIdx, 0, newEntry);
  } else {
    entries.push(newEntry);
  }

  const file = persist(opts.contentRoot, opts.contentRootName, entries, opts.authorName);
  return { ok: true, file, index };
}

export function moveCustomRedirect(opts: {
  contentRoot: string;
  contentRootName: string;
  from: string;
  beforeFrom: string;
  authorName?: string;
}): CustomRedirectWriteResult {
  const entries = loadCustomRedirectsYaml(opts.contentRoot);
  const from = normalizeFrom(opts.from);
  const beforeFrom = normalizeFrom(opts.beforeFrom);

  if (from === beforeFrom) {
    return {
      ok: false,
      status: 400,
      error: "from and before_from must be different rules",
    };
  }

  const fromIdx = findIndex(entries, from);
  if (fromIdx < 0) {
    return {
      ok: false,
      status: 404,
      error: `Redirect "${from}" not found in custom-redirects.yml`,
    };
  }

  const beforeIdx = findIndex(entries, beforeFrom);
  if (beforeIdx < 0) {
    return {
      ok: false,
      status: 404,
      code: "before_from_not_found",
      error: `before_from "${beforeFrom}" not found in custom-redirects.yml`,
    };
  }

  const [moved] = entries.splice(fromIdx, 1);
  if (!moved) {
    return { ok: false, status: 404, error: `Redirect "${from}" not found in custom-redirects.yml` };
  }
  const insertAt = findIndex(entries, beforeFrom);
  if (insertAt < 0) {
    return {
      ok: false,
      status: 404,
      code: "before_from_not_found",
      error: `before_from "${beforeFrom}" not found in custom-redirects.yml`,
    };
  }
  entries.splice(insertAt, 0, moved);

  const file = persist(opts.contentRoot, opts.contentRootName, entries, opts.authorName);
  return { ok: true, file, index: insertAt };
}
