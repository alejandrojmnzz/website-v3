/**
 * LLM Service - Factory pattern with retry/backoff for OpenAI calls
 * Reads provider config from 4geeks-com/llm.yml when available
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { ILLMClient, LLMOptions, StructuredOutputOptions } from "./types";
import { child } from "../logger";
const log = child({ module: "ai/LLMService" });



interface LLMYamlConfig {
  provider?: {
    api_key_env?: string;
    base_url_env?: string;
  };
  model?: string | { default: string; chat?: string; vision?: string };
  temperature?: number;
  max_tokens?: number;
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

let instance: LLMService | null = null;
let cachedConfigMtime: number | null = null;

function getDefaultLLMPath(): string {
  return path.resolve(`${process.env.CONTENT_FOLDER || "default-site-content"}/llm.yml`);
}

function loadYamlConfig(contentRoot?: string): LLMYamlConfig | null {
  try {
    const configPath = contentRoot ? path.join(contentRoot, "llm.yml") : getDefaultLLMPath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      return yaml.load(raw) as LLMYamlConfig;
    }
  } catch (err) {
    log.warn("Failed to load llm.yml config, using env var fallback:", err);
  }
  return null;
}

function getConfigMtime(contentRoot?: string): number | null {
  try {
    const configPath = contentRoot ? path.join(contentRoot, "llm.yml") : getDefaultLLMPath();
    if (fs.existsSync(configPath)) {
      return fs.statSync(configPath).mtimeMs;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveModel(cfg: LLMYamlConfig | null): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  if (cfg?.model && typeof cfg.model === "object") {
    return cfg.model.default || "gpt-4o";
  }
  return (cfg?.model as string | undefined) || "gpt-4o";
}

export function getLLMConfig(): LLMYamlConfig {
  const cfg = loadYamlConfig();
  return {
    provider: cfg?.provider || {},
    model: resolveModel(cfg),
    temperature: cfg?.temperature ?? 0.7,
    max_tokens: cfg?.max_tokens || 2000,
  };
}

export function reloadLLMConfig(): void {
  cachedConfigMtime = null;
  instance = null;
}

export class LLMService implements ILLMClient {
  private client: OpenAI;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  private constructor() {
    const cfg = loadYamlConfig();

    const apiKeyEnv = cfg?.provider?.api_key_env || "OPENAI_API_KEY";
    const baseUrlEnv = cfg?.provider?.base_url_env || "OPENAI_BASE_URL";

    const apiKey = process.env[apiKeyEnv] || process.env.OPENAI_API_KEY;
    const baseURL = process.env[baseUrlEnv] || process.env.OPENAI_BASE_URL;

    if (!apiKey) {
      throw new Error(
        `OpenAI not configured. Please set ${apiKeyEnv} in Secrets.`,
      );
    }

    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    this.defaultModel = resolveModel(cfg);
    this.defaultTemperature = cfg?.temperature ?? 0.7;
    this.defaultMaxTokens = cfg?.max_tokens || 2000;
  }

  static getInstance(): LLMService {
    const currentMtime = getConfigMtime();
    if (
      instance &&
      cachedConfigMtime !== null &&
      currentMtime !== cachedConfigMtime
    ) {
      log.info("[LLM] Config file changed, reinitializing...");
      instance = null;
    }
    if (!instance) {
      instance = new LLMService();
      cachedConfigMtime = currentMtime;
    }
    return instance;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? this.defaultTemperature;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;

    let lastError: Error | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (options?.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push({ role: "user", content: prompt });

        const response = await this.client.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        return content.trim();
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || "";

        if (
          errorMessage.includes("rate_limit") ||
          errorMessage.includes("429") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("network") ||
          errorMessage.includes("ECONNRESET")
        ) {
          log.warn(
            `LLM error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
          );
          await this.sleep(backoffMs);
          backoffMs *= 2;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Failed after max retries");
  }

  async completeWithVision(
    textPrompt: string,
    imageUrls: string[],
    options?: LLMOptions,
  ): Promise<string> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? this.defaultTemperature;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;

    let lastError: Error | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (options?.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }

        const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
          { type: "text", text: textPrompt },
        ];
        for (const url of imageUrls) {
          contentParts.push({
            type: "image_url",
            image_url: { url },
          });
        }
        messages.push({ role: "user", content: contentParts });

        const response = await this.client.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        return content.trim();
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || "";

        if (
          errorMessage.includes("rate_limit") ||
          errorMessage.includes("429") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("network") ||
          errorMessage.includes("ECONNRESET")
        ) {
          log.warn(
            `LLM vision error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
          );
          await this.sleep(backoffMs);
          backoffMs *= 2;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Failed after max retries");
  }

  async adaptContent(
    systemPrompt: string,
    userPrompt: string,
    options?: Omit<LLMOptions, "systemPrompt">,
  ): Promise<{
    content: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? 0.5;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;

    let lastError: Error | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        return {
          content: content.trim(),
          usage: response.usage
            ? {
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || "";

        if (
          errorMessage.includes("rate_limit") ||
          errorMessage.includes("429") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("network")
        ) {
          log.warn(
            `LLM error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
          );
          await this.sleep(backoffMs);
          backoffMs *= 2;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Failed after max retries");
  }

  async adaptContentStructured(
    systemPrompt: string,
    userPrompt: string,
    options: StructuredOutputOptions,
  ): Promise<{
    content: Record<string, unknown>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? 0.5;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;

    let lastError: Error | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: options.schemaName || "component_content",
              strict: true,
              schema: options.jsonSchema,
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        const parsed = JSON.parse(content);

        return {
          content: parsed,
          usage: response.usage
            ? {
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || "";

        if (
          errorMessage.includes("rate_limit") ||
          errorMessage.includes("429") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("network")
        ) {
          log.warn(
            `LLM error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
          );
          await this.sleep(backoffMs);
          backoffMs *= 2;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Failed after max retries");
  }
}

export function getLLMService(): LLMService {
  return LLMService.getInstance();
}
