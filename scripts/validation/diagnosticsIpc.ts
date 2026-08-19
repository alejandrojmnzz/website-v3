/**
 * IPC message shapes between Express parent and diagnostics worker child.
 */

export type DiagnosticsFreshness = "hard" | "max_age";

export interface DiagnosticsWorkerStartMessage {
  type: "start";
  jobId: string;
  contentRoot: string;
  contentRootName: string;
  slugs?: string[];
  urls?: string[];
  freshness: DiagnosticsFreshness;
  max_age_seconds: number;
  validators?: string[];
  include_artifacts: boolean;
  categories?: string[];
  /**
   * Run entry-local validators once without per-URL iteration (shared-template
   * re-check: single.*.yml files are not YAML-backed page entries).
   */
  validator_only?: boolean;
  /** Absolute path for validator results / issuesBySlug payload */
  resultsPath: string;
}

export interface DiagnosticsWorkerProgressMessage {
  type: "progress";
  jobId: string;
  processed: number;
  total: number;
  staleUrlCount?: number;
  urlCount?: number;
  message?: string;
  status?: "running";
}

export interface DiagnosticsWorkerCompletedMessage {
  type: "completed";
  jobId: string;
  processed: number;
  total: number;
  summary: { errorCount: number; warningCount: number };
  resultsPath: string;
}

export interface DiagnosticsWorkerFailedMessage {
  type: "failed";
  jobId: string;
  error: string;
}

export type DiagnosticsWorkerOutboundMessage =
  | DiagnosticsWorkerProgressMessage
  | DiagnosticsWorkerCompletedMessage
  | DiagnosticsWorkerFailedMessage;

export type DiagnosticsWorkerInboundMessage = DiagnosticsWorkerStartMessage;

export interface DiagnosticsJobResultsFile {
  summary: { errorCount: number; warningCount: number };
  validatorResults?: unknown[];
  issuesBySlug?: Record<
    string,
    Array<{
      code: string;
      message: string;
      severity: "error" | "warning";
      category: string;
      validator?: string;
      file?: string;
      suggestion?: string;
      url?: string;
    }>
  >;
}
