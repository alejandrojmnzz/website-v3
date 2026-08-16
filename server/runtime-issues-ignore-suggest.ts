import {
  heuristicIgnoreSuggestions,
  previewIgnoreRules,
  formatIgnoreRulePreview,
  suggestionFromKind,
  type IgnoreRuleInput,
  type IgnoreTemplateKind,
} from "@shared/runtime-issues-ignore";
import { normalizeRuntimePath } from "@shared/runtime-issues";
import { getLLMService } from "./ai/LLMService";
import { child } from "./logger";

const log = child({ module: "runtime-issues-ignore-suggest" });

const LLM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kinds"],
  properties: {
    kinds: {
      type: "array",
      items: { type: "string", enum: ["exact", "locales", "slug_list"] },
    },
  },
} as const;

export interface IgnoreSuggestOption {
  key: string;
  label: string;
  source: "heuristic" | "llm";
  rules: IgnoreRuleInput[];
  preview: string;
  matchCount: number;
  samplePaths: string[];
}

export function neighborIgnorePaths(seedPaths: string[], allPaths: string[], limit = 40): string[] {
  const seeds = new Set(seedPaths.map(normalizeRuntimePath));
  const lastSegs = new Set([...seeds].map((p) => p.split("/").filter(Boolean).pop() ?? "").filter(Boolean));
  const prefixes = [...seeds].map((p) => {
    const segs = p.split("/").filter(Boolean);
    return segs.length >= 2 ? `/${segs.slice(0, -1).join("/")}/` : p;
  });
  return allPaths
    .map(normalizeRuntimePath)
    .filter((p) => !seeds.has(p))
    .map((p) => {
      const last = p.split("/").filter(Boolean).pop() ?? "";
      const prefixHit = prefixes.some((pre) => p.startsWith(pre));
      const lastHit = lastSegs.has(last);
      return { p, score: (prefixHit ? 2 : 0) + (lastHit ? 1 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

function toOption(
  group: { key: string; label: string; source: "heuristic" | "llm"; rules: IgnoreRuleInput[] },
  allPaths: string[],
): IgnoreSuggestOption {
  const preview = previewIgnoreRules(group.rules, allPaths);
  return {
    ...group,
    preview: group.rules.map(formatIgnoreRulePreview).join("\n"),
    matchCount: preview.matchCount,
    samplePaths: preview.samplePaths,
  };
}

async function llmIgnoreKinds(seedPaths: string[], allPaths: string[]): Promise<IgnoreTemplateKind[]> {
  const neighbors = neighborIgnorePaths(seedPaths, allPaths);
  const llm = getLLMService();
  const result = await llm.adaptContentStructured(
    "You classify 404 URL groups into ignore templates. Return only kinds from exact, locales, slug_list. Never invent regex. slug_list is only for several selected slugs under one folder. locales is the same remainder in multiple locales.",
    `Seed paths:\n${seedPaths.join("\n")}\n\nNeighbor 404s (context only):\n${neighbors.join("\n") || "(none)"}\n\nReturn the kinds that fit.`,
    {
      temperature: 0.2,
      schemaName: "runtime_ignore_kinds",
      jsonSchema: LLM_SCHEMA as unknown as Record<string, unknown>,
    },
  );
  const raw = result.content?.kinds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is IgnoreTemplateKind => k === "exact" || k === "locales" || k === "slug_list");
}

export async function suggestIgnoreTemplates(input: {
  seedPaths: string[];
  allPaths: string[];
  locales: string[];
}): Promise<{ suggestions: IgnoreSuggestOption[]; llmFailed: boolean }> {
  const seedPaths = Array.from(new Set(input.seedPaths.map(normalizeRuntimePath).filter(Boolean)));
  const heuristics = heuristicIgnoreSuggestions(seedPaths, input.locales).map((g) =>
    toOption(g, input.allPaths),
  );
  let llmFailed = false;
  const seen = new Set(heuristics.map((s) => s.key));
  const extra: IgnoreSuggestOption[] = [];
  if (seedPaths.length) {
    try {
      const kinds = await llmIgnoreKinds(seedPaths, input.allPaths);
      for (const kind of kinds) {
        const group = suggestionFromKind(kind, seedPaths, input.locales);
        if (!group || seen.has(group.key)) continue;
        seen.add(group.key);
        extra.push(toOption({ ...group, source: "llm" }, input.allPaths));
      }
    } catch (err) {
      llmFailed = true;
      log.warn({ err }, "runtime-issues ignore LLM suggest failed; using heuristics only");
    }
  }
  return { suggestions: [...heuristics, ...extra], llmFailed };
}
