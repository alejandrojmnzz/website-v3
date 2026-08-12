import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";

interface LeadsFormEntry {
  section_id: string;
  section_type: string;
  variant?: string;
  conversion_name: string;
  tags: string[];
  automations?: string;
  yml: string | null;
}

interface LeadsPage {
  key: string;
  site: string;
  content_type: string;
  slug: string;
  locale: string;
  file: string;
  page_url: string | null;
  forms: LeadsFormEntry[];
}

interface TrackingSettingsResponse {
  leads_expected_conversion_names?: string[];
  leads_expected_tags?: string[];
}

type WarningKind = "missing_conversion_name" | "unknown_conversion_name" | "tag_mismatch";

function formWarnings(
  form: LeadsFormEntry,
  expectedNames: string[],
  expectedTags: string[],
): WarningKind[] {
  const warnings: WarningKind[] = [];
  if (!form.conversion_name) {
    warnings.push("missing_conversion_name");
  } else if (expectedNames.length > 0 && !expectedNames.includes(form.conversion_name)) {
    warnings.push("unknown_conversion_name");
  }
  // Tag check: conversion_name counts as a tag for ActiveCampaign. A form passes
  // if its conversion_name OR any of its tags is in the expected tag list.
  if (expectedTags.length > 0 && form.tags.length > 0) {
    const matches =
      (form.conversion_name && expectedTags.includes(form.conversion_name)) ||
      form.tags.some((t) => expectedTags.includes(t));
    if (!matches) warnings.push("tag_mismatch");
  }
  return warnings;
}

const WARNING_LABELS: Record<WarningKind, string> = {
  missing_conversion_name: "Missing conversion_name",
  unknown_conversion_name: "conversion_name not in expected list",
  tag_mismatch: "No tag (or conversion_name) matches the expected tags",
};

function AllowlistEditor({
  title,
  description,
  values,
  onChange,
  saving,
  testIdPrefix,
}: {
  title: string;
  description: string;
  values: string[];
  onChange: (next: string[]) => void;
  saving: boolean;
  testIdPrefix: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  };

  return (
    <div className="flex-1 min-w-[260px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground mb-2">{description}</p>
      <div className="flex gap-2 mb-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add value and press Enter"
          className="h-8 text-sm"
          data-testid={`input-${testIdPrefix}`}
        />
        <Button variant="outline" size="sm" onClick={add} disabled={!draft.trim()} data-testid={`button-add-${testIdPrefix}`}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && (
          <span className="text-xs text-muted-foreground italic">Empty — this check is disabled</span>
        )}
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1 pr-1" data-testid={`badge-${testIdPrefix}-${v}`}>
            <span className="font-mono text-xs">{v}</span>
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
              data-testid={`button-remove-${testIdPrefix}-${v}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function LeadsTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState<string>("all");
  const queryClient = useQueryClient();
  const formatSitePath = useFormatSitePath();

  const formsQuery = useQuery<{ pages: LeadsPage[] }>({
    queryKey: ["/api/form-state/all-forms"],
  });

  const settingsQuery = useQuery<TrackingSettingsResponse>({
    queryKey: ["/api/settings/tracking"],
  });

  const expectedNames = settingsQuery.data?.leads_expected_conversion_names ?? [];
  const expectedTags = settingsQuery.data?.leads_expected_tags ?? [];

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      leads_expected_conversion_names?: string[];
      leads_expected_tags?: string[];
    }) => apiRequest("PUT", "/api/settings/tracking", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/tracking"] });
    },
  });

  const pages = formsQuery.data?.pages ?? [];

  const pageStats = useMemo(
    () =>
      pages
        .map((page) => {
          // Within each page, show forms with warnings first.
          const sortedForms = [...page.forms]
            .map((f) => ({ form: f, warnings: formWarnings(f, expectedNames, expectedTags) }))
            .sort((a, b) => b.warnings.length - a.warnings.length);
          const warningCount = sortedForms.reduce((acc, f) => acc + f.warnings.length, 0);
          return {
            page: { ...page, forms: sortedForms.map((f) => f.form) },
            warningsByForm: sortedForms.map((f) => f.warnings),
            warningCount,
          };
        })
        // Pages with warnings always first (more warnings higher), then alphabetical.
        .sort((a, b) => b.warningCount - a.warningCount || a.page.key.localeCompare(b.page.key)),
    [pages, expectedNames, expectedTags],
  );

  const contentTypes = useMemo(
    () => Array.from(new Set(pages.map((p) => p.content_type))).sort(),
    [pages],
  );

  const filteredStats = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byType =
      contentTypeFilter === "all"
        ? pageStats
        : pageStats.filter(({ page }) => page.content_type === contentTypeFilter);
    if (!q) return byType;
    return byType.filter(({ page }) =>
      page.key.toLowerCase().includes(q) ||
      page.file.toLowerCase().includes(q) ||
      page.forms.some(
        (f) =>
          f.conversion_name.toLowerCase().includes(q) ||
          f.section_type.toLowerCase().includes(q) ||
          f.section_id.toLowerCase().includes(q) ||
          f.tags.some((t) => t.toLowerCase().includes(q)),
      ),
    );
  }, [pageStats, search, contentTypeFilter]);

  const totalForms = pages.reduce((acc, p) => acc + p.forms.length, 0);
  const totalWarnings = pageStats.reduce((acc, s) => acc + s.warningCount, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Expected values</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6">
            <AllowlistEditor
              title="Expected conversion names"
              description="Forms whose conversion_name is not in this list get a warning."
              values={expectedNames}
              onChange={(next) => saveMutation.mutate({ leads_expected_conversion_names: next })}
              saving={saveMutation.isPending}
              testIdPrefix="expected-conversion-name"
            />
            <AllowlistEditor
              title="Expected CRM tags"
              description="CRM-agnostic allowlist. A form passes if its conversion_name or any of its tags matches this list. Forms with tags and no match get a warning."
              values={expectedTags}
              onChange={(next) => saveMutation.mutate({ leads_expected_tags: next })}
              saving={saveMutation.isPending}
              testIdPrefix="expected-tag"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground" data-testid="text-leads-summary">
          {formsQuery.isLoading
            ? "Scanning forms…"
            : `${totalForms} form${totalForms === 1 ? "" : "s"} across ${pages.length} page${pages.length === 1 ? "" : "s"}` +
              (totalWarnings > 0 ? ` · ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}` : "")}
        </div>
        <div className="flex items-center gap-2">
          <Select value={contentTypeFilter} onValueChange={setContentTypeFilter}>
            <SelectTrigger className="h-8 w-44 text-sm" data-testid="select-leads-content-type">
              <SelectValue placeholder="Content type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All content types</SelectItem>
              {contentTypes.map((ct) => (
                <SelectItem key={ct} value={ct} data-testid={`option-content-type-${ct}`}>
                  {ct}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, tag, section…"
            className="h-8 w-56 text-sm"
            data-testid="input-search-leads"
          />
          <Button
          variant="outline"
          size="sm"
          onClick={() => formsQuery.refetch()}
          disabled={formsQuery.isFetching}
          data-testid="button-refresh-leads"
        >
          {formsQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
          </Button>
        </div>
      </div>

      {formsQuery.isError && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Failed to load forms inventory: {(formsQuery.error as Error).message}
          </CardContent>
        </Card>
      )}

      {!formsQuery.isLoading && pages.length === 0 && !formsQuery.isError && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No forms found in any content file.
          </CardContent>
        </Card>
      )}

      <Accordion type="multiple" className="space-y-2">
        {filteredStats.map(({ page, warningsByForm, warningCount }) => (
          <AccordionItem
            key={page.key}
            value={page.key}
            className="border rounded-md px-3 bg-card"
            data-testid={`accordion-leads-page-${page.key}`}
          >
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-2 flex-wrap text-left">
                {warningCount > 0 && (
                  <AlertTriangle
                    className="h-4 w-4 text-amber-500 shrink-0"
                    data-testid={`icon-warning-page-${page.key}`}
                  />
                )}
                <span className="font-medium text-sm">
                  {page.content_type}/{page.slug}
                </span>
                <Badge variant="outline" className="text-xs uppercase">{page.locale}</Badge>
                <Badge variant="outline" className="text-xs font-mono">
                  {page.site.replace(/^site_/, "")}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {page.forms.length} form{page.forms.length === 1 ? "" : "s"}
                </Badge>
                {warningCount > 0 && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    {warningCount} warning{warningCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{page.file}</span>
                {page.page_url && (
                  <a
                    href={formatSitePath(page.page_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    data-testid={`link-open-page-${page.key}`}
                  >
                    Open page <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {page.forms.map((form, i) => {
                const warnings = warningsByForm[i];
                const editHref = page.page_url
                  ? formatSitePath(`${page.page_url}${page.page_url.includes("?") ? "&" : "?"}locale=${page.locale}#${form.section_id}`)
                  : null;
                return (
                  <div
                    key={`${form.section_id}-${i}`}
                    className="border rounded-md p-3 space-y-2"
                    data-testid={`card-leads-form-${page.key}-${form.section_id || i}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        {warnings.length > 0 && (
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" data-testid={`icon-warning-form-${form.section_id || i}`} />
                        )}
                        <span className="font-mono text-sm font-medium">
                          {form.section_type}
                          {form.variant ? ` · ${form.variant}` : ""}
                        </span>
                        {form.section_id && (
                          <Badge variant="outline" className="text-xs font-mono">#{form.section_id}</Badge>
                        )}
                        {form.conversion_name ? (
                          <Badge variant="secondary" className="text-xs font-mono">
                            {form.conversion_name}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            no conversion_name
                          </Badge>
                        )}
                        {form.tags.map((t) => (
                          <Badge key={t} variant="outline" className="text-xs font-mono">
                            {t}
                          </Badge>
                        ))}
                      </div>
                      {editHref && (
                        <a href={editHref} target="_blank" rel="noreferrer" data-testid={`link-edit-section-${form.section_id || i}`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit this section on the page">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      )}
                    </div>
                    {warnings.length > 0 && (
                      <ul className="text-xs text-amber-600 space-y-0.5">
                        {warnings.map((w) => (
                          <li key={w} className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            {WARNING_LABELS[w]}
                          </li>
                        ))}
                      </ul>
                    )}
                    {form.yml && (
                      <pre
                        className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre"
                        data-testid={`yml-form-${form.section_id || i}`}
                      >
                        {form.yml}
                      </pre>
                    )}
                  </div>
                );
              })}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
