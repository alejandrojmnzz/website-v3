#!/usr/bin/env node
/**
 * Merges 4geeks-com/faqs/en.yml and 4geeks-com/faqs/es.yml
 * into 4geeks-com/frequently_asked_question/faqs.yml
 *
 * Each FAQ entry in the output gets a `locale` field ("en" or "es").
 * Entries from en.yml appear first, followed by entries from es.yml.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, "..", "4geeks-com");
const EN_FILE = path.join(ROOT, "faqs", "en.yml");
const ES_FILE = path.join(ROOT, "faqs", "es.yml");
const OUT_DIR = path.join(ROOT, "frequently_asked_question");
const OUT_FILE = path.join(OUT_DIR, "faqs.yml");

function loadFaqs(filePath, locale) {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = yaml.load(raw);
  if (!doc || !Array.isArray(doc.faqs)) {
    throw new Error(`Expected a top-level "faqs" array in ${filePath}`);
  }
  return doc.faqs.map((entry) => ({ locale, ...entry }));
}

const enFaqs = loadFaqs(EN_FILE, "en");
const esFaqs = loadFaqs(ES_FILE, "es");

console.log(`Loaded ${enFaqs.length} English FAQs`);
console.log(`Loaded ${esFaqs.length} Spanish FAQs`);

const merged = { faqs: [...enFaqs, ...esFaqs] };

fs.mkdirSync(OUT_DIR, { recursive: true });

const output = yaml.dump(merged, {
  lineWidth: 120,
  quotingType: '"',
  forceQuotes: false,
  noRefs: true,
});

fs.writeFileSync(OUT_FILE, output, "utf8");

console.log(`\nWrote ${merged.faqs.length} total FAQs to:`);
console.log(`  ${OUT_FILE}`);
