import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";

interface DbFieldValuesPickerProps {
  database: string;
  field: string;
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  /** Render only the options panel (for nesting inside an external popover). */
  panelOnly?: boolean;
}

/**
 * Field editor that fetches a database and shows a searchable multi-select
 * populated from the unique values of a given field.
 *
 * editorType syntax: "db-field-values-picker:database_name:field_name"
 * Example: "db-field-values-picker:frequently_asked_questions:locations"
 */
export function DbFieldValuesPicker({
  database,
  field,
  value,
  onChange,
  label,
  panelOnly = false,
}: DbFieldValuesPickerProps) {
  const displayLabel = label ?? field.replace(/_/g, " ");

  const { data, isLoading } = useQuery<{ items: Record<string, unknown>[] }>({
    queryKey: [`/api/databases/${database}/items`],
    staleTime: 5 * 60 * 1000,
    enabled: !!database && !!field,
  });

  const options = useMemo(() => {
    const items = data?.items ?? [];
    const seen = new Set<string>();
    for (const item of items) {
      const fieldVal = item[field];
      if (Array.isArray(fieldVal)) {
        for (const v of fieldVal) {
          if (v && typeof v === "string") seen.add(v);
        }
      } else if (fieldVal && typeof fieldVal === "string") {
        seen.add(fieldVal);
      }
    }
    return Array.from(seen)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [data, field]);

  return (
    <SearchableMultiSelect
      options={options}
      value={value}
      onChange={onChange}
      label={<span className="capitalize">{displayLabel}</span>}
      searchPlaceholder={`Search ${displayLabel}…`}
      isLoading={isLoading}
      testIdPrefix={field}
      emptyMessage="No values found"
      panelOnly={panelOnly}
    />
  );
}
