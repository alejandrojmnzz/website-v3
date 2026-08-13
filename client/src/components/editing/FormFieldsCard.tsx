import { useState } from "react";
import { IconChevronDown, IconForms, IconPencil, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Same rich layouts as menu dropdowns, plus text/phone/textarea/select for forms. */
const COMPONENT_RENDERERS = [
  { value: "text", label: "Text" },
  { value: "phone", label: "Phone" },
  { value: "textarea", label: "Textarea" },
  { value: "select", label: "Select" },
  { value: "cards", label: "Cards" },
  { value: "simple-list", label: "Simple List" },
  { value: "grouped-list", label: "Grouped List" },
] as const;

export interface FormFieldConfig {
  visible?: boolean;
  required?: boolean;
  default?: string;
  component_renderer?: string;
  [key: string]: unknown;
}

export type FormFieldEditableKey = "visible" | "required" | "default" | "component_renderer";

export interface FormFieldsCardProps {
  fields: Record<string, FormFieldConfig>;
  onFieldChange: (fieldName: string, key: FormFieldEditableKey, value: boolean | string) => void;
}

/** Preferred display order for known lead-form fields; unknown keys follow alphabetically. */
const FIELD_ORDER = [
  "email",
  "first_name",
  "last_name",
  "phone",
  "program",
  "plan",
  "region",
  "location",
  "coupon",
  "client_comments",
  "current_download",
];

function sortFieldNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function summarizeField(cfg: FormFieldConfig): string[] {
  const parts: string[] = [];
  const source = cfg.source;
  if (typeof source === "string" && source.trim()) {
    parts.push(`source: ${source.trim()}`);
  } else if (source && typeof source === "object" && !Array.isArray(source)) {
    const rel = (source as { relation?: string }).relation;
    const name = (source as { name?: string }).name;
    if (typeof rel === "string" && rel.trim()) parts.push(`relation: ${rel.trim()}`);
    else if (typeof name === "string" && name.trim()) parts.push(`catalog: ${name.trim()}`);
  }
  if (cfg.visible === true) parts.push("visible");
  if (cfg.visible === false) parts.push("hidden");
  if (cfg.required === true) parts.push("required");
  if (cfg.required === false) parts.push("optional");
  if (typeof cfg.default === "string" && cfg.default.trim()) {
    parts.push(`default: ${cfg.default}`);
  }
  if (
    typeof cfg.component_renderer === "string" &&
    cfg.component_renderer.trim()
  ) {
    parts.push(cfg.component_renderer);
  }
  return parts;
}

function FormFieldEditorRow({
  name,
  cfg,
  onFieldChange,
}: {
  name: string;
  cfg: FormFieldConfig;
  onFieldChange: FormFieldsCardProps["onFieldChange"];
}) {
  const [open, setOpen] = useState(false);
  const visible = cfg.visible === true;
  const required = cfg.required === true;
  const defaultValue = typeof cfg.default === "string" ? cfg.default : "";
  const hasRenderer =
    typeof cfg.component_renderer === "string" && cfg.component_renderer.trim();
  const renderer = hasRenderer ? cfg.component_renderer!.trim() : undefined;
  const summary = summarizeField(cfg);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-background/50"
      data-testid={`form-field-row-${name}`}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 p-2.5 text-left hover:bg-muted/40 transition-colors rounded-md"
          data-testid={`button-toggle-form-field-${name}`}
        >
          <span className="text-xs font-mono font-medium shrink-0">{name}</span>
          <div className="flex flex-wrap gap-1 min-w-0 flex-1">
            {summary.length > 0 ? (
              summary.map((part) => (
                <Badge
                  key={part}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 leading-4 font-normal font-mono"
                >
                  {part}
                </Badge>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground italic">no options set</span>
            )}
          </div>
          <IconChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 px-2.5 pb-2.5 pt-0 border-t border-border/60">
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <div className="flex items-center gap-1.5">
              <Switch
                id={`field-${name}-visible`}
                checked={visible}
                onCheckedChange={(v) => onFieldChange(name, "visible", v)}
                data-testid={`switch-field-${name}-visible`}
              />
              <Label htmlFor={`field-${name}-visible`} className="text-xs text-muted-foreground">
                Visible
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch
                id={`field-${name}-required`}
                checked={required}
                onCheckedChange={(v) => onFieldChange(name, "required", v)}
                data-testid={`switch-field-${name}-required`}
              />
              <Label htmlFor={`field-${name}-required`} className="text-xs text-muted-foreground">
                Required
              </Label>
            </div>
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={`field-${name}-default`}
              className="text-xs text-muted-foreground"
            >
              Default
            </Label>
            <Input
              id={`field-${name}-default`}
              value={defaultValue}
              onChange={(e) => onFieldChange(name, "default", e.target.value)}
              placeholder="e.g. auto, or a static value"
              className="h-8 text-xs font-mono"
              data-testid={`input-field-${name}-default`}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Component renderer</Label>
            <Select
              value={renderer}
              onValueChange={(val) => onFieldChange(name, "component_renderer", val)}
            >
              <SelectTrigger
                className="h-8 text-xs"
                data-testid={`select-field-${name}-component-renderer`}
              >
                <SelectValue placeholder="Runtime default…" />
              </SelectTrigger>
              <SelectContent>
                {COMPONENT_RENDERERS.map((r) => (
                  <SelectItem key={r.value} value={r.value} className="text-xs">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Conversion-tab card for form fields already present in YAML.
 * No add/remove — only edit visible / required / default / component_renderer.
 */
export function FormFieldsCard({ fields, onFieldChange }: FormFieldsCardProps) {
  const [editing, setEditing] = useState(false);
  const names = sortFieldNames(Object.keys(fields));

  return (
    <div
      className="rounded-md border bg-muted/20 p-3 space-y-3"
      data-testid="card-form-fields"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconForms className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Fields</span>
        </div>
        {names.length > 0 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setEditing((v) => !v)}
            data-testid="button-edit-form-fields"
          >
            {editing ? <IconX className="h-3.5 w-3.5" /> : <IconPencil className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      <div
        className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground space-y-1.5"
        data-testid="form-fields-source-education"
      >
        <p>
          Choice options can come from a <span className="font-medium text-foreground">source</span>:{" "}
          <code className="font-mono text-[10px]">source.relation</code> reads an entry relation field
          (e.g. <code className="font-mono text-[10px]">programs</code> on _common.yml), or{" "}
          <code className="font-mono text-[10px]">source.name</code> loads a catalog. When source is set,
          option count controls visibility (0 hidden + fallback default, 1 hidden + autofill, 2+ shown
          required). Empty relation blocks publish; empty catalog does not.
        </p>
        <p>
          The form field name (e.g. <code className="font-mono text-[10px]">program</code>) is still the
          submit key — it is not the same as the content-type relation field name. Multiple forms on a
          page that share the same <code className="font-mono text-[10px]">source.relation</code> share
          that one entry field.
        </p>
        <details className="text-[10px]">
          <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
            Read more (advanced)
          </summary>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            <li>
              Resolver: <code className="font-mono">shared/resolveFormFieldRelationSource.ts</code>
            </li>
            <li>
              Parse: <code className="font-mono">shared/parseFormFieldSource.ts</code>
            </li>
            <li>
              Live gate: <code className="font-mono">server/live-entry-seo-gate.ts</code> +{" "}
              <code className="font-mono">shared/validateFormFieldSources.ts</code>
            </li>
            <li>
              Do not combine <code className="font-mono">source.relation</code> with{" "}
              <code className="font-mono">slugs</code> — put allowed pointers on the entry field.
            </li>
          </ul>
        </details>
      </div>

      {names.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="text-form-fields-empty">
          No fields configured in YAML for this form. Add field keys under{" "}
          <code className="font-mono text-[11px]">fields</code> in the section YAML to edit
          visibility, required, defaults, and component renderer here.
        </p>
      ) : !editing ? (
        <div className="space-y-2" data-testid="form-fields-summary">
          {names.map((name) => {
            const summary = summarizeField(fields[name] ?? {});
            return (
              <div key={name} className="flex items-start gap-2 min-w-0">
                <span className="text-xs font-mono w-28 shrink-0 pt-0.5 truncate" title={name}>
                  {name}
                </span>
                <div className="flex flex-wrap gap-1 min-w-0">
                  {summary.length > 0 ? (
                    summary.map((part) => (
                      <Badge
                        key={part}
                        variant="secondary"
                        className="text-[11px] px-1.5 py-0 leading-4 font-normal font-mono"
                      >
                        {part}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">no options set</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2" data-testid="form-fields-editor">
          {names.map((name) => (
            <FormFieldEditorRow
              key={name}
              name={name}
              cfg={fields[name] ?? {}}
              onFieldChange={onFieldChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
