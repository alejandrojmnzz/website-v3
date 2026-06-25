/**
 * Schema.org Registry Access
 * 
 * Loads and validates Schema.org definitions from schema-org.yml
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const SCHEMA_ORG_PATH = path.join(process.cwd(), "4geeks-com", "schema-org.yml");

export function getAvailableSchemaKeys(): Set<string> {
  const keys = new Set<string>();
  
  if (!fs.existsSync(SCHEMA_ORG_PATH)) {
    console.warn("Warning: schema-org.yml not found");
    return keys;
  }
  
  try {
    const content = fs.readFileSync(SCHEMA_ORG_PATH, "utf-8");
    const data = yaml.load(content) as Record<string, unknown>;
    
    for (const key of Object.keys(data)) {
      if (key === "courses" || key === "item_lists") {
        const nested = data[key] as Record<string, unknown>;
        for (const nestedKey of Object.keys(nested)) {
          keys.add(`${key}:${nestedKey}`);
        }
      } else {
        keys.add(key);
      }
    }
  } catch (err) {
    console.error("Failed to parse schema-org.yml:", err);
  }
  
  return keys;
}

export function validateSchemaReference(ref: string, availableKeys: Set<string>): boolean {
  return availableKeys.has(ref);
}
