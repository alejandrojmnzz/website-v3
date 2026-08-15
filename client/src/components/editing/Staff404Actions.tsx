import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  staff404ActionCopy,
  type Staff404ActionId,
  type Staff404Facts,
} from "@/lib/staff404";

export type Staff404ActionHandlers = {
  onGoBack?: () => void;
  dashboardHref?: string;
  onEditTemplates?: () => void;
  templatesDisabled?: boolean;
  onOpenDraft?: () => void;
  onRebuild?: () => void;
  rebuildBusy?: boolean;
  rebuildExtra?: ReactNode;
  onEditYaml?: () => void;
  redirectsHref?: string;
};

export default function Staff404Actions({
  actions,
  facts,
  handlers,
}: {
  actions: Staff404ActionId[];
  facts: Pick<Staff404Facts, "typeLabel" | "slug" | "variantsLoading" | "hasTemplateVariants">;
  handlers: Staff404ActionHandlers;
}) {
  return (
    <div className="space-y-3" data-testid="staff-404-actions">
      {actions.map((id) => {
        const copy = staff404ActionCopy(id, facts);
        return (
          <div
            key={id}
            className="rounded-md border border-border bg-card p-4 text-left"
            data-testid={`staff-404-action-${id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{copy.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{copy.description}</p>
              </div>
              <ActionButton id={id} label={copy.buttonLabel} handlers={handlers} />
            </div>
            {id === "rebuild" ? handlers.rebuildExtra : null}
          </div>
        );
      })}
    </div>
  );
}

function ActionButton({
  id,
  label,
  handlers,
}: {
  id: Staff404ActionId;
  label: string;
  handlers: Staff404ActionHandlers;
}) {
  if (id === "dashboard" && handlers.dashboardHref) {
    return (
      <Button size="sm" className="shrink-0" asChild>
        <a href={handlers.dashboardHref} data-testid="button-visit-type-dashboard">
          {label}
        </a>
      </Button>
    );
  }
  if (id === "openRedirects" && handlers.redirectsHref) {
    return (
      <Button size="sm" className="shrink-0" asChild>
        <a href={handlers.redirectsHref} data-testid="link-open-in-redirects">
          {label}
        </a>
      </Button>
    );
  }

  const disabled =
    (id === "editTemplates" && handlers.templatesDisabled) ||
    (id === "rebuild" && handlers.rebuildBusy);

  const onClick =
    id === "goBack"
      ? handlers.onGoBack
      : id === "editTemplates"
        ? handlers.onEditTemplates
        : id === "openDraft"
          ? handlers.onOpenDraft
          : id === "rebuild"
            ? handlers.onRebuild
            : id === "editYaml"
              ? handlers.onEditYaml
              : undefined;

  const testId =
    id === "goBack"
      ? "button-go-back"
      : id === "rebuild"
        ? "button-rebuild-urls"
        : id === "editYaml"
          ? "button-edit-yaml"
          : `button-staff-404-${id}`;

  return (
    <Button
      size="sm"
      className="shrink-0"
      disabled={disabled || !onClick}
      onClick={onClick}
      data-testid={testId}
    >
      {id === "rebuild" && handlers.rebuildBusy ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : null}
      {label}
    </Button>
  );
}
