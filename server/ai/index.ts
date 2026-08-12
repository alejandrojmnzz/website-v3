/**
 * AI Content Adaptation System
 * 
 * Provides AI-powered content adaptation using layered context:
 * 1. Brand context (global voice, tone, guidelines)
 * 2. Content context (page/program specific settings)
 * 3. Component context (target component schema and constraints)
 */

export { getContextManager, ContextManager } from "./ContextManager";
export { getLLMService, LLMService } from "./LLMService";
export { getContentAdapter, ContentAdapter } from "./ContentAdapter";
export { SYSTEM_PROMPT, buildAdaptationPrompt, buildContextBlock, buildTargetStructureBlock } from "./prompts";
export { componentToJsonSchema, getValidProperties, getRequiredProperties, validateContentAgainstSchema } from "./SchemaConverter";
export { generateJsonSchema } from "./generateJsonSchema";

export type {
  BrandContext,
  ContentContext,
  ComponentContext,
  FullContext,
  AdaptOptions,
  AdaptResult,
  ILLMClient,
  LLMOptions,
  ICache,
  IContextLoader,
} from "./types";

export type {
  GenerateJsonSchemaInput,
  GenerateJsonSchemaResult,
} from "./generateJsonSchema";
