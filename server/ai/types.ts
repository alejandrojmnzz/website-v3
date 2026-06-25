/**
 * Type definitions for AI Content Adaptation System
 */

// Brand context from 4geeks-com/brand-context.yml
export interface BrandContext {
  brand: {
    name: string;
    tagline: string;
    mission: string;
  };
  voice: {
    tone: string;
    style: string;
    personality: string;
  };
  guidelines: string[];
  key_differentiators: string[];
  target_audience: {
    primary: {
      description: string;
      age_range: string;
      motivations: string[];
      concerns: string[];
    };
    secondary: {
      description: string;
      age_range: string;
      motivations: string[];
    };
  };
  messaging_priorities: Array<{
    name: string;
    weight: number;
    examples: string[];
  }>;
  forbidden_phrases: string[];
  required_disclaimers: Record<string, string>;
  content_patterns: Record<string, {
    max_length?: number;
    structure?: string;
    examples?: string[];
  }>;
}

// Content-level context from _common.yml
export interface ContentContext {
  slug: string;
  title?: string;
  type: string;
  context?: {
    when_to_use?: string;
    target_audience?: string;
    goals?: string[];
  };
}

// Component property definition
export interface PropDefinition {
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  properties?: Record<string, PropDefinition>;
  items?: Record<string, PropDefinition>;
}

// Component-level context from component registry schema.yml
export interface ComponentContext {
  name: string;
  version: string;
  description?: string;
  when_to_use?: string;
  variants?: Record<string, {
    description?: string;
    when_to_use?: string;
    best_for?: string;
  }>;
  props: Record<string, PropDefinition>;
  variant_props?: Record<string, Record<string, PropDefinition>>;
}

// Full layered context for AI adaptation
export interface FullContext {
  brand: BrandContext;
  content: ContentContext;
  component: ComponentContext;
  targetVariant?: string;
  userOverrides?: {
    tone?: string;
    targetAudience?: string;
    additionalGuidelines?: string[];
  };
}

// Options for content adaptation
export interface AdaptOptions {
  contentType: string;
  contentSlug: string;
  targetComponent: string;
  targetVersion: string;
  targetVariant?: string;
  sourceYaml: string;
  targetExampleYaml?: string; // Example YAML from component registry to use as reference
  targetStructure?: Record<string, unknown>;
  userOverrides?: FullContext["userOverrides"];
}

// Adaptation result
export interface AdaptResult {
  adaptedYaml: string;
  context: {
    brand: string;
    content: string;
    component: string;
  };
  model: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

// LLM client interface
export interface ILLMClient {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

// Structured output options
export interface StructuredOutputOptions extends Omit<LLMOptions, "systemPrompt"> {
  jsonSchema: Record<string, unknown>;
  schemaName?: string;
}

// Cache interface with mtime tracking
export interface ICache<T> {
  get(key: string): { value: T; mtime: number } | null;
  set(key: string, value: T, mtime: number): void;
  invalidate(key: string): void;
  invalidateAll(): void;
}

// Context loader interface
export interface IContextLoader {
  getBrandContext(): Promise<BrandContext>;
  getContentContext(type: string, slug: string): Promise<ContentContext>;
  getComponentContext(name: string, version: string): Promise<ComponentContext>;
}
