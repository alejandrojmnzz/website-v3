#!/usr/bin/env npx tsx
/**
 * Schema Sync Script
 * Parses Zod schemas from component registry schema.ts files
 * and generates/updates adjacent schema.yml files while preserving documentation
 * 
 * Usage:
 *   npx tsx scripts/schema-sync/sync-schemas.ts [--dry-run] [--component=hero]
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { z, ZodObject, ZodType, ZodOptional, ZodArray, ZodEnum, ZodLiteral, ZodUnion, ZodString, ZodNumber, ZodBoolean, ZodRecord, ZodTuple, ZodEffects } from "zod";

const REGISTRY_PATH = path.join(process.cwd(), "4geeks-com/component-registry");

interface PropDef {
  type: string;
  required?: boolean;
  description?: string;
  example?: string | string[];
  default?: unknown;
  options?: string[];
  items?: Record<string, PropDef>;
  properties?: Record<string, PropDef>;
}

interface SchemaYml {
  name?: string;
  version?: string;
  component?: string;
  file?: string;
  description?: string;
  when_to_use?: string;
  schema_org?: { handler?: string; description?: string };
  variants?: Record<string, { description?: string; best_for?: string }>;
  props?: Record<string, PropDef>;
  variant_props?: Record<string, Record<string, PropDef>>;
}

/**
 * Unwrap ZodEffects (from .refine(), .transform(), etc) to get inner schema
 */
function unwrapEffects(schema: ZodType): ZodType {
  if (schema instanceof ZodEffects) {
    return unwrapEffects(schema._def.schema);
  }
  return schema;
}

/**
 * Extract type information from a Zod schema
 */
function zodToType(schema: ZodType): { type: string; optional: boolean; items?: Record<string, PropDef>; properties?: Record<string, PropDef>; options?: string[] } {
  // Handle ZodEffects wrapper (from .refine(), .transform())
  if (schema instanceof ZodEffects) {
    return zodToType(schema._def.schema);
  }

  // Handle optional wrapper
  if (schema instanceof ZodOptional) {
    const inner = zodToType(schema._def.innerType);
    return { ...inner, optional: true };
  }

  // String
  if (schema instanceof ZodString) {
    return { type: "string", optional: false };
  }

  // Number
  if (schema instanceof ZodNumber) {
    return { type: "number", optional: false };
  }

  // Boolean
  if (schema instanceof ZodBoolean) {
    return { type: "boolean", optional: false };
  }

  // Literal (string)
  if (schema instanceof ZodLiteral) {
    return { type: "string", optional: false };
  }

  // Enum
  if (schema instanceof ZodEnum) {
    return { type: "string", optional: false, options: schema._def.values };
  }

  // Array
  if (schema instanceof ZodArray) {
    const itemType = zodToType(schema._def.type);
    if (itemType.type === "object" && itemType.properties) {
      return { type: "array", optional: false, items: itemType.properties };
    }
    // For scalar arrays (string[], number[], etc), use a simple item type descriptor
    return { 
      type: "array", 
      optional: false, 
      items: { 
        type: { 
          type: itemType.type, 
          required: true,
          ...(itemType.options && { options: itemType.options })
        } 
      } 
    };
  }

  // Object
  if (schema instanceof ZodObject) {
    const shape = schema._def.shape();
    const properties: Record<string, PropDef> = {};
    
    for (const [key, value] of Object.entries(shape)) {
      const propInfo = zodToType(value as ZodType);
      properties[key] = {
        type: propInfo.type,
        required: !propInfo.optional,
        ...(propInfo.options && { options: propInfo.options }),
        ...(propInfo.properties && { properties: propInfo.properties }),
        ...(propInfo.items && { items: propInfo.items }),
      };
    }
    
    return { type: "object", optional: false, properties };
  }

  // Union (for variant discrimination)
  if (schema instanceof ZodUnion) {
    // Check if it's a string union (enum-like)
    const options = schema._def.options;
    if (options.every((o: ZodType) => o instanceof ZodLiteral)) {
      return { 
        type: "string", 
        optional: false, 
        options: options.map((o: ZodLiteral<string>) => o._def.value) 
      };
    }
    // Mixed union - default to string
    return { type: "string", optional: false };
  }

  // Record
  if (schema instanceof ZodRecord) {
    return { type: "object", optional: false };
  }

  // Tuple (treat as array)
  if (schema instanceof ZodTuple) {
    return { type: "array", optional: false };
  }

  // Default fallback
  return { type: "string", optional: false };
}

/**
 * Extract props from a Zod object schema
 */
function extractProps(schema: ZodObject<Record<string, ZodType>>): Record<string, PropDef> {
  const shape = schema._def.shape();
  const props: Record<string, PropDef> = {};

  for (const [key, value] of Object.entries(shape)) {
    // Skip type and version fields (handled separately)
    if (key === "type" || key === "version") continue;

    const propInfo = zodToType(value as ZodType);
    props[key] = {
      type: propInfo.type,
      required: !propInfo.optional,
      ...(propInfo.options && { options: propInfo.options }),
      ...(propInfo.properties && { properties: propInfo.properties }),
      ...(propInfo.items && { items: propInfo.items }),
    };
  }

  return props;
}

/**
 * Merge new props with existing, preserving descriptions and examples
 */
function mergeProps(
  newProps: Record<string, PropDef>,
  existingProps?: Record<string, PropDef>
): Record<string, PropDef> {
  if (!existingProps) return newProps;

  const merged: Record<string, PropDef> = {};

  for (const [key, newProp] of Object.entries(newProps)) {
    const existing = existingProps[key];
    merged[key] = {
      ...newProp,
      // Preserve documentation from existing
      ...(existing?.description && { description: existing.description }),
      ...(existing?.example && { example: existing.example }),
      // Recursively merge nested properties
      ...(newProp.properties && existing?.properties && {
        properties: mergeProps(newProp.properties, existing.properties)
      }),
      ...(newProp.items && existing?.items && {
        items: mergeProps(newProp.items, existing.items)
      }),
    };
  }

  return merged;
}

/**
 * Load existing schema.yml if it exists
 */
function loadExistingSchema(schemaPath: string): SchemaYml | null {
  if (!fs.existsSync(schemaPath)) return null;
  
  try {
    const content = fs.readFileSync(schemaPath, "utf-8");
    return yaml.load(content) as SchemaYml;
  } catch (error) {
    console.warn(`  Warning: Could not parse existing ${schemaPath}`);
    return null;
  }
}

/**
 * Process a single component directory
 */
async function processComponent(componentPath: string, dryRun: boolean): Promise<boolean> {
  const schemaTs = path.join(componentPath, "schema.ts");
  const schemaYml = path.join(componentPath, "schema.yml");
  const componentName = path.basename(path.dirname(componentPath));
  const version = path.basename(componentPath);

  if (!fs.existsSync(schemaTs)) {
    return false;
  }

  console.log(`\nProcessing ${componentName}/${version}...`);

  try {
    // Dynamically import the schema module
    const modulePath = path.resolve(schemaTs);
    const module = await import(modulePath);

    // Find the main section schema (ends with SectionSchema or Schema)
    let mainSchema: ZodObject<Record<string, ZodType>> | null = null;
    let variantSchemas: Record<string, ZodObject<Record<string, ZodType>>> = {};

    for (const [exportName, exportValue] of Object.entries(module)) {
      // Unwrap ZodEffects to get the underlying schema
      const unwrapped = unwrapEffects(exportValue as ZodType);
      
      if (!(unwrapped instanceof ZodObject) && !(unwrapped instanceof ZodUnion)) continue;

      // Check if it's a union schema (has variants)
      if (unwrapped instanceof ZodUnion) {
        const options = unwrapped._def.options;
        for (const opt of options) {
          const unwrappedOpt = unwrapEffects(opt);
          if (unwrappedOpt instanceof ZodObject) {
            const shape = unwrappedOpt._def.shape();
            if (shape.variant instanceof ZodLiteral) {
              const variantName = shape.variant._def.value;
              variantSchemas[variantName] = unwrappedOpt;
            }
          }
        }
        continue;
      }

      // Check if it's the main section schema (ends with SectionSchema)
      if (exportName.endsWith("SectionSchema")) {
        mainSchema = unwrapped as ZodObject<Record<string, ZodType>>;
      }
    }

    if (!mainSchema && Object.keys(variantSchemas).length === 0) {
      console.log(`  Skipping: No section schema found`);
      return false;
    }

    // Load existing schema.yml
    const existing = loadExistingSchema(schemaYml);

    // Build new schema
    const newSchema: SchemaYml = {
      name: existing?.name || `${componentName.charAt(0).toUpperCase() + componentName.slice(1).replace(/_/g, " ")} Section`,
      version: existing?.version || version.replace("v", ""),
      component: existing?.component || componentName.charAt(0).toUpperCase() + componentName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      file: existing?.file || `client/src/components/${componentName}/${componentName.charAt(0).toUpperCase() + componentName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}.tsx`,
      description: existing?.description || "",
      when_to_use: existing?.when_to_use || "",
      // Advisory SSR schema.org metadata is hand-authored; always preserve it.
      ...(existing?.schema_org ? { schema_org: existing.schema_org } : {}),
    };

    // Handle variants
    if (Object.keys(variantSchemas).length > 0) {
      newSchema.variants = existing?.variants || {};
      newSchema.variant_props = {};

      // Common props (from first variant, excluding variant-specific)
      const firstVariant = Object.values(variantSchemas)[0];
      const commonProps = extractProps(firstVariant);
      
      // Find truly common props (exist in all variants with same type)
      const allVariantProps = Object.values(variantSchemas).map(v => extractProps(v));
      const commonKeys = Object.keys(commonProps).filter(key => {
        if (key === "variant") return false;
        return allVariantProps.every(vp => vp[key]?.type === commonProps[key]?.type);
      });

      newSchema.props = mergeProps(
        Object.fromEntries(commonKeys.map(k => [k, commonProps[k]])),
        existing?.props
      );

      // Variant-specific props
      for (const [variantName, variantSchema] of Object.entries(variantSchemas)) {
        const variantProps = extractProps(variantSchema);
        const specificProps = Object.fromEntries(
          Object.entries(variantProps).filter(([k]) => !commonKeys.includes(k) && k !== "variant")
        );

        newSchema.variant_props[variantName] = mergeProps(
          specificProps,
          existing?.variant_props?.[variantName]
        );

        // Preserve variant metadata
        if (!newSchema.variants![variantName]) {
          newSchema.variants![variantName] = {};
        }
        if (existing?.variants?.[variantName]) {
          newSchema.variants![variantName] = existing.variants[variantName];
        }
      }
    } else if (mainSchema) {
      newSchema.props = mergeProps(extractProps(mainSchema), existing?.props);
    }

    // Generate YAML
    const yamlContent = yaml.dump(newSchema, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
      quotingType: '"',
    });

    if (dryRun) {
      console.log(`  Would update ${schemaYml}`);
      console.log("  Preview (first 50 lines):");
      console.log(yamlContent.split("\n").slice(0, 50).map(l => "    " + l).join("\n"));
    } else {
      fs.writeFileSync(schemaYml, yamlContent);
      console.log(`  Updated ${schemaYml}`);
    }

    return true;
  } catch (error) {
    console.error(`  Error processing ${componentPath}:`, error);
    return false;
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const componentFilter = args.find(a => a.startsWith("--component="))?.split("=")[1];

  console.log("Schema Sync Tool");
  console.log("================");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "UPDATE"}`);
  if (componentFilter) console.log(`Filter: ${componentFilter}`);

  // Find all component directories
  const components = fs.readdirSync(REGISTRY_PATH, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== "common")
    .filter(d => !componentFilter || d.name === componentFilter);

  let processed = 0;
  let updated = 0;

  for (const component of components) {
    const componentDir = path.join(REGISTRY_PATH, component.name);
    const versions = fs.readdirSync(componentDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith("v"));

    for (const version of versions) {
      const versionDir = path.join(componentDir, version.name);
      processed++;
      if (await processComponent(versionDir, dryRun)) {
        updated++;
      }
    }
  }

  console.log(`\nDone! Processed ${processed} components, updated ${updated}`);
}

main().catch(console.error);
