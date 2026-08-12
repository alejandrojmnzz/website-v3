import { compileJsonSchema, type JsonSchema } from "@shared/json-field";
import { getLLMService } from "./LLMService";

export interface GenerateJsonSchemaInput {
  fieldName: string;
  userPrompt: string;
  currentSchema?: string | null;
}

export interface GenerateJsonSchemaResult {
  schema: JsonSchema;
}

const SYSTEM_PROMPT = `You are a JSON Schema author for a CMS content editor.

Given a field name and a short description of what the field stores, produce a JSON Schema document that validates values for that field.

Rules:
- Return ONLY a JSON object (the schema). No markdown, no code fences, no commentary.
- Prefer a Draft-07-style subset using: type, properties, items, required, and nested objects/arrays.
- Supported types: object, array, string, number, integer, boolean, null (or type arrays of those).
- Use clear snake_case or camelCase property names that match the user's description.
- Mark obviously required keys in "required" when the description implies them.
- Keep schemas practical for content editors — not overly abstract.
- Do not use $ref, $defs, allOf, anyOf, oneOf, or format keywords unless essential; prefer simple type/properties/items/required.
- If a current schema is provided, treat the user prompt as a refinement and return a complete replacement schema.`;

function stripCodeFences(content: string): string {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return cleaned;
}

function parseAndCompile(content: string): JsonSchema {
  const cleaned = stripCodeFences(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `AI returned invalid JSON: ${err.message}`
        : "AI returned invalid JSON",
    );
  }
  const compiled = compileJsonSchema(parsed);
  if (!compiled.ok) {
    throw new Error(`AI returned invalid JSON Schema: ${compiled.error}`);
  }
  return compiled.schema;
}

function buildUserPrompt(input: GenerateJsonSchemaInput, compileError?: string): string {
  const parts = [
    `Field name: "${input.fieldName}"`,
    "",
    `What this field should store: ${input.userPrompt.trim()}`,
  ];
  if (input.currentSchema?.trim()) {
    parts.push("", "Current schema (refine/replace based on the request):", input.currentSchema.trim());
  }
  if (compileError) {
    parts.push(
      "",
      `Your previous output failed validation: ${compileError}`,
      "Return a corrected JSON Schema object only.",
    );
  }
  return parts.join("\n");
}

export async function generateJsonSchema(
  input: GenerateJsonSchemaInput,
): Promise<GenerateJsonSchemaResult> {
  const fieldName = input.fieldName?.trim();
  const userPrompt = input.userPrompt?.trim();
  if (!fieldName) {
    throw new Error("fieldName must be a non-empty string");
  }
  if (!userPrompt) {
    throw new Error("userPrompt must be a non-empty string");
  }

  const llm = getLLMService();

  const run = async (compileError?: string) => {
    const result = await llm.complete(buildUserPrompt(input, compileError), {
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.15,
      maxTokens: 1500,
    });
    return parseAndCompile(result);
  };

  try {
    const schema = await run();
    return { schema };
  } catch (firstErr) {
    const message =
      firstErr instanceof Error ? firstErr.message : "Failed to generate schema";
    // One retry when the model returned parseable-but-invalid schema or bad JSON.
    if (
      message.includes("AI returned invalid JSON") ||
      message.includes("AI returned invalid JSON Schema")
    ) {
      const schema = await run(message);
      return { schema };
    }
    throw firstErr;
  }
}
