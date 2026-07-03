/**
 * Validation Service
 * 
 * Core service that runs validators. Used by both CLI and API.
 * Handles context building, validator execution, and result aggregation.
 */

import type {
  ValidationContext,
  ValidationRunOptions,
  ValidationRunResult,
  ValidatorResult,
  SitemapEntry,
} from "./shared/types";
import { loadAllContent } from "./shared/contentLoader";
import { contentIndex as defaultContentIndex } from "../../server/content-index";
import { buildValidUrlSet } from "./shared/canonicalUrls";
import { getAvailableSchemaKeys } from "./shared/schemaRegistry";
import { validators, allValidators, getValidator, listValidators, ensureValidatorRegistered } from "./validators";
import { databaseHealthValidator } from "./validators/database-health";
import { getSitemap } from "../../server/sitemap";

export class ValidationService {
  private context: ValidationContext | null = null;

  async buildContext(options: {
    contentRoot?: string;
    ci?: typeof defaultContentIndex;
    scope?: { database?: string };
  } = {}): Promise<ValidationContext> {
    const contentFiles = loadAllContent(options.ci);
    const validUrls = buildValidUrlSet(contentFiles);
    const availableSchemas = getAvailableSchemaKeys();

    const sitemapEntries: SitemapEntry[] = [];

    let sitemapXml: string | undefined;
    try {
      sitemapXml = getSitemap();
    } catch {
      sitemapXml = undefined;
    }

    this.context = {
      contentFiles,
      redirectMap: new Map(),
      validUrls,
      availableSchemas,
      sitemapEntries,
      sitemapXml,
      contentRoot: options.contentRoot,
      scope: options.scope,
    };

    return this.context;
  }

  async loadSitemapEntries(): Promise<SitemapEntry[]> {
    return [];
  }

  async runValidators(options: ValidationRunOptions = {}): Promise<ValidationRunResult> {
    const startTime = Date.now();

    ensureValidatorRegistered(databaseHealthValidator);
    
    if (!this.context) {
      await this.buildContext({ scope: options.scope });
    } else if (options.scope) {
      this.context.scope = options.scope;
    }

    const pool = options.includeSlow ? allValidators : validators;
    const validatorNames = options.validators || pool.map((v) => v.name);
    const results: ValidatorResult[] = [];

    for (const name of validatorNames) {
      const validator = getValidator(name);
      if (!validator) {
        results.push({
          name,
          description: "Unknown validator",
          status: "failed",
          errors: [{
            type: "error",
            code: "UNKNOWN_VALIDATOR",
            message: `Validator "${name}" not found`,
          }],
          warnings: [],
          duration: 0,
        });
        continue;
      }

      try {
        const result = await validator.run(this.context!);
        
        if (!options.includeArtifacts) {
          delete result.artifacts;
        }

        result.category = validator.category;
        results.push(result);
      } catch (err) {
        results.push({
          name: validator.name,
          description: validator.description,
          status: "failed",
          category: validator.category,
          errors: [{
            type: "error",
            code: "VALIDATOR_ERROR",
            message: `Validator threw an error: ${err}`,
          }],
          warnings: [],
          duration: 0,
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const passed = results.filter((r) => r.status === "passed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const withWarnings = results.filter((r) => r.status === "warning").length;

    return {
      summary: {
        total: results.length,
        passed,
        failed,
        warnings: withWarnings,
        duration: totalDuration,
      },
      validators: results,
    };
  }

  async runSingleValidator(name: string, includeArtifacts = false): Promise<ValidatorResult> {
    const result = await this.runValidators({
      validators: [name],
      includeArtifacts,
    });
    return result.validators[0];
  }

  getAvailableValidators() {
    ensureValidatorRegistered(databaseHealthValidator);
    return listValidators();
  }

  getContext(): ValidationContext | null {
    return this.context;
  }

  clearContext(): void {
    this.context = null;
  }
}

let instance: ValidationService | null = null;

export function getValidationService(): ValidationService {
  if (!instance) {
    instance = new ValidationService();
  }
  return instance;
}
