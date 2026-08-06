#!/usr/bin/env npx tsx
/**
 * One-shot migration: set cta.tracking from URL heuristics on bound cta-tracking paths.
 * Usage: npx tsx scripts/migrate-cta-tracking.ts [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  escapeTemplateVars,
  unescapeObjectVars,
  escapeObjectVars,
  unescapeYamlDump,
} from "../shared/templateVars";
import { inferCtaTrackingFromUrl, isCtaTrackingValue } from "../shared/component-behaviors";
import { resolveBoundCtaPaths } from "../shared/validateCtaTracking";
import { loadAllFieldEditors } from "../server/component-registry";

const dryRun = process.argv.includes("--dry-run");
const ROOTS = [
  path.join(process.cwd(), "site_4geeks-com"),
  path.join(process.cwd(), "site_4geeks-florida"),
];

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

function walkYaml(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "component-registry" || entry.name === "node_modules") continue;
      out.push(...walkYaml(full));
    } else if (/\.ya?ml$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
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

function main() {
  const fieldEditors = loadAllFieldEditors();
  let filesChanged = 0;
  let ctasUpdated = 0;

  for (const root of ROOTS) {
    for (const filePath of walkYaml(root)) {
      let parsed: Record<string, unknown>;
      try {
        const loaded = safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
        if (!loaded) continue;
        parsed = loaded;
      } catch {
        continue;
      }

      const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
      let fileChanged = false;

      for (const section of sections) {
        if (!section || typeof section !== "object" || Array.isArray(section)) continue;
        const sec = section as Record<string, unknown>;
        const type = String(sec.type ?? "");
        const editors = fieldEditors[type] ?? {};
        const variant = typeof sec.variant === "string" ? sec.variant : undefined;
        const ctaPaths = resolveBoundCtaPaths(editors, variant);

        for (const ctaPath of ctaPaths) {
          const raw = getByPath(sec, ctaPath);
          if (raw === undefined) continue;
          const changed = visitCtas(raw, (cta) => {
            if (isCtaTrackingValue(cta.tracking)) return false;
            const inferred = inferCtaTrackingFromUrl(cta.url);
            cta.tracking = inferred;
            ctasUpdated++;
            return true;
          });
          if (changed) fileChanged = true;
        }
      }

      if (fileChanged) {
        filesChanged++;
        if (!dryRun) {
          fs.writeFileSync(filePath, safeYamlDump(parsed), "utf-8");
        }
        console.log(`${dryRun ? "[dry-run] " : ""}updated ${path.relative(process.cwd(), filePath)}`);
      }
    }
  }

  console.log(`Done. files=${filesChanged} ctas=${ctasUpdated} dryRun=${dryRun}`);
}

main();
