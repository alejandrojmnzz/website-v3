import { IconAlertCircle, IconAlertTriangle } from "@tabler/icons-react";

export interface StatusCountBadgeProps {
  errorCount: number;
  warningCount?: number;
  errorsOnly?: boolean;
  onClick: () => void;
  testId: string;
  title?: string;
}

export function StatusCountBadge({
  errorCount,
  warningCount = 0,
  errorsOnly = false,
  onClick,
  testId,
  title,
}: StatusCountBadgeProps) {
  if (errorsOnly && errorCount === 0) return null;
  if (!errorsOnly && errorCount === 0 && warningCount === 0) return null;

  const isError = errorCount > 0;
  const count = isError ? errorCount : warningCount;

  const defaultTitle = errorsOnly
    ? `${errorCount} error${errorCount !== 1 ? "s" : ""} — click to view`
    : `${errorCount} error${errorCount !== 1 ? "s" : ""}, ${warningCount} warning${warningCount !== 1 ? "s" : ""} — click to view diagnostics`;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={[
        "flex-shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium leading-none cursor-pointer transition-opacity hover:opacity-80",
        isError
          ? "bg-destructive text-destructive-foreground"
          : "bg-amber-500 text-white",
      ].join(" ")}
      title={title ?? defaultTitle}
      data-testid={testId}
    >
      {isError
        ? <IconAlertCircle className="h-3 w-3" />
        : <IconAlertTriangle className="h-3 w-3" />}
      {count}
    </button>
  );
}
