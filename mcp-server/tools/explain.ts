import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import yaml from "js-yaml";
import { MARKETING_CONTENT_PATH } from "../lib/content.js";

// Use cwd so this resolves correctly both under tsx (mcp-server/…) and the
// production bundle (dist/mcp-server.js).
const EXPLAIN_DIR = path.join(process.cwd(), "mcp-server", "explain");

const VALID_TOPICS = [
  "overview",
  "content_system",
  "routing",
  "images",
  "sections",
  "semantic_search",
  "component-behaviors",
  "ecommerce",
  "shared-layout",
] as const;
type Topic = (typeof VALID_TOPICS)[number];

// ─── Dynamic tag resolvers ────────────────────────────────────────────────────

function resolveContentTypes(): string {
  const filePath = path.join(MARKETING_CONTENT_PATH, "content-types.yml");
  if (!fs.existsSync(filePath)) return "_content-types.yml not found_";
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, Record<string, unknown>> | null;
    if (!parsed) return "_could not parse content-types.yml_";
    const lines: string[] = [
      "| Type | Directory | URL pattern | DB-backed | single_template |",
      "|---|---|---|---|---|",
    ];
    for (const [type, config] of Object.entries(parsed)) {
      const dir = (config.directory as string | undefined) || type;
      const pattern = config.url_pattern
        ? Object.entries(config.url_pattern as Record<string, string>)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "—";
      const dbBacked = config.database ? "yes" : "no";
      const singleTemplate = config.single_template ? "yes" : "no";
      lines.push(`| \`${type}\` | \`${dir}\` | ${pattern} | ${dbBacked} | ${singleTemplate} |`);
    }
    return lines.join("\n");
  } catch {
    return "_error reading content-types.yml_";
  }
}

function resolveActiveLocales(): string {
  const filePath = path.join(MARKETING_CONTENT_PATH, "settings.yml");
  if (!fs.existsSync(filePath)) return "_settings.yml not found_";
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed) return "_could not parse settings.yml_";
    const i18n = parsed.i18n as Record<string, unknown> | undefined;
    if (!i18n) return "_no i18n section in settings.yml_";
    const defaultLocale = i18n.default_locale as string | undefined;
    const supported = i18n.supported_locales as Array<{ code: string; label: string }> | undefined;
    if (!supported || !supported.length) return "_no supported_locales defined_";
    const lines: string[] = ["| Code | Label | Default |", "|---|---|---|"];
    for (const locale of supported) {
      const isDefault = locale.code === defaultLocale ? "yes" : "";
      lines.push(`| \`${locale.code}\` | ${locale.label} | ${isDefault} |`);
    }
    return lines.join("\n");
  } catch {
    return "_error reading settings.yml_";
  }
}

function resolveImageStorage(): string {
  const filePath = path.join(MARKETING_CONTENT_PATH, "image-registry.json");
  if (!fs.existsSync(filePath)) return "_image-registry.json not found_";
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const registry = JSON.parse(raw) as Record<string, unknown>;
    const presets = registry.presets as Record<string, { description?: string }> | undefined;
    const presetNames = presets ? Object.keys(presets) : [];

    const lines: string[] = [
      "**New images:** `4geeks-com/images/` (served at `/4geeks-com/images/`)",
      "",
      "**Legacy images:** `attached_assets/` (served at `/attached_assets/`). The `attached_assets/` folder also contains conversation screenshots which are excluded from the registry scanner.",
      "",
      `**Available presets:** ${presetNames.map(p => `\`${p}\``).join(", ")}`,
    ];
    return lines.join("\n");
  } catch {
    return "_error reading image-registry.json_";
  }
}

// ─── Tag resolver ─────────────────────────────────────────────────────────────

const TAG_RESOLVERS: Record<string, () => string> = {
  content_types: resolveContentTypes,
  active_locales: resolveActiveLocales,
  image_storage: resolveImageStorage,
};

export function resolveDynamicTags(content: string): string {
  return content.replace(
    /<!-- @dynamic:(\w+) -->([\s\S]*?)<!-- \/dynamic -->/g,
    (_match, tag: string) => {
      const resolver = TAG_RESOLVERS[tag];
      if (!resolver) return `_unknown dynamic tag: ${tag}_`;
      return resolver();
    },
  );
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerExplainTools(mcp: McpServer): void {
  mcp.tool(
    "explain_site",
    "Returns architectural context about this codebase for a given topic. " +
      "Call this tool BEFORE making any structural change to the codebase — it explains how key subsystems work. " +
      "Valid topics: 'overview' (start here — summary + list of all topics), 'content_system' (YAML content files, _common.yml merge, safeYamlLoad), " +
      "'routing' (URL patterns, locale prefixes, /en/ vs /es/), " +
      "'images' (image registry, UniversalImage, image_id usage), " +
      "'sections' (SectionRenderer, component registry, how sections are authored), " +
      "'semantic_search' (Qdrant, local embeddings, vector_search config, keyword fallback), " +
      "'component-behaviors' (CTA tracking, behaviors ids), " +
      "'ecommerce' (products, funnels, product scope property paths, no CMS plans), " +
      "'shared-layout' (single_template / shared shell, create_entry playbook, blog as example). " +
      "Calling an unknown topic returns a clear error listing the valid options.",
    {
      topic: z
        .string()
        .describe(
          "The architectural topic to explain. One of: overview, content_system, routing, images, sections, semantic_search, component-behaviors, ecommerce, shared-layout.",
        ),
    },
    async ({ topic }) => {
      if (!(VALID_TOPICS as readonly string[]).includes(topic)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "unknown_topic",
                  message: `'${topic}' is not a valid topic. Call explain_site with one of the valid topics listed below.`,
                  valid_topics: VALID_TOPICS.map((t) => ({
                    topic: t,
                    description:
                      t === "overview"
                        ? "Start here — architectural summary and guide to all topics"
                        : t === "content_system"
                          ? "YAML content files, _common.yml merge, safeYamlLoad requirement"
                          : t === "routing"
                            ? "URL patterns, locale prefixes (/en/, /es/), dynamic route generation"
                            : t === "images"
                              ? "Image registry, UniversalImage component, image_id referencing"
                              : t === "sections"
                                ? "SectionRenderer, component registry, how sections are authored"
                                : "Qdrant vector store, local embeddings, database vector_search, keyword fallback",
                  })),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const filePath = path.join(EXPLAIN_DIR, `${topic as Topic}.md`);
      if (!fs.existsSync(filePath)) {
        return {
          content: [
            {
              type: "text",
              text: `explain file not found for topic '${topic}' at ${filePath}`,
            },
          ],
          isError: true,
        };
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const resolved = resolveDynamicTags(raw);
      return { content: [{ type: "text", text: resolved }] };
    },
  );
}
