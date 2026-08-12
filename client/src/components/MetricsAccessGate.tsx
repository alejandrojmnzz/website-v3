import { Link } from "wouter";
import { IconLock, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useDebugAuth } from "@/hooks/useDebugAuth";

/**
 * Gates metrics private pages on metrics_view.
 * While auth is still loading, shows a spinner; if the user lacks the capability, shows access denied.
 */
export function MetricsAccessGate({ children }: { children: React.ReactNode }) {
  const { isValidated, isLoading, hasCapability } = useDebugAuth();
  const canView = hasCapability("metrics_view");

  if (isLoading || isValidated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <IconLock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-semibold text-foreground">Access denied</h1>
            <p className="text-sm text-muted-foreground">
              Needs the Metrics Viewer role (or Webmaster) to view diagnostics, insights, error
              log, conversions, and tracking.
            </p>
          </div>
          <Link href="/">
            <Button variant="outline" data-testid="button-metrics-access-denied-home">
              Back to site
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
