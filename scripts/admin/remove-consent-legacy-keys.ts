#!/usr/bin/env tsx
/**
 * remove-consent-legacy-keys.ts
 *
 * One-off fixer: removes legacy `marketing_text:` and `sms_text:` keys (and
 * any block-scalar continuation lines) from `consent:` blocks in YAML content
 * files under 4geeks-com/.
 *
 * These keys are silently ignored by the lead form's three-level priority
 * resolution (which always falls back to `reserved.consent_marketing` /
 * `reserved.consent_sms`), but they create noise in the content files and
 * could confuse future editors.
 *
 * The script handles two cases:
 *   1. Key line still present (e.g. `marketing_text: >-`) — removes the key
 *      line AND all subsequent block-scalar continuation lines (lines with
 *      strictly greater indentation).
 *   2. Key line already removed but orphaned continuation lines remain inside
 *      a `consent:` block — detects and removes those floating text lines.
 *
 * Usage:
 *   npx tsx scripts/admin/remove-consent-legacy-keys.ts           # dry run
 *   npx tsx scripts/admin/remove-consent-legacy-keys.ts --write   # apply
 */

import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

const MARKETING_CONTENT_DIR = path.join(process.cwd(), "4geeks-com");
const DRY_RUN = !process.argv.includes("--write");

const LEGACY_KEY_RE = /^(\s+)(marketing_text|sms_text)\s*:/;
const CONSENT_BLOCK_RE = /^(\s+)consent:\s*$/;
const YAML_KEY_RE = /^\s+[\w_-][\w_-]*\s*:/;

function processFile(original: string): { content: string; removedCount: number } {
  const lines = original.split("\n");
  const result: string[] = [];

  let skipBelowIndent = -1;       // skip continuation lines when > this indent
  let inConsent = false;
  let consentChildIndent = -1;    // indentation of direct consent children
  let consentIndent = -1;         // indentation of the `consent:` key itself

  let removedCount = 0;

  for (const line of lines) {
    const stripped = line.replace(/\n$/, "");

    // ── Phase 1: skip mode (continuation lines after a legacy key) ──────────
    if (skipBelowIndent >= 0) {
      const curIndent = stripped.length - stripped.trimStart().length;
      if (stripped.trim() === "" || curIndent > skipBelowIndent) {
        // blank lines inside a block scalar OR deeper continuation — skip
        // but we only skip non-empty continuation lines; blank lines between
        // keys are fine to keep, so only skip if we haven't left the scalar
        if (stripped.trim() !== "") {
          removedCount++;
          continue;
        }
        // blank line: keep it but stay in skip mode
        result.push(stripped);
        continue;
      }
      // indentation returned to key level or higher — exit skip mode
      skipBelowIndent = -1;
    }

    // ── Phase 2: detect and remove legacy key lines ──────────────────────────
    const legacyMatch = LEGACY_KEY_RE.exec(stripped);
    if (legacyMatch) {
      const keyIndent = legacyMatch[1].length;
      skipBelowIndent = keyIndent; // skip any continuation lines
      removedCount++;
      continue;
    }

    // ── Phase 3: track consent block context ─────────────────────────────────
    const consentMatch = CONSENT_BLOCK_RE.exec(stripped);
    if (consentMatch) {
      inConsent = true;
      consentIndent = consentMatch[1].length;
      consentChildIndent = -1;
      result.push(stripped);
      continue;
    }

    if (inConsent && stripped.trim() !== "") {
      const curIndent = stripped.length - stripped.trimStart().length;
      if (curIndent <= consentIndent) {
        // Exited the consent block
        inConsent = false;
        consentIndent = -1;
        consentChildIndent = -1;
      } else {
        // Inside consent block
        if (consentChildIndent === -1 && YAML_KEY_RE.test(stripped)) {
          consentChildIndent = curIndent;
        }
        // Orphaned continuation line: deeper than child keys AND not a key itself
        if (
          consentChildIndent !== -1 &&
          curIndent > consentChildIndent &&
          !YAML_KEY_RE.test(stripped)
        ) {
          removedCount++;
          continue;
        }
      }
    }

    result.push(stripped);
  }

  return { content: result.join("\n"), removedCount };
}

async function main() {
  if (DRY_RUN) {
    console.log("DRY RUN — pass --write to apply changes\n");
  }

  const files = await glob("**/*.yml", {
    cwd: MARKETING_CONTENT_DIR,
    absolute: true,
  });

  let totalFilesChanged = 0;
  let totalLinesRemoved = 0;

  for (const filePath of files.sort()) {
    const original = fs.readFileSync(filePath, "utf8");
    const { content, removedCount } = processFile(original);

    if (removedCount === 0) continue;

    totalFilesChanged++;
    totalLinesRemoved += removedCount;

    const relative = path.relative(process.cwd(), filePath);
    console.log(
      `  ${relative}  (${removedCount} line${removedCount > 1 ? "s" : ""} removed)`
    );

    if (!DRY_RUN) {
      fs.writeFileSync(filePath, content, "utf8");
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry run] Would remove" : "Removed"} ${totalLinesRemoved} line(s) from ${totalFilesChanged} file(s).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
