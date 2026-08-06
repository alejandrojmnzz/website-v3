#!/usr/bin/env npx tsx
/**
 * Repair CTA-tracking migration damage from unsafe js-yaml round-trips.
 *
 * Restores corrupted files from GitHub main, then re-applies tracking using
 * template-safe load/dump (escape {{ }} before yaml.load).
 *
 * Usage: npx tsx scripts/repair-cta-tracking-migration.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { execFileSync } from "child_process";
import {
  escapeTemplateVars,
  unescapeObjectVars,
  escapeObjectVars,
  unescapeYamlDump,
} from "../shared/templateVars";
import { inferCtaTrackingFromUrl, isCtaTrackingValue } from "../shared/component-behaviors";
import { resolveBoundCtaPaths } from "../shared/validateCtaTracking";
import { loadAllFieldEditors } from "../server/component-registry";

const REPO = "breatheco-de/website-4geeks-com";
const ROOT = process.cwd();

function safeYamlLoad(raw: string): Record<string, unknown> | null {
  const { escaped, map } = escapeTemplateVars(raw);
  const loaded = yaml.load(escaped);
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return null;
  return unescapeObjectVars(loaded, map) as Record<string, unknown>;
}

function safeYamlDump(obj: unknown): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  return unescapeYamlDump(dumped, map);
}

function findCorruptedFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "component-registry" || entry.name === "node_modules") continue;
      out.push(...findCorruptedFiles(full));
    } else if (/\.ya?ml$/.test(entry.name)) {
      if (fs.readFileSync(full, "utf-8").includes("[object Object]")) out.push(full);
    }
  }
  return out;
}

function fetchRemote(relPath: string): string | null {
  try {
    const b64 = execFileSync(
      "gh",
      ["api", `repos/${REPO}/contents/${relPath}?ref=main`, "--jq", ".content"],
      { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 },
    ).trim();
    if (!b64 || b64 === "null") return null;
    return Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf-8");
  } catch (e) {
    console.error("fetch failed", relPath, e);
    return null;
  }
}

function getByPath(obj: unknown, pathStr: string): unknown {
  const parts = pathStr.replace(/\[\]/g, ".$").split(".").filter(Boolean);
  const walk = (current: unknown, rem: string[]): unknown => {
    if (rem.length === 0) return current;
    const [head, ...rest] = rem;
    if (head === "$") {
      if (!Array.isArray(current)) return undefined;
      return current.map((item) => walk(item, rest));
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return walk((current as Record<string, unknown>)[head!], rest);
  };
  return walk(obj, parts);
}

function visitCtas(value: unknown, mutate: (cta: Record<string, unknown>) => boolean): boolean {
  let changed = false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (visitCtas(item, mutate)) changed = true;
    }
    return changed;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.url === "string" && typeof o.text === "string") {
      if (mutate(o)) changed = true;
      return changed;
    }
    for (const v of Object.values(o)) {
      if (visitCtas(v, mutate)) changed = true;
    }
  }
  return changed;
}

function applyTracking(filePath: string, fieldEditors: ReturnType<typeof loadAllFieldEditors>): number {
  const parsed = safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
  if (!parsed) return 0;

  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  let ctas = 0;
  let fileChanged = false;

  for (const section of sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    const sec = section as Record<string, unknown>;
    const type = String(sec.type ?? "");
    const editors = fieldEditors[type] ?? {};
    const variant = typeof sec.variant === "string" ? sec.variant : undefined;
    const ctaPaths = resolveBoundCtaPaths(editors, variant);
    for (const ctaPath of ctaPaths) {
      const val = getByPath(sec, ctaPath);
      if (val === undefined) continue;
      const changed = visitCtas(val, (cta) => {
        if (isCtaTrackingValue(cta.tracking)) return false;
        cta.tracking = inferCtaTrackingFromUrl(cta.url);
        ctas++;
        return true;
      });
      if (changed) fileChanged = true;
    }
  }

  if (fileChanged) {
    fs.writeFileSync(filePath, safeYamlDump(parsed), "utf-8");
  }
  return ctas;
}

function main() {
  const corrupted = [
    ...findCorruptedFiles(path.join(ROOT, "site_4geeks-com")),
    ...findCorruptedFiles(path.join(ROOT, "site_4geeks-florida")),
  ];
  console.log(`Found ${corrupted.length} corrupted files`);

  let restored = 0;
  for (const full of corrupted) {
    const rel = path.relative(ROOT, full);
    const remote = fetchRemote(rel);
    if (!remote) {
      console.error("SKIP (no remote)", rel);
      continue;
    }
    if (remote.includes("[object Object]")) {
      console.error("REMOTE ALSO CORRUPT?", rel);
    }
    fs.writeFileSync(full, remote, "utf-8");
    restored++;
    console.log("restored", rel);
  }

  const fieldEditors = loadAllFieldEditors();
  let totalCtas = 0;
  for (const full of corrupted) {
    if (!fs.existsSync(full)) continue;
    const n = applyTracking(full, fieldEditors);
    if (n > 0) console.log(`tracking +${n}`, path.relative(ROOT, full));
    totalCtas += n;
  }

  const stillBad = [
    ...findCorruptedFiles(path.join(ROOT, "site_4geeks-com")),
    ...findCorruptedFiles(path.join(ROOT, "site_4geeks-florida")),
  ];
  console.log(`Done. restored=${restored} ctas_reapplied=${totalCtas} still_corrupted=${stillBad.length}`);
  if (stillBad.length) {
    for (const f of stillBad) console.error("STILL BAD", path.relative(ROOT, f));
    process.exit(1);
  }

  // Spot-check templates survived
  const sample = path.join(ROOT, "site_4geeks-com/programs/ai-fluency/en.yml");
  const text = fs.readFileSync(sample, "utf-8");
  console.log("sample has template:", text.includes("{{ global.global_review_rating"));
  console.log("sample has tracking:", text.includes("tracking: add_to_cart"));
}

main();
