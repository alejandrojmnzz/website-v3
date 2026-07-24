import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Link2, Loader2, Pencil, RotateCcw } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ItemEditModal } from "@/components/databases/ItemEditModal";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { queryClient } from "@/lib/queryClient";
import type { EditorHint } from "@/components/editing/EditorTypeDialog";

type FieldSource = "original" | "db_override" | "ct_override" | "entry_default";

type FieldProvenance = {
  field: string;
  effective: unknown;
  source: FieldSource;
  baseline?: unknown;
  db_value?: unknown;
  ct_value?: unknown;
  calculated?: boolean;
};

type ProvenanceResponse = {
  hasDatabase: boolean;
  fields: FieldProvenance[];
};

type ContentTypeConfig = {
  label?: string;
  name?: string;
  editor?: Record<string, EditorHint>;
  field_mapping?: Record<string, string | { source: string; default: string }>;
  database?: { slug?: string } | null;
};

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sourceBadge(source: FieldSource): { label: string; variant: "default" | "secondary" | "outline" } {
  switch (source) {
    case "db_override":
      return { label: "Database override", variant: "default" };
    case "ct_override":
      return { label: "Content type override", variant: "secondary" };
    case "entry_default":
      return { label: "Entry default", variant: "outline" };
    default:
      return { label: "Original database", variant: "outline" };
  }
}

export function MappingFieldsTab({
  contentType,
  slug,
  locale,
  typeLabel,
}: {
  contentType: string;
  slug: string;
  locale: string;
  typeLabel: string;
}) {
  const { toast } = useToast();
  const [levelChooserField, setLevelChooserField] = useState<FieldProvenance | null>(null);
  const [editing, setEditing] = useState<{
    field: string;
    level: "database" | "content_type";
    value: unknown;
  } | null>(null);
  const [resetTarget, setResetTarget] = useState<FieldProvenance | null>(null);
  const [resetting, setResetting] = useState(false);

  const provenanceKey = ["/api/content-types", contentType, "field-provenance", slug, locale] as const;

  const { data: provenance, isLoading } = useQuery<ProvenanceResponse>({
    queryKey: provenanceKey,
    queryFn: () =>
      fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/field-provenance/${encodeURIComponent(slug)}?locale=${encodeURIComponent(locale)}`,
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to load fields");
        return r.json();
      }),
  });

  const { data: ctConfig } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then((r) => r.json()),
  });

  const { data: dbEditor } = useQuery<Record<string, EditorHint>>({
    queryKey: ["/api/databases", ctConfig?.database?.slug, "editor-config"],
    queryFn: async () => {
      const dbSlug = ctConfig?.database?.slug;
      if (!dbSlug) return {};
      const res = await fetch(`/api/databases/${dbSlug}`);
      if (!res.ok) return {};
      const data = await res.json();
      return (data.config?.editor as Record<string, EditorHint>) || {};
    },
    enabled: !!ctConfig?.database?.slug,
  });

  const editorMap = useMemo(() => {
    return { ...(dbEditor || {}), ...(ctConfig?.editor || {}) };
  }, [ctConfig?.editor, dbEditor]);

  const fields = provenance?.fields ?? [];
  const hasDatabase = !!provenance?.hasDatabase;
  const hasMappings = fields.length > 0;

  const authHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getDebugToken();
    if (token) headers["X-Debug-Token"] = token;
    return headers;
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [...provenanceKey] });
  };

  const openPencil = (row: FieldProvenance) => {
    if (row.calculated) return;
    if (row.source === "ct_override" || (!hasDatabase && row.source === "entry_default")) {
      setEditing({ field: row.field, level: "content_type", value: row.effective });
      return;
    }
    if (row.source === "db_override") {
      setEditing({ field: row.field, level: "database", value: row.effective });
      return;
    }
    // original database — ask level
    setLevelChooserField(row);
  };

  const handleReset = async () => {
    if (!resetTarget || !hasDatabase) return;
    setResetting(true);
    try {
      const headers = await authHeaders();
      const author = await resolveAuthorName();
      const res = await fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/field-reset/${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ field: resetTarget.field, locale, author: author || undefined }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Reset failed");
      }
      toast({ title: "Field reset", description: `"${resetTarget.field}" restored to the original database value.` });
      setResetTarget(null);
      invalidate();
    } catch (err) {
      toast({
        title: "Reset failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading fields…</span>
      </div>
    );
  }

  if (!hasMappings) {
    const label = typeLabel || contentType;
    return (
      <div className="space-y-3 pt-4" data-testid="fields-tab-empty">
        <p className="text-sm text-muted-foreground">
          {label}&apos;s don&apos;t have any fields yet. You can add fields if you want to store meta
          information about content type entries. For example, if you want to store the author of a blog
          post you can add the field <code className="font-mono text-xs bg-muted px-1 rounded">author_name</code>{" "}
          to the {contentType} custom type.
        </p>
        <Button variant="outline" size="sm" asChild data-testid="link-configure-fields">
          <Link href={`/private/content-types/${encodeURIComponent(contentType)}`}>
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Configure fields for {label}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4" data-testid="fields-tab-table">
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium w-[88px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((row) => {
              const badge = sourceBadge(row.source);
              return (
                <tr key={row.field} className="border-b last:border-b-0" data-testid={`row-field-${row.field}`}>
                  <td className="px-3 py-2 font-mono text-xs align-top">
                    <span className="inline-flex items-center gap-1">
                      {row.field}
                      {row.calculated && (
                        <Calculator
                          className="h-3 w-3 text-muted-foreground"
                          title="Calculated (function) field"
                        />
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs align-top break-all max-w-[220px]">
                    {formatDisplayValue(row.effective)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Badge variant={badge.variant} className="text-[10px] font-normal">
                      {badge.label}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-0.5">
                      {!row.calculated && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit"
                          onClick={() => openPencil(row)}
                          data-testid={`button-edit-field-${row.field}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {hasDatabase && !row.calculated && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Reset to original"
                          disabled={row.source === "original"}
                          onClick={() => setResetTarget(row)}
                          data-testid={`button-reset-field-${row.field}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!levelChooserField}
        onOpenChange={(v) => { if (!v) setLevelChooserField(null); }}
      >
        <DialogContent className="sm:max-w-md" data-testid="dialog-override-level">
          <DialogHeader>
            <DialogTitle>Where should this override live?</DialogTitle>
            <DialogDescription>
              Choose how <code className="font-mono text-xs">{levelChooserField?.field}</code> is stored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Database override</span> — Updates the cached
              database value. It will appear in listings, dropdowns, filters, and other database-powered UI
              across the site.
            </p>
            <p>
              <span className="font-medium text-foreground">Content type override</span> — Updates this
              page&apos;s YAML only. Use for page/HTML-specific fields. It does{" "}
              <strong className="text-foreground">not</strong> change the database or listing data.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                if (!levelChooserField) return;
                setEditing({
                  field: levelChooserField.field,
                  level: "database",
                  value: levelChooserField.effective,
                });
                setLevelChooserField(null);
              }}
              data-testid="button-choose-db-level"
            >
              Database override
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                if (!levelChooserField) return;
                setEditing({
                  field: levelChooserField.field,
                  level: "content_type",
                  value: levelChooserField.effective,
                });
                setLevelChooserField(null);
              }}
              data-testid="button-choose-ct-level"
            >
              Content type override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!resetTarget} onOpenChange={(v) => { if (!v) setResetTarget(null); }}>
        <AlertDialogContent data-testid="dialog-reset-field">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset field?</AlertDialogTitle>
            <AlertDialogDescription>
              <code className="font-mono text-xs">{resetTarget?.field}</code> will go back to{" "}
              <span className="font-medium text-foreground">
                {formatDisplayValue(resetTarget?.baseline)}
              </span>
              . All database and content type overrides for this field will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleReset()} disabled={resetting}>
              {resetting ? "Resetting…" : "Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing && (
        <ItemEditModal
          onlyFields={[editing.field]}
          editorOverrides={editorMap}
          overrideLevel={editing.level}
          dbName={editing.level === "database" ? ctConfig?.database?.slug : undefined}
          item={{ [editing.field]: editing.value }}
          title={`Edit ${editing.field}`}
          onClose={() => setEditing(null)}
          onSave={async (built) => {
            const headers = await authHeaders();
            const author = await resolveAuthorName();
            if (editing.level === "database") {
              const res = await fetch(
                `/api/content-types/${encodeURIComponent(contentType)}/db-overrides/${encodeURIComponent(slug)}`,
                {
                  method: "PUT",
                  headers,
                  body: JSON.stringify({ fields: built, author: author || undefined }),
                },
              );
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || "Failed to save database override");
              }
            } else {
              const res = await fetch(
                `/api/content-types/${encodeURIComponent(contentType)}/field-overrides/${encodeURIComponent(slug)}`,
                {
                  method: "PUT",
                  headers,
                  body: JSON.stringify({
                    locale,
                    fields: built,
                    author: author || undefined,
                  }),
                },
              );
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || "Failed to save content type override");
              }
            }
            invalidate();
          }}
        />
      )}
    </div>
  );
}
