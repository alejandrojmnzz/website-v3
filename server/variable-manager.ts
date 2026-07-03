import * as fs from "fs";
import { getDefaultContentFolder } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  parseTemplateTokens,
  resolveTokens,
  type ResolvedToken,
} from "./template-parser";
import { markFileAsModified } from "./sync-state";
import { child } from "./logger";
const log = child({ module: "variable-manager" });



const VARIABLES_PATH = path.join(
  process.cwd(),
  getDefaultContentFolder(),
  "variables.yml",
);

export interface VariableCondition {
  query: Record<string, string>;
  value: string;
}

export interface VariableDefinition {
  default?: string;
  conditions?: VariableCondition[];
  by_locale?: Record<string, string>;
  by_region?: Record<string, string>;
  by_location?: Record<string, string>;
  isReserved?: boolean;
}

export interface VariableContext {
  location?: string;
  region?: string;
  locale?: string;
}

export interface ResolveResult {
  data: unknown;
  variableMap: VariableMapEntry[];
}

export interface VariableMapEntry {
  path: string;
  variableName: string;
  resolvedValue: string;
  source: ResolvedToken["source"];
  defaultValue: string;
}

class VariableManager {
  private static instance: VariableManager;
  private variables: Record<string, VariableDefinition> = {};
  private lastModified: number = 0;
  private initialized = false;

  static getInstance(): VariableManager {
    if (!VariableManager.instance) {
      VariableManager.instance = new VariableManager();
    }
    return VariableManager.instance;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.load();
    } else {
      this.reloadIfChanged();
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(VARIABLES_PATH)) {
        log.warn("[VariableManager] variables.yml not found");
        this.variables = {};
        this.initialized = true;
        return;
      }

      const stat = fs.statSync(VARIABLES_PATH);
      const raw = fs.readFileSync(VARIABLES_PATH, "utf-8");
      const parsed = yaml.load(raw) as Record<string, VariableDefinition> | null;
      this.variables = parsed || {};
      this.lastModified = stat.mtimeMs;
      this.initialized = true;

      this.aliasReservedIntoGlobal();

      const count = Object.keys(this.variables).length;
      log.info(`[VariableManager] Loaded ${count} variable definitions`);

      this.autoMigrate();
    } catch (err) {
      log.error({ err: err }, "[VariableManager] Failed to load variables.yml:");
      this.variables = {};
      this.initialized = true;
    }
  }

  private aliasReservedIntoGlobal(): void {
    for (const [key, def] of Object.entries(this.variables)) {
      if (!key.startsWith("reserved.")) continue;
      const suffix = key.slice("reserved.".length);
      const globalKey = `global.${suffix}`;
      // Mark the reserved entry itself
      this.variables[key] = { ...def, isReserved: true };
      // Alias into global namespace (reserved value takes precedence)
      this.variables[globalKey] = { ...def, isReserved: true };
    }
  }

  private autoMigrate(): void {
    const needsMigration = Object.values(this.variables).some(
      (def) => def.by_location || def.by_region || def.by_locale,
    );
    if (needsMigration) {
      log.info("[VariableManager] Legacy by_* fields detected, auto-migrating to conditions...");
      this.migrateToConditions();
    }
  }

  migrateToConditions(): void {
    for (const [name, def] of Object.entries(this.variables)) {
      if (!def.by_location && !def.by_region && !def.by_locale) continue;

      const conditions: VariableCondition[] = def.conditions || [];

      if (def.by_location) {
        for (const [loc, val] of Object.entries(def.by_location)) {
          conditions.push({ query: { location: loc }, value: val });
        }
        delete def.by_location;
      }

      if (def.by_region) {
        for (const [reg, val] of Object.entries(def.by_region)) {
          conditions.push({ query: { region: reg }, value: val });
        }
        delete def.by_region;
      }

      if (def.by_locale) {
        for (const [loc, val] of Object.entries(def.by_locale)) {
          conditions.push({ query: { locale: loc }, value: val });
        }
        delete def.by_locale;
      }

      def.conditions = conditions;
      this.variables[name] = def;
    }

    this.save();
    log.info("[VariableManager] Migration to conditions format complete");
  }

  private reloadIfChanged(): void {
    try {
      if (!fs.existsSync(VARIABLES_PATH)) return;
      const stat = fs.statSync(VARIABLES_PATH);
      if (stat.mtimeMs > this.lastModified) {
        log.info("[VariableManager] variables.yml changed, reloading...");
        this.load();
      }
    } catch {
      // ignore
    }
  }

  resolveVariable(
    name: string,
    context: VariableContext,
  ): { value: string; source: ResolvedToken["source"] } | null {
    this.ensureInitialized();

    const def = this.variables[name];
    if (!def) return null;

    if (def.conditions && def.conditions.length > 0) {
      for (const condition of def.conditions) {
        const matches = Object.entries(condition.query).every(([key, val]) => {
          const contextVal = (context as Record<string, string | undefined>)[key];
          return contextVal === val;
        });
        if (matches) {
          return { value: condition.value, source: "condition" };
        }
      }
    }

    if (context.location && def.by_location?.[context.location]) {
      return { value: def.by_location[context.location], source: "location" };
    }

    if (context.region && def.by_region?.[context.region]) {
      return { value: def.by_region[context.region], source: "region" };
    }

    if (context.locale && def.by_locale?.[context.locale]) {
      return { value: def.by_locale[context.locale], source: "locale" };
    }

    if (def.default !== undefined) {
      return { value: def.default, source: "default" };
    }

    return null;
  }

  resolveString(text: string, context: VariableContext): {
    text: string;
    resolvedTokens: ResolvedToken[];
  } {
    const tokens = parseTemplateTokens(text);
    if (tokens.length === 0) return { text, resolvedTokens: [] };

    return resolveTokens(text, tokens, (expression) =>
      this.resolveVariable(expression, context),
    );
  }

  resolveDeep(
    data: unknown,
    context: VariableContext,
    currentPath: string = "",
  ): ResolveResult {
    const variableMap: VariableMapEntry[] = [];

    const resolved = this.resolveValue(data, context, currentPath, variableMap);

    return { data: resolved, variableMap };
  }

  private resolveValue(
    value: unknown,
    context: VariableContext,
    currentPath: string,
    variableMap: VariableMapEntry[],
  ): unknown {
    if (typeof value === "string") {
      const { text, resolvedTokens } = this.resolveString(value, context);
      for (const token of resolvedTokens) {
        variableMap.push({
          path: currentPath,
          variableName: token.expression,
          resolvedValue: token.resolvedValue,
          source: token.source,
          defaultValue: token.defaultValue,
        });
      }
      return text;
    }

    if (Array.isArray(value)) {
      return value.map((item, i) =>
        this.resolveValue(item, context, `${currentPath}[${i}]`, variableMap),
      );
    }

    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const childPath = currentPath ? `${currentPath}.${key}` : key;
        result[key] = this.resolveValue(val, context, childPath, variableMap);
      }
      return result;
    }

    return value;
  }

  getDefinitions(): Record<string, VariableDefinition> {
    this.ensureInitialized();
    return { ...this.variables };
  }

  getDefinition(name: string): VariableDefinition | null {
    this.ensureInitialized();
    return this.variables[name] || null;
  }

  updateDefault(name: string, value: string): void {
    this.ensureInitialized();
    if (!this.variables[name]) {
      this.variables[name] = {};
    }
    this.variables[name].default = value;
    this.save();
  }

  addCondition(name: string, condition: VariableCondition): void {
    this.ensureInitialized();
    if (!this.variables[name]) {
      this.variables[name] = {};
    }
    if (!this.variables[name].conditions) {
      this.variables[name].conditions = [];
    }
    this.variables[name].conditions!.push(condition);
    this.save();
  }

  updateCondition(name: string, index: number, condition: VariableCondition): void {
    this.ensureInitialized();
    const def = this.variables[name];
    if (!def || !def.conditions || index < 0 || index >= def.conditions.length) {
      throw new Error(`Invalid condition index ${index} for variable ${name}`);
    }
    def.conditions[index] = condition;
    this.save();
  }

  deleteCondition(name: string, index: number): void {
    this.ensureInitialized();
    const def = this.variables[name];
    if (!def || !def.conditions || index < 0 || index >= def.conditions.length) {
      throw new Error(`Invalid condition index ${index} for variable ${name}`);
    }
    def.conditions.splice(index, 1);
    if (def.conditions.length === 0) {
      delete def.conditions;
    }
    this.save();
  }

  reorderConditions(name: string, fromIndex: number, toIndex: number): void {
    this.ensureInitialized();
    const def = this.variables[name];
    if (!def || !def.conditions) {
      throw new Error(`Variable ${name} has no conditions`);
    }
    if (fromIndex < 0 || fromIndex >= def.conditions.length || toIndex < 0 || toIndex >= def.conditions.length) {
      throw new Error(`Invalid indices for reorder: from=${fromIndex}, to=${toIndex}`);
    }
    const [item] = def.conditions.splice(fromIndex, 1);
    def.conditions.splice(toIndex, 0, item);
    this.save();
  }

  updateVariable(
    name: string,
    level: string,
    key: string | undefined,
    value: string,
  ): void {
    this.ensureInitialized();

    if (!this.variables[name]) {
      this.variables[name] = {};
    }

    const def = this.variables[name];

    if (level === "default") {
      def.default = value;
    } else {
      const queryKey = level === "by_location" ? "location" : level === "by_region" ? "region" : "locale";
      if (key) {
        if (!def.conditions) {
          def.conditions = [];
        }
        const existingIdx = def.conditions.findIndex(
          (c) => Object.keys(c.query).length === 1 && c.query[queryKey] === key,
        );
        if (existingIdx >= 0) {
          def.conditions[existingIdx].value = value;
        } else {
          def.conditions.push({ query: { [queryKey]: key }, value });
        }
      }
    }

    this.save();
  }

  deleteVariableEntry(
    name: string,
    level: string,
    key: string | undefined,
  ): boolean {
    this.ensureInitialized();

    const def = this.variables[name];
    if (!def) return false;

    if (level === "default") {
      delete def.default;
    } else {
      const queryKey = level === "by_location" ? "location" : level === "by_region" ? "region" : "locale";
      if (key && def.conditions) {
        const idx = def.conditions.findIndex(
          (c) => Object.keys(c.query).length === 1 && c.query[queryKey] === key,
        );
        if (idx >= 0) {
          def.conditions.splice(idx, 1);
          if (def.conditions.length === 0) {
            delete def.conditions;
          }
        }
      }
    }

    this.save();
    return true;
  }

  renameVariable(oldName: string, newName: string): void {
    this.ensureInitialized();
    if (!this.variables[oldName]) {
      throw new Error(`Variable "${oldName}" does not exist`);
    }
    if (this.variables[newName]) {
      throw new Error(`Variable "${newName}" already exists`);
    }
    this.variables[newName] = this.variables[oldName];
    delete this.variables[oldName];
    this.save();
  }

  getLegalSettings(): { legal_terms_url: string; legal_privacy_url: string } {
    this.ensureInitialized();
    return {
      legal_terms_url: this.variables["reserved.legal_terms_url"]?.default ?? "",
      legal_privacy_url: this.variables["reserved.legal_privacy_url"]?.default ?? "",
    };
  }

  getConsentSettings(): Record<string, string> {
    this.ensureInitialized();
    return {
      consent_whatsapp: this.variables["reserved.consent_whatsapp"]?.default ?? "",
      consent_sms: this.variables["reserved.consent_sms"]?.default ?? "",
      consent_email: this.variables["reserved.consent_email"]?.default ?? "",
      consent_general: this.variables["reserved.consent_general"]?.default ?? "",
    };
  }

  updateConsentSetting(key: "consent_whatsapp" | "consent_sms" | "consent_email" | "consent_general", value: string): void {
    this.ensureInitialized();
    const reservedKey = `reserved.${key}`;
    const globalKey = `global.${key}`;
    if (!this.variables[reservedKey]) {
      this.variables[reservedKey] = {};
    }
    this.variables[reservedKey].default = value;
    this.variables[reservedKey].isReserved = true;
    if (!this.variables[globalKey]) {
      this.variables[globalKey] = {};
    }
    this.variables[globalKey].default = value;
    this.variables[globalKey].isReserved = true;
    this.save();
  }

  updateLegalSetting(key: "legal_terms_url" | "legal_privacy_url", value: string): void {
    this.ensureInitialized();
    const reservedKey = `reserved.${key}`;
    const globalKey = `global.${key}`;
    if (!this.variables[reservedKey]) {
      this.variables[reservedKey] = {};
    }
    this.variables[reservedKey].default = value;
    this.variables[reservedKey].isReserved = true;
    // Keep global alias in sync (in-memory only; file only has reserved.* keys)
    if (!this.variables[globalKey]) {
      this.variables[globalKey] = {};
    }
    this.variables[globalKey].default = value;
    this.variables[globalKey].isReserved = true;
    this.save();
  }

  private save(): void {
    try {
      // Only persist non-aliased entries (no global.* that came from reserved.*)
      const toSave: Record<string, VariableDefinition> = {};
      for (const [key, def] of Object.entries(this.variables)) {
        if (key.startsWith("global.") && this.variables[`reserved.${key.slice("global.".length)}`]) {
          // Skip — this is an aliased entry, the source is the reserved.* key
          continue;
        }
        const { isReserved: _skip, ...rest } = def;
        toSave[key] = rest;
      }
      const content = yaml.dump(toSave, {
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: true,
      });
      fs.writeFileSync(VARIABLES_PATH, content, "utf-8");
      const stat = fs.statSync(VARIABLES_PATH);
      this.lastModified = stat.mtimeMs;
      markFileAsModified(`${getDefaultContentFolder()}/variables.yml`);
      log.info("[VariableManager] Saved variables.yml");
    } catch (err) {
      log.error({ err: err }, "[VariableManager] Failed to save variables.yml:");
      throw err;
    }
  }

  refresh(): void {
    this.load();
  }
}

export const variableManager = VariableManager.getInstance();
