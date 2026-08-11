import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator, ChevronDown, Info, Link2, Loader2, Pencil, RotateCcw } from "lucide-react";
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
  layer_has_key?: boolean;
};

type ProvenanceResponse = {
  hasDatabase: boolean;
  fields: FieldProvenance[];
  layerFileName?: string;
  isVariantLayer?: boolean;
  resolvedVariant?: string | null;
};

type ContentTypeConfig = {
  label?: string;
  name?: string;
  directory?: string;
  editor?: Record<string, EditorHint>;
  field_mapping?: Record<string, string | { source: string; default: string }>;
  database?: { slug?: string } | null;
};

function isSystemSpecialField(field: string): boolean {
  return field.startsWith("_");
}

function FieldsEducationBlock({
  hasDatabase,
  directory,
  databaseSlug,
  slug,
  locale,
  layerFileName,
  isVariantLayer,
}: {
  hasDatabase: boolean;
  directory: string;
  databaseSlug?: string;
  slug: string;
  locale: string;
  layerFileName?: string;
  isVariantLayer?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dbPath = `db/${databaseSlug || "<database>"}/overrides.json`;
  const ctPath = `${directory}/${slug}/${layerFileName || `${locale}.yml`}`;

  return (
    <div
      className="rounded-md border border-border bg-muted/20 p-3 space-y-3 text-sm text-muted-foreground"
      data-testid="fields-education"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="button-toggle-fields-education"
      >
        <p className="font-medium text-foreground">How Fields work</p>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="space-y-2">
            <p>
              Fields are the content-type schema (Manage → Fields). Custom fields appear here and as{" "}
              <code className="text-xs bg-muted px-1 rounded font-mono">{`{{ single.fieldName }}`}</code>.
              They are not SEO fields — use the SEO Meta tab for SEO head keys (
              <code className="text-xs font-mono">{`{{ meta.* }}`}</code>). System identity is auto-available as{" "}
              <code className="text-xs font-mono">{`{{ single.slug }}`}</code> /{" "}
              <code className="text-xs font-mono">{`{{ single.locale }}`}</code> /{" "}
              <code className="text-xs font-mono">{`{{ single.image }}`}</code> (and underscore forms).{" "}
              <code className="text-xs font-mono">_hreflangs</code> is routing-only. Change DB identity sources on
              Manage → Fields when a database is attached.
            </p>
            {hasDatabase ? (
              <div className="space-y-1.5">
                <p>
                  <span className="font-medium text-foreground">Database override</span> — Updates the cached
                  database value (listings and this page). Shared across locales.
                </p>
                <p>
                  <span className="font-medium text-foreground">Content type override</span> — Writes under{" "}
                  <code className="text-xs bg-muted px-1 rounded font-mono">field_overrides</code> on this
                  page&apos;s YAML for <strong className="text-foreground">this locale ({locale})</strong>.
                </p>
                <p>
                  <span className="font-medium text-foreground">Precedence:</span> Content type override →
                  Database override → Original database value.
                </p>
              </div>
            ) : (
              <p>
                <span className="font-medium text-foreground">Static fields</span> — Writes{" "}
                <strong className="text-foreground">top-level keys</strong> on{" "}
                <code className="text-xs bg-muted px-1 rounded font-mono">{ctPath}</code> (same idea as{" "}
                <code className="text-xs font-mono">title</code> / <code className="text-xs font-mono">content</code>
                ). The API path is still named <code className="text-xs font-mono">field-overrides</code>, but
                static types do not store a <code className="text-xs font-mono">field_overrides</code> bag.
              </p>
            )}
            {isVariantLayer && layerFileName && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-900 dark:text-amber-100">
                Editing <code className="font-mono text-xs">{layerFileName}</code> — not the published{" "}
                <code className="font-mono text-xs">{locale}.yml</code>. Changes stay on this variant until
                promote/publish.
              </p>
            )}
            <p>
              <span className="font-medium text-foreground">Published date</span> (
              <code className="text-xs font-mono">published_at</code>) is set when the entry first goes live
              (create for blog / shared-layout; publish for drafts). Edit here to backdate — saves to{" "}
              <code className="text-xs font-mono">_common.yml</code>. Cannot clear; later content edits do not
              change it.
            </p>
            <p>
              Edits write to disk
              {hasDatabase ? ` (${dbPath} and/or ${ctPath})` : ` (${ctPath})`} — open advanced for path rules.
            </p>
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-fields-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvanced && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
              <div>
                <p className="font-medium text-foreground mb-1">Files written</p>
                <ul className="list-disc pl-5 space-y-1">
                  {hasDatabase && (
                    <li>
                      Database override: <code className="text-[11px] font-mono">{dbPath}</code>
                    </li>
                  )}
                  <li>
                    {hasDatabase ? (
                      <>
                        Content type override:{" "}
                        <code className="text-[11px] font-mono">{ctPath}</code> under{" "}
                        <code className="text-[11px] font-mono">field_overrides</code>
                      </>
                    ) : (
                      <>
                        Static mapped fields: top-level keys on{" "}
                        <code className="text-[11px] font-mono">{ctPath}</code> via{" "}
                        <code className="text-[11px] font-mono">PUT .../field-overrides/:slug</code> →{" "}
                        <code className="text-[11px] font-mono">server/field-overrides.ts</code> (
                        <code className="text-[11px] font-mono">writeMappedFields</code>)
                      </>
                    )}
                  </li>
                  <li>
                    <code className="text-[11px] font-mono">published_at</code> (static):{" "}
                    <code className="text-[11px] font-mono">{directory}/{slug}/_common.yml</code> via{" "}
                    <code className="text-[11px] font-mono">server/published-at.ts</code> — not locale
                    overrides. Create stamps in <code className="text-[11px] font-mono">createContentEntry</code>;
                    draft go-live via versioning publish/promote.
                  </li>
                  <li>
                    Live SEO/required gate:{" "}
                    <code className="text-[11px] font-mono">server/live-entry-seo-gate.ts</code> (skipped for
                    variant/draft layer writes).
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">System fields</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Remap sources only on Manage → Fields.{" "}
                    <code className="text-[11px] font-mono">_slug</code> aliases to{" "}
                    <code className="text-[11px] font-mono">{`{{ single.slug }}`}</code>;{" "}
                    <code className="text-[11px] font-mono">_image</code> drives preview/OG and aliases to{" "}
                    <code className="text-[11px] font-mono">{`{{ single.image }}`}</code>.
                  </li>
                  {!hasDatabase && (
                    <li>
                      Static <code className="text-[11px] font-mono">_hreflangs</code> is unused — alternates
                      use locale files / slug overrides.
                    </li>
                  )}
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Reset</p>
                {hasDatabase ? (
                  <p>
                    Reset clears content-type and database overrides for a custom field, restoring the
                    original database value.
                  </p>
                ) : (
                  <p>
                    Reset removes the key from this layer file only (
                    <code className="text-[11px] font-mono">{layerFileName || `${locale}.yml`}</code>
                    ). If the value only exists on <code className="text-[11px] font-mono">_common.yml</code>,
                    reset is a no-op.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const VALUE_PREVIEW_MAX = 100;

function formatDisplayValue(value: unknown, maxLength?: number): string {
  if (value === null || value === undefined || value === "") return "—";
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (maxLength != null && text.length > maxLength) {
    return `${text.slice(0, maxLength).trimEnd()}…`;
  }
  return text;
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
  variant,
}: {
  contentType: string;
  slug: string;
  locale: string;
  typeLabel: string;
  /** Preview/Debug variant slug (e.g. draft, lumi-version). Omit for live locale file. */
  variant?: string | null;
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
  const [variantConfirmOpen, setVariantConfirmOpen] = useState(false);
  const variantConfirmRef = useRef<{
    resolve: (ok: boolean) => void;
  } | null>(null);

  const variantParam =
    typeof variant === "string" && variant.trim() && variant.trim() !== "default"
      ? variant.trim()
      : undefined;

  const provenanceKey = [
    "/api/content-types",
    contentType,
    "field-provenance",
    slug,
    locale,
    variantParam || "",
  ] as const;

  const { data: provenance, isLoading } = useQuery<ProvenanceResponse>({
    queryKey: provenanceKey,
    queryFn: () => {
      const q = new URLSearchParams({ locale });
      if (variantParam) q.set("variant", variantParam);
      return fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/field-provenance/${encodeURIComponent(slug)}?${q}`,
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to load fields");
        return r.json();
      });
    },
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
  const directory = ctConfig?.directory || contentType;
  const databaseSlug = ctConfig?.database?.slug;
  const layerFileName = provenance?.layerFileName;
  const isVariantLayer = !!provenance?.isVariantLayer || !!variantParam;

  const education = (
    <FieldsEducationBlock
      hasDatabase={hasDatabase}
      directory={directory}
      databaseSlug={databaseSlug}
      slug={slug}
      locale={locale}
      layerFileName={layerFileName}
      isVariantLayer={isVariantLayer}
    />
  );

  const authHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getDebugToken();
    if (token) headers["X-Debug-Token"] = token;
    return headers;
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [...provenanceKey] });
  };

  const confirmVariantSaveIfNeeded = async (): Promise<boolean> => {
    if (!isVariantLayer) return true;
    return new Promise((resolve) => {
      variantConfirmRef.current = { resolve };
      setVariantConfirmOpen(true);
    });
  };

  const openPencil = (row: FieldProvenance) => {
    if (row.calculated || isSystemSpecialField(row.field)) return;
    if (row.source === "ct_override" || (!hasDatabase && row.source === "entry_default")) {
      setEditing({ field: row.field, level: "content_type", value: row.effective });
      return;
    }
    if (row.source === "db_override") {
      setEditing({ field: row.field, level: "database", value: row.effective });
      return;
    }
    if (!hasDatabase) {
      setEditing({ field: row.field, level: "content_type", value: row.effective });
      return;
    }
    setLevelChooserField(row);
  };

  const handleReset = async () => {
    if (!resetTarget || isSystemSpecialField(resetTarget.field)) return;
    if (hasDatabase) {
      // DB path
    } else if (!resetTarget.layer_has_key) {
      toast({
        title: "Nothing to reset",
        description: `"${resetTarget.field}" is not set on this layer file (may come from _common.yml).`,
      });
      setResetTarget(null);
      return;
    }
    setResetting(true);
    try {
      const headers = await authHeaders();
      const author = await resolveAuthorName();
      const res = await fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/field-reset/${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            field: resetTarget.field,
            locale,
            variant: variantParam,
            author: author || undefined,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        noop?: boolean;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || "Reset failed");
      }
      if (body.noop) {
        toast({
          title: "Nothing to reset",
          description: body.message || body.error || "Field is not set on this layer.",
        });
      } else {
        toast({
          title: "Field reset",
          description: hasDatabase
            ? `"${resetTarget.field}" restored to the original database value.`
            : `"${resetTarget.field}" removed from ${layerFileName || `${locale}.yml`}.`,
        });
      }
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
        {education}
        <p className="text-sm text-muted-foreground">
          {label} entries don&apos;t have any fields declared yet. Declare fields on the content type
          (for example <code className="font-mono text-xs bg-muted px-1 rounded">author_name</code>),
          then come back here to set each entry&apos;s values.
        </p>
        <Button variant="outline" size="sm" asChild data-testid="link-configure-fields">
          <Link href={`/private/type/${encodeURIComponent(contentType)}`}>
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Declare fields for {label}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4" data-testid="fields-tab-table">
      {education}
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
              const special = isSystemSpecialField(row.field);
              const localeEmptyNote =
                row.field === "_locale" && !hasDatabase && (row.effective === undefined || row.effective === "");
              const hreflangsStaticNote = row.field === "_hreflangs" && !hasDatabase;
              const canReset =
                !row.calculated &&
                !special &&
                (hasDatabase ? row.source !== "original" : !!row.layer_has_key);
              return (
                <tr key={row.field} className="border-b last:border-b-0" data-testid={`row-field-${row.field}`}>
                  <td className="px-3 py-2 font-mono text-xs align-top">
                    <span className="inline-flex items-center gap-1">
                      {row.field}
                      {special && (
                        <Badge variant="outline" className="text-[9px] font-sans font-normal">
                          system
                        </Badge>
                      )}
                      {row.calculated && (
                        <Calculator
                          className="h-3 w-3 text-muted-foreground"
                          title="Calculated (function) field"
                        />
                      )}
                    </span>
                    {(localeEmptyNote || hreflangsStaticNote) && (
                      <p className="text-[10px] text-muted-foreground font-sans mt-0.5 max-w-[160px]">
                        {localeEmptyNote
                          ? "Usually from file/URL — map a source on Manage → Fields if needed."
                          : "Static alternates use locale files — not set here."}
                      </p>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-xs align-top break-all max-w-[220px]"
                    title={formatDisplayValue(row.effective)}
                  >
                    {formatDisplayValue(row.effective, VALUE_PREVIEW_MAX)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {special ? (
                      <Badge variant="outline" className="text-[10px] font-normal gap-1">
                        <Info className="h-3 w-3" />
                        Read-only
                      </Badge>
                    ) : (
                      <Badge variant={badge.variant} className="text-[10px] font-normal">
                        {badge.label}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-0.5">
                      {!row.calculated && !special && (
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
                      {canReset && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Reset"
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
        onOpenChange={(v) => {
          if (!v) setLevelChooserField(null);
        }}
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
              database value across listings and this page.
            </p>
            <p>
              <span className="font-medium text-foreground">Content type override</span> — Updates this
              page&apos;s YAML only for this locale.
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
              {hasDatabase ? (
                <>
                  <code className="font-mono text-xs">{resetTarget?.field}</code> will go back to{" "}
                  <span className="font-medium text-foreground">
                    {formatDisplayValue(resetTarget?.baseline)}
                  </span>
                  . All database and content type overrides for this field will be removed.
                </>
              ) : (
                <>
                  Remove <code className="font-mono text-xs">{resetTarget?.field}</code> from{" "}
                  <code className="font-mono text-xs">{layerFileName || `${locale}.yml`}</code>. Values that
                  only exist on <code className="font-mono text-xs">_common.yml</code> are left unchanged.
                </>
              )}
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

      <AlertDialog
        open={variantConfirmOpen}
        onOpenChange={(v) => {
          if (!v) {
            variantConfirmRef.current?.resolve(false);
            variantConfirmRef.current = null;
            setVariantConfirmOpen(false);
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-variant-save-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Save to variant file?</AlertDialogTitle>
            <AlertDialogDescription>
              You are editing{" "}
              <code className="font-mono text-xs">{layerFileName || variantParam}</code>, not the published{" "}
              <code className="font-mono text-xs">{locale}.yml</code>. Continue saving to the variant layer?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                variantConfirmRef.current?.resolve(false);
                variantConfirmRef.current = null;
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                variantConfirmRef.current?.resolve(true);
                variantConfirmRef.current = null;
                setVariantConfirmOpen(false);
              }}
            >
              Save to variant
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
            if (editing.level === "content_type") {
              const ok = await confirmVariantSaveIfNeeded();
              if (!ok) {
                throw new Error("Save cancelled — no changes written.");
              }
            }
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
                    variant: variantParam,
                    fields: built,
                    author: author || undefined,
                  }),
                },
              );
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || "Failed to save field");
              }
            }
            invalidate();
          }}
        />
      )}
    </div>
  );
}
