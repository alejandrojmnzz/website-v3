import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const REGISTRY_PATH = path.join(process.cwd(), "4geeks-com", "component-registry");

export interface ValidationIssue {
  type: "error" | "warning";
  message: string;
  file?: string;
}

export interface ValidationResult {
  componentType: string;
  version: string;
  issues: ValidationIssue[];
  validVariants: string[];
}

interface SchemaWithVariants {
  name?: string;
  version?: string;
  variants?: Record<string, { description?: string; best_for?: string }>;
  props?: Record<string, unknown>;
}

interface ExampleFile {
  name?: string;
  description?: string;
  yaml?: string;
  variant?: string; // Legacy field, now derived from yaml content
}

function extractVariantFromYaml(yamlContent: string): string | undefined {
  try {
    const parsed = yaml.load(yamlContent);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.variant) {
      return parsed[0].variant as string;
    }
    if (parsed && typeof parsed === 'object' && 'variant' in parsed) {
      return (parsed as { variant?: string }).variant;
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

function loadSchemaWithVariants(componentType: string, version: string): SchemaWithVariants | null {
  try {
    const schemaPath = path.join(REGISTRY_PATH, componentType, version, "schema.yml");
    if (!fs.existsSync(schemaPath)) {
      return null;
    }
    const content = fs.readFileSync(schemaPath, "utf8");
    return yaml.load(content) as SchemaWithVariants;
  } catch (error) {
    console.error(`Error loading schema for ${componentType}/${version}:`, error);
    return null;
  }
}

function loadExampleFiles(componentType: string, version: string): Array<{ fileName: string; data: ExampleFile }> {
  try {
    const examplesPath = path.join(REGISTRY_PATH, componentType, version, "examples");
    if (!fs.existsSync(examplesPath)) {
      return [];
    }
    const exampleFiles = fs.readdirSync(examplesPath)
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));
    
    return exampleFiles.map(fileName => {
      const filePath = path.join(examplesPath, fileName);
      const content = fs.readFileSync(filePath, "utf8");
      const data = yaml.load(content) as ExampleFile;
      return { fileName, data };
    });
  } catch (error) {
    console.error(`Error loading examples for ${componentType}/${version}:`, error);
    return [];
  }
}

function listVersions(componentType: string): string[] {
  try {
    const componentPath = path.join(REGISTRY_PATH, componentType);
    if (!fs.existsSync(componentPath)) {
      return [];
    }
    return fs.readdirSync(componentPath)
      .filter(dir => {
        const versionPath = path.join(componentPath, dir);
        return fs.statSync(versionPath).isDirectory() && dir.startsWith('v');
      })
      .sort((a, b) => {
        const aParts = a.replace('v', '').split('.').map(Number);
        const bParts = b.replace('v', '').split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aVal = aParts[i] || 0;
          const bVal = bParts[i] || 0;
          if (aVal !== bVal) return bVal - aVal;
        }
        return 0;
      });
  } catch (error) {
    return [];
  }
}

export function validateComponent(componentType: string, version?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  
  const versions = listVersions(componentType);
  if (versions.length === 0) {
    return {
      componentType,
      version: version || "unknown",
      issues: [{ type: "error", message: `Component "${componentType}" not found in registry` }],
      validVariants: [],
    };
  }
  
  const targetVersion = version || versions[0];
  if (!versions.includes(targetVersion)) {
    return {
      componentType,
      version: targetVersion,
      issues: [{ type: "error", message: `Version "${targetVersion}" not found for component "${componentType}"` }],
      validVariants: [],
    };
  }
  
  const schema = loadSchemaWithVariants(componentType, targetVersion);
  if (!schema) {
    return {
      componentType,
      version: targetVersion,
      issues: [{ type: "error", message: `Failed to load schema for ${componentType}/${targetVersion}` }],
      validVariants: [],
    };
  }
  
  const validVariants = schema.variants ? Object.keys(schema.variants) : [];
  
  if (validVariants.length === 0) {
    issues.push({
      type: "warning",
      message: `No variants defined in schema for ${componentType}/${targetVersion}`,
    });
  }
  
  const examples = loadExampleFiles(componentType, targetVersion);
  
  for (const { fileName, data } of examples) {
    const examplePath = `${componentType}/${targetVersion}/examples/${fileName}`;
    
    if (!data.name) {
      issues.push({
        type: "warning",
        message: `Example missing "name" field`,
        file: examplePath,
      });
    }
    
    if (!data.description) {
      issues.push({
        type: "warning",
        message: `Example missing "description" field`,
        file: examplePath,
      });
    }
    
    const inferredVariant = data.yaml ? extractVariantFromYaml(data.yaml) : undefined;
    const effectiveVariant = inferredVariant || data.variant;
    
    if (effectiveVariant) {
      if (validVariants.length > 0 && !validVariants.includes(effectiveVariant)) {
        issues.push({
          type: "error",
          message: `Invalid variant "${effectiveVariant}" in yaml content. Valid variants are: ${validVariants.join(", ")}`,
          file: examplePath,
        });
      }
    } else if (validVariants.length > 0) {
      issues.push({
        type: "warning",
        message: `No variant found in yaml content. Consider adding one of: ${validVariants.join(", ")}`,
        file: examplePath,
      });
    }
  }
  
  return {
    componentType,
    version: targetVersion,
    issues,
    validVariants,
  };
}

export function validateAllComponents(): Record<string, ValidationResult> {
  const results: Record<string, ValidationResult> = {};
  
  try {
    if (!fs.existsSync(REGISTRY_PATH)) {
      return results;
    }
    
    const components = fs.readdirSync(REGISTRY_PATH).filter(dir => {
      const dirPath = path.join(REGISTRY_PATH, dir);
      return fs.statSync(dirPath).isDirectory();
    });
    
    for (const componentType of components) {
      results[componentType] = validateComponent(componentType);
    }
  } catch (error) {
    console.error("Error validating all components:", error);
  }
  
  return results;
}
