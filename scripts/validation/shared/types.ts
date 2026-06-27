/**
 * Validation Framework Types
 * 
 * Core interfaces for the modular validation system.
 * Used by both CLI and API.
 */

export interface FixHint {
  type: "api" | "script" | "llm" | "manual";
  label: string;
  fixerName?: string;
  command?: string;
  promptTemplate?: string;
  url?: string;
}

export interface ValidationIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
  fix?: FixHint;
  category?: ValidatorMetadata["category"];
}

export interface ValidatorResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "warning";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  duration: number;
  category?: ValidatorMetadata["category"];
  artifacts?: Record<string, unknown>;
}

export interface ValidatorMetadata {
  name: string;
  description: string;
  apiExposed: boolean;
  estimatedDuration: "fast" | "medium" | "slow";
  category: "content" | "seo" | "integrity" | "components" | "performance" | "forms" | "bindings";
}

export interface Validator extends ValidatorMetadata {
  run(context: ValidationContext): Promise<ValidatorResult>;
}

export interface ContentMeta {
  page_title?: string;
  description?: string;
  robots?: string;
  og_image?: string;
  canonical_url?: string;
  priority?: number;
  change_frequency?: string;
  redirects?: string[];
}

export interface SchemaRef {
  include?: string[];
  overrides?: Record<string, Record<string, unknown>>;
}

export interface ContentSeo {
  intent?: string;
  pillar?: string;
  focus_features?: string[];
}

export interface ContentFile {
  slug: string;
  title: string;
  meta?: ContentMeta;
  schema?: SchemaRef;
  seo?: ContentSeo;
  type: string;
  locale: string;
  filePath: string;
  variant?: string;
  version?: number;
}

export interface RedirectEntry {
  from: string;
  to: string | Record<string, string>;
  source: ContentFile;
}

export interface SitemapEntry {
  loc: string;
  type: string;
  slug?: string;
  locale?: string;
}

export interface ValidationContext {
  contentFiles: ContentFile[];
  redirectMap: Map<string, RedirectEntry>;
  validUrls: Set<string>;
  availableSchemas: Set<string>;
  sitemapEntries: SitemapEntry[];
  sitemapXml?: string;
  /** Active site's content root (absolute path). Populated by the API route from
   *  res.locals.site when a per-site override is active (dev or multi-site prod).
   *  Validators that read content-folder files (e.g. custom-redirects.yml,
   *  schema-org.yml) must use this instead of hardcoded folder names. */
  contentRoot?: string;
}

export interface ValidationRunOptions {
  validators?: string[];
  mode?: "strict" | "fast";
  output?: "detailed" | "summary";
  includeArtifacts?: boolean;
  includeSlow?: boolean;
}

export interface ValidationRunResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    duration: number;
  };
  validators: ValidatorResult[];
}

export interface PageCacheEntry {
  lastRunAt: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationCacheFile {
  meta: {
    lastFullRunAt: string | null;
    version: number;
  };
  pages: Record<string, PageCacheEntry>;
}
