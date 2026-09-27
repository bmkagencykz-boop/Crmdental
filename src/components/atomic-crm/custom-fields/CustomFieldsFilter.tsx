import { useInput, useTranslate } from "ra-core";

import type { CustomField, CustomValue } from "../types";
import {
  CUSTOM_VALUES_FILTER,
  filterableFields,
  parseCustomFilter,
  toCustomFilter,
} from "./customFields";
import { useCustomFields } from "./useCustomFields";

const selectClass =
  "h-9 max-w-48 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Value of a choice → stored value, and back */
const encode = (value: CustomValue | undefined) =>
  value === undefined
    ? ""
    : Array.isArray(value)
      ? String(value[0] ?? "")
      : String(value);
const decode = (field: CustomField, raw: string): CustomValue | null => {
  if (raw === "") return null;
  if (field.type === "checkbox") return raw === "true";
  if (field.type === "multiselect") return [raw];
  return raw;
};

/**
 * Filter of the deals by their list and checkbox custom fields (stage 19):
 * one select per field, all of them together in custom_values@cs — jsonb
 * containment, e.g. {"12": "Инстаграм", "15": true}.
 */
export const CustomFieldsFilter = ({
  source = CUSTOM_VALUES_FILTER,
}: {
  source?: string;
  alwaysOn?: boolean;
}) => {
  const translate = useTranslate();
  const { data } = useCustomFields();
  const fields = filterableFields(data);
  const { field: input } = useInput({ source });
  const selection = parseCustomFilter(input.value);

  const change = (field: CustomField, raw: string) => {
    const next: Record<string, CustomValue | null> = { ...selection };
    next[String(field.id)] = decode(field, raw);
    input.onChange(toCustomFilter(next) ?? "");
  };

  if (!fields.length) return null;
  return (
    <div
      className="flex flex-wrap items-end gap-2"
      role="group"
      aria-label={translate("custom_fields.filter.label")}
    >
      {fields.map((field) => (
        <select
          key={field.id}
          value={encode(selection[String(field.id)])}
          onChange={(event) => change(field, event.target.value)}
          aria-label={field.name}
          className={selectClass}
        >
          <option value="">{field.name}</option>
          {field.type === "checkbox" ? (
            <>
              <option value="true">
                {field.name}: {translate("custom_fields.values.yes")}
              </option>
              <option value="false">
                {field.name}: {translate("custom_fields.values.no")}
              </option>
            </>
          ) : (
            field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))
          )}
        </select>
      ))}
    </div>
  );
};
