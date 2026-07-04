import { gcs } from "./gcs";
import { getAllJobStates } from "./db-job-state";
import { getSiteContextMap } from "./site-manager";
import { hasMultipleSites } from "./site-config";
import {
  evaluateDatabaseHealth,
  isAuthFetchError,
} from "../scripts/validation/shared/databaseHealthChecks";

export type SystemAlertSeverity = "critical" | "warning";

export type SystemAlertCode =
  | "gcs_migration_required"
  | "database_auth_env_missing"
  | "database_auth_failed"
  | "database_fetch_failed";

export interface SystemAlert {
  id: string;
  severity: SystemAlertSeverity;
  code: SystemAlertCode;
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
  site?: string;
  database?: string;
}

function issuesFromCacheOrEvaluate(
  ctx: import("./site-manager").SiteContext,
  dbName: string,
  config: import("./database").DatabaseConfig,
) {
  const cached = ctx.validationCache.getByDatabase(dbName);
  if (cached) {
    return cached.errors;
  }

  const jobStates = getAllJobStates(ctx.contentRoot);
  const { errors } = evaluateDatabaseHealth(
    dbName,
    config,
    ctx.contentRoot,
    jobStates[dbName],
    ctx.database.getCacheInfo(dbName),
    ctx.database.countTransformErrors(dbName),
  );
  return errors;
}

export function collectSystemAlerts(): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  const multiSite = hasMultipleSites();

  if (gcs.migrationRequired) {
    alerts.push({
      id: "gcs_migration",
      severity: "warning",
      code: "gcs_migration_required",
      title: "GCS Migration Required",
      message:
        "Bucket uses old flat layout. GCS writes are blocked. Run: npx tsx scripts/admin/migrate-gcs-multisite.ts --to-bucket=<bucket> --execute. Use Re-check after migrating.",
    });
  }

  for (const ctx of getSiteContextMap().values()) {
    const { database, contentRootName } = ctx;
    const sitePrefix = multiSite ? `${contentRootName}:` : "";

    for (const { name, config } of database.list()) {
      const label = config.name || name;
      const actionHref = `/private/databases/${encodeURIComponent(name)}`;
      const siteField = multiSite ? { site: contentRootName } : {};

      const issues = issuesFromCacheOrEvaluate(ctx, name, config);

      for (const issue of issues) {
        if (issue.code === "DB_AUTH_ENV_MISSING") {
          alerts.push({
            id: `${sitePrefix}${name}:auth_env_missing`,
            severity: "critical",
            code: "database_auth_env_missing",
            title: `Database "${label}" — missing API token`,
            message: issue.message,
            actionHref,
            actionLabel: "Open database",
            database: name,
            ...siteField,
          });
        } else if (issue.code === "DB_FETCH_FAILED") {
          const isAuth = isAuthFetchError(issue.message);
          alerts.push({
            id: `${sitePrefix}${name}:${isAuth ? "auth_failed" : "fetch_failed"}`,
            severity: "critical",
            code: isAuth ? "database_auth_failed" : "database_fetch_failed",
            title: isAuth
              ? `Database "${label}" — authentication failed`
              : `Database "${label}" — fetch failed`,
            message: issue.message,
            actionHref,
            actionLabel: "Open database",
            database: name,
            ...siteField,
          });
        }
      }
    }
  }

  const severityRank: Record<SystemAlertSeverity, number> = {
    critical: 0,
    warning: 1,
  };

  return alerts.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity],
  );
}

export interface DatabaseRecheckResult {
  found: boolean;
  resolved: boolean;
  errorCount: number;
  warningCount: number;
  message: string;
}

/**
 * Re-evaluate a single database's health live (bypassing the cached
 * validation result), persist the fresh result to the validation cache,
 * and report whether the previously-reported critical issues are gone.
 */
export async function recheckDatabaseHealth(
  dbName: string,
  site?: string,
): Promise<DatabaseRecheckResult> {
  const matches = [...getSiteContextMap().values()].filter(
    (ctx) =>
      (!site || ctx.contentRootName === site) &&
      ctx.database.list().some((d: { name: string }) => d.name === dbName),
  );

  if (matches.length > 1) {
    return {
      found: false,
      resolved: false,
      errorCount: 0,
      warningCount: 0,
      message: `Database "${dbName}" exists in multiple sites; specify a site to re-check.`,
    };
  }

  for (const ctx of matches) {
    const entry = ctx.database.list().find((d: { name: string }) => d.name === dbName);
    if (!entry) continue;

    const jobStates = getAllJobStates(ctx.contentRoot);
    const { errors, warnings } = evaluateDatabaseHealth(
      dbName,
      entry.config,
      ctx.contentRoot,
      jobStates[dbName],
      ctx.database.getCacheInfo(dbName),
      ctx.database.countTransformErrors(dbName),
    );

    ctx.validationCache.setByDatabase(dbName, {
      lastRunAt: new Date().toISOString(),
      errors,
      warnings,
    });
    await ctx.validationCache.flush();

    const label = entry.config.name || dbName;
    const resolved = errors.length === 0;
    return {
      found: true,
      resolved,
      errorCount: errors.length,
      warningCount: warnings.length,
      message: resolved
        ? `Re-check passed — no issues found for "${label}". The alert has been cleared.`
        : `Re-check found ${errors.length} issue${errors.length === 1 ? "" : "s"} still present for "${label}".`,
    };
  }

  return {
    found: false,
    resolved: false,
    errorCount: 0,
    warningCount: 0,
    message: `Database "${dbName}" was not found.`,
  };
}
