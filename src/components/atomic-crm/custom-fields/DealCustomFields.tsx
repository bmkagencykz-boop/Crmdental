import { useTranslate } from "ra-core";

import { InlineField } from "../deals/page/InlineField";
import type { CustomField, CustomValue, Deal } from "../types";
import { CustomFieldValue } from "./CustomFieldValue";
import { fromLocalInput } from "./customFields";
import { useEntityFields } from "./useCustomFields";

type Editor = Parameters<typeof InlineField>[0]["editor"];

/** The in-place editor of a field type (deal page, amoCRM style) */
const editorOf = (
  field: CustomField,
  translate: ReturnType<typeof useTranslate>,
): Editor => {
  switch (field.type) {
    case "textarea":
      return { kind: "textarea" };
    case "number":
    case "money":
      return { kind: "number", nullable: true };
    case "date":
      return { kind: "date" };
    case "datetime":
      return { kind: "datetime" };
    case "checkbox":
      return {
        kind: "select",
        choices: [
          { id: "true", name: translate("custom_fields.values.yes") },
          { id: "false", name: translate("custom_fields.values.no") },
        ],
      };
    case "select":
      return {
        kind: "select",
        choices: field.options.map((option) => ({ id: option, name: option })),
      };
    case "multiselect":
      return {
        kind: "multiselect",
        choices: field.options.map((option) => ({ id: option, name: option })),
      };
    default:
      return { kind: "text" };
  }
};

/** What the editor gives back, as a stored value */
const fromEditor = (field: CustomField, value: unknown): CustomValue | null => {
  if (value == null || value === "") return null;
  if (field.type === "checkbox") return value === true || value === "true";
  if (field.type === "datetime") return fromLocalInput(String(value));
  return value as CustomValue;
};

/**
 * «Дополнительные поля» on the deal page, under the standard fields, edited
 * in place like them. The database checks the values and the required
 * fields; its message is shown as is.
 */
export const DealCustomFields = ({
  deal,
  save,
}: {
  deal: Deal;
  save: (data: Partial<Deal>) => void;
}) => {
  const translate = useTranslate();
  const { data: fields } = useEntityFields("deal");
  if (!fields.length) return null;
  const values = deal.custom_values ?? {};

  return (
    <div className="mt-2 flex flex-col border-t border-border pt-2">
      <h4 className="pb-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {translate("custom_fields.section")}
      </h4>
      {fields.map((field) => {
        const key = String(field.id);
        const value = values[key];
        return (
          <InlineField
            key={field.id}
            label={field.required ? `${field.name} *` : field.name}
            value={
              field.type === "checkbox" && value != null ? String(value) : value
            }
            display={
              value == null ? null : (
                <CustomFieldValue field={field} value={value} />
              )
            }
            editor={editorOf(field, translate)}
            onSave={(next) => {
              const stored = fromEditor(field, next);
              const custom_values = { ...values };
              if (stored == null) delete custom_values[key];
              else custom_values[key] = stored;
              save({ custom_values });
            }}
          />
        );
      })}
    </div>
  );
};
