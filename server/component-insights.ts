import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getAllConfigs } from "./content-types";
import { contentIndex } from "./content-index";
import type {

  ComponentInsightsData,
  ComponentPairing,
  ComponentSequence,
  IntentCluster,
  PageIntent,
} from "@shared/schema";
import { child } from "./logger";
const log = child({ module: "component-insights" });


const SETTINGS_PATH = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", "settings.yml");
const OUTPUT_PATH = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", "component-insights.json");

const DEFAULT_INTENT = "brand_corporate";
const FALLBACK_CLUSTER_MIN = 3;
const PMI_EPSILON = 0.01;

interface PageRecord {
  contentType: string;
  slug: string;
  intent: string;
  weight: number;
  sections: string[];
}

function loadPageIntents(): PageIntent[] {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed?.page_intents || !Array.isArray(parsed.page_intents)) return [];
    return (parsed.page_intents as Array<{ id: string; what_for: string }>)
      .filter((e) => typeof e.id === "string" && typeof e.what_for === "string");
  } catch {
    return [];
  }
}

function extractSectionTypes(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const sections = record.sections;
  if (!Array.isArray(sections)) return [];
  return sections
    .filter((s) => s && typeof s === "object" && typeof (s as Record<string, unknown>).type === "string")
    .map((s) => String((s as Record<string, unknown>).type));
}

function safeYamlLoad(raw: string): Record<string, unknown> | null {
  try {
    return contentIndex.safeYamlLoad(raw);
  } catch {
    return null;
  }
}

function readInsightsFieldsFromYaml(data: Record<string, unknown>): {
  intent: string | undefined;
  weight: number | undefined;
} {
  let intent: string | undefined;
  let weight: number | undefined;

  if (typeof data.insights_intent === "string") {
    intent = data.insights_intent;
  }
  if (data.insights_weight !== undefined) {
    const raw = data.insights_weight;
    if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
      weight = raw;
    } else {
      log.warn(
        `[ComponentInsights] insights_weight "${raw}" is not a positive integer — ignoring, using default 1.`
      );
    }
  }
  return { intent, weight };
}

function scanPages(validIntentIds: Set<string>, contentTypeIntentMap: Map<string, string>): PageRecord[] {
  const pages: PageRecord[] = [];
  const configs = getAllConfigs();

  for (const [contentType, config] of Object.entries(configs)) {
    const hasSections = !(config as Record<string, unknown>).database;
    if (!hasSections) continue;

    let slugs: string[];
    try {
      slugs = contentIndex.listContentSlugs(contentType as Parameters<typeof contentIndex.listContentSlugs>[0]);
    } catch {
      continue;
    }

    const ctDefault = contentTypeIntentMap.get(contentType) ?? DEFAULT_INTENT;
    const contentDir = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", (config as Record<string, unknown>).directory as string);

    for (const slug of slugs) {
      let sectionTypes: string[] = [];
      let pageIntent: string | undefined;
      let weight = 1;

      // Step 1: Try _common.yml via contentIndex for intent/weight overrides and shared sections
      try {
        const commonData = contentIndex.loadCommonData(
          contentType as Parameters<typeof contentIndex.loadCommonData>[0],
          slug
        );
        if (commonData) {
          const fields = readInsightsFieldsFromYaml(commonData);
          if (fields.intent) pageIntent = fields.intent;
          if (fields.weight !== undefined) weight = fields.weight;
          sectionTypes = extractSectionTypes(commonData);
        }
      } catch {
        // loadCommonData failed — proceed to locale file scan below
      }

      // Step 2: Scan locale files in the slug directory.
      // Always read them for insights_intent/weight overrides (page-level override
      // takes precedence over _common.yml and content-type default per spec).
      // Also use them as the section source if _common.yml had no sections.
      const slugDir = path.join(contentDir, slug);
      try {
        const files = fs.readdirSync(slugDir).filter(
          (f) => f.endsWith(".yml") && !f.startsWith("_")
        );
        // Prefer en.yml first, then any other locale file
        const ordered = [
          ...files.filter((f) => f === "en.yml"),
          ...files.filter((f) => f !== "en.yml"),
        ];
        for (const file of ordered) {
          try {
            const raw = fs.readFileSync(path.join(slugDir, file), "utf-8");
            const data = safeYamlLoad(raw);
            if (!data) continue;
            // Page-level overrides: locale file always wins over _common.yml
            const fields = readInsightsFieldsFromYaml(data);
            if (fields.intent) pageIntent = fields.intent;
            if (fields.weight !== undefined) weight = fields.weight;
            // Only extract sections from locale file if not already found in _common.yml
            if (sectionTypes.length === 0) {
              const found = extractSectionTypes(data);
              if (found.length > 0) {
                sectionTypes = found;
              }
            }
          } catch {
            // skip unreadable file
          }
        }
      } catch {
        // slugDir unreadable — skip slug entirely
        continue;
      }

      if (sectionTypes.length === 0) continue;

      const resolvedIntent = pageIntent ?? ctDefault;
      const validatedIntent = validIntentIds.has(resolvedIntent)
        ? resolvedIntent
        : (() => {
            if (pageIntent) {
              log.warn(
                `[ComponentInsights] Unknown intent "${pageIntent}" on ${contentType}/${slug}, falling back to "${DEFAULT_INTENT}"`
              );
            }
            return DEFAULT_INTENT;
          })();

      pages.push({ contentType, slug, intent: validatedIntent, weight, sections: sectionTypes });
    }
  }

  return pages;
}

interface PairingAccumulator {
  count: number;
  fromCount: number;
  toCount: number;
  totalTransitions: number;
  totalPages: number;
  totalWeight: number;
}

function computePairings(pages: PageRecord[]): ComponentPairing[] {
  const pairMap = new Map<string, { count: number }>();
  const fromMap = new Map<string, number>();
  const toMap = new Map<string, number>();
  let totalTransitions = 0;
  let totalWeight = 0;

  for (const page of pages) {
    const w = page.weight;
    totalWeight += w;
    for (let i = 0; i < page.sections.length - 1; i++) {
      const from = page.sections[i];
      const to = page.sections[i + 1];
      const key = `${from}|||${to}`;
      const existing = pairMap.get(key);
      if (existing) {
        existing.count += w;
      } else {
        pairMap.set(key, { count: w });
      }
      fromMap.set(from, (fromMap.get(from) ?? 0) + w);
      toMap.set(to, (toMap.get(to) ?? 0) + w);
      totalTransitions += w;
    }
  }

  const pairings: ComponentPairing[] = [];

  for (const [key, { count }] of pairMap.entries()) {
    const [from, to] = key.split("|||");
    const frequency = fromMap.get(from) ? count / (fromMap.get(from) ?? 1) : 0;
    const pAB = count / (totalTransitions || 1);
    const pA = (fromMap.get(from) ?? 0) / (totalTransitions || 1);
    const pB = (toMap.get(to) ?? 0) / (totalTransitions || 1);
    const rawPmi = pA > 0 && pB > 0 ? Math.log(pAB / (pA * pB)) : -Infinity;
    const pmi = isFinite(rawPmi) ? rawPmi : -10;
    const distance = 1 / Math.max(pmi, PMI_EPSILON);

    pairings.push({ from, to, count, frequency: Math.round(frequency * 1000) / 1000, pmi: Math.round(pmi * 1000) / 1000, distance: Math.round(distance * 1000) / 1000 });
  }

  return pairings.sort((a, b) => b.count - a.count);
}

function computeTopSequences(pages: PageRecord[], maxSeqs = 20): ComponentSequence[] {
  const seqMap = new Map<string, number>();

  for (const page of pages) {
    if (page.sections.length < 2) continue;
    const key = page.sections.join(" → ");
    seqMap.set(key, (seqMap.get(key) ?? 0) + page.weight);
  }

  return Array.from(seqMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSeqs)
    .map(([key, count]) => ({ sequence: key.split(" → "), count }));
}

function buildCluster(pages: PageRecord[]): IntentCluster {
  return {
    pairings: computePairings(pages),
    topSequences: computeTopSequences(pages),
    pageCount: pages.length,
  };
}

export function runScan(): ComponentInsightsData {
  const intents = loadPageIntents();
  const validIntentIds = new Set(intents.map((i) => i.id));
  const configs = getAllConfigs();

  const contentTypeIntentMap = new Map<string, string>();
  for (const [ct, cfg] of Object.entries(configs)) {
    const raw = cfg as Record<string, unknown>;
    if (typeof raw.insights_intent === "string") {
      const ctIntent = raw.insights_intent as string;
      if (!validIntentIds.has(ctIntent)) {
        log.warn(
          `[ComponentInsights] Content type "${ct}" has insights_intent "${ctIntent}" which is not in settings.yml page_intents. Falling back to "${DEFAULT_INTENT}".`
        );
      } else {
        contentTypeIntentMap.set(ct, ctIntent);
      }
    }
  }

  const pages = scanPages(validIntentIds, contentTypeIntentMap);

  const byIntentPages = new Map<string, PageRecord[]>();
  for (const page of pages) {
    if (!byIntentPages.has(page.intent)) byIntentPages.set(page.intent, []);
    byIntentPages.get(page.intent)!.push(page);
  }

  const byIntent: Record<string, IntentCluster> = {};
  for (const [intent, iPages] of byIntentPages.entries()) {
    byIntent[intent] = buildCluster(iPages);
  }

  const totalWeight = pages.reduce((s, p) => s + p.weight, 0);
  const weightedPagesCount = pages.filter((p) => p.weight > 1).length;

  const data: ComponentInsightsData = {
    generatedAt: new Date().toISOString(),
    meta: {
      totalPagesScanned: pages.length,
      totalWeight,
      weightedPagesCount,
      intents: intents.map((i) => i.id),
      pageIntents: intents,
    },
    global: buildCluster(pages),
    byIntent,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), "utf-8");
  log.info(`[ComponentInsights] Wrote ${OUTPUT_PATH} — ${pages.length} pages scanned`);

  return data;
}

export function readInsightsFile(): ComponentInsightsData | null {
  if (!fs.existsSync(OUTPUT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8")) as ComponentInsightsData;
  } catch {
    return null;
  }
}

export interface ComponentUsageResult {
  componentType: string;
  scope: Record<string, string>;
  totalUses: number;
  pages: Array<{ contentType: string; slug: string; position: number }>;
  neighbors: {
    before: Array<{ type: string; count: number }>;
    after: Array<{ type: string; count: number }>;
  };
  topSequences: Array<{ sequence: string[]; count: number }>;
}

export function getComponentUsageData(
  componentType: string,
  filters: { intent?: string; contentType?: string },
): ComponentUsageResult {
  let data = readInsightsFile();
  if (!data) {
    data = runScan();
  }

  const intents = loadPageIntents();
  const validIntentIds = new Set(intents.map((i) => i.id));
  const configs = getAllConfigs();
  const contentTypeIntentMap = new Map<string, string>();
  for (const [ct, cfg] of Object.entries(configs)) {
    const raw = cfg as Record<string, unknown>;
    if (typeof raw.insights_intent === "string") {
      contentTypeIntentMap.set(ct, raw.insights_intent as string);
    }
  }

  const allPages = scanPages(validIntentIds, contentTypeIntentMap);

  let scopedPages = allPages;
  if (filters.contentType) {
    scopedPages = scopedPages.filter((p) => p.contentType === filters.contentType);
  }
  if (filters.intent) {
    scopedPages = scopedPages.filter((p) => p.intent === filters.intent);
  }

  const usagePages: Array<{ contentType: string; slug: string; position: number }> = [];
  let totalUses = 0;
  for (const page of scopedPages) {
    page.sections.forEach((section, idx) => {
      if (section === componentType) {
        usagePages.push({ contentType: page.contentType, slug: page.slug, position: idx + 1 });
        totalUses++;
      }
    });
  }

  // Compute neighbors and sequences directly from scoped pages so they always
  // reflect exactly the same scope as totalUses/pages (no cluster fallback).
  const beforeMap = new Map<string, number>();
  const afterMap = new Map<string, number>();
  for (const page of scopedPages) {
    for (let i = 0; i < page.sections.length; i++) {
      if (page.sections[i] === componentType) {
        if (i > 0) {
          const prev = page.sections[i - 1];
          beforeMap.set(prev, (beforeMap.get(prev) ?? 0) + page.weight);
        }
        if (i < page.sections.length - 1) {
          const next = page.sections[i + 1];
          afterMap.set(next, (afterMap.get(next) ?? 0) + page.weight);
        }
      }
    }
  }
  const before = Array.from(beforeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));
  const after = Array.from(afterMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));

  const topSequences = computeTopSequences(scopedPages)
    .filter((s) => s.sequence.includes(componentType))
    .slice(0, 5);

  const scope: Record<string, string> = {};
  if (filters.intent) scope.intent = filters.intent;
  if (filters.contentType) scope.contentType = filters.contentType;

  return { componentType, scope, totalUses, pages: usagePages, neighbors: { before, after }, topSequences };
}

export function suggestNext(
  after: string,
  intent: string | undefined,
  rankBy: "frequency" | "pmi",
): ComponentPairing[] {
  const data = readInsightsFile();
  if (!data) return [];

  const intentCluster = intent && data.byIntent[intent];
  const cluster: IntentCluster | null =
    intentCluster && intentCluster.pageCount >= FALLBACK_CLUSTER_MIN
      ? intentCluster
      : data.global;

  const matches = cluster.pairings.filter((p) => p.from === after);
  return matches.sort((a, b) =>
    rankBy === "pmi" ? b.pmi - a.pmi : b.frequency - a.frequency
  );
}
