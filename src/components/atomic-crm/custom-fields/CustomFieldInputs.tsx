import { useInput, useTranslate } from "ra-core";
import { useWatch } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useStages } from "../dictionaries/useDictionaries";
import type {
  CustomField,
  CustomFieldEntity,
  CustomValue,
  CustomValues,
} from "../types";
import {
  customValuesProblem,
  dealChecksRequired,
  fromLocalInput,
  toLocalInput,
} from "./customFields";
import { useEntityFields } from "./useCustomFields";

const controlClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The control of one custom field: text, number, date, list... Empty values
 * are null (the key is removed). The database normalizes what is typed.
 */
export const CustomValueControl = ({
  field,
  value,
  onChange,
  id,
  invalid,
}: {
  field: CustomField;
  value: CustomValue | null | undefined;
  onChange: (value: CustomValue | null) => void;
  id?: string;
  invalid?: boolean;
}) => {
  const translate = useTranslate();
  const text = (next: string) => onChange(next === "" ? null : next);

  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          value={value == null ? "" : String(value)}
          onChange={(event) => text(event.target.value)}
          rows={3}
          aria-invalid={invalid}
        />
      );
    case "number":
    case "money":
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={field.type === "money" ? 0 : undefined}
          step={field.type === "money" ? 1000 : "any"}
          value={value == null ? "" : String(value)}
          onChange={(event) => text(event.target.value)}
          aria-invalid={invalid}
        />
      );
    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={value == null ? "" : String(value)}
          onChange={(event) => text(event.target.value)}
          aria-invalid={invalid}
        />
      );
    case "datetime":
      return (
        <Input
          id={id}
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(event) => onChange(fromLocalInput(event.target.value))}
          aria-invalid={invalid}
        />
      );
    case "checkbox":
      return (
        <label className="flex h-9 items-center gap-2 text-sm">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
            aria-invalid={invalid}
          />
          {translate(
            value === true
              ? "custom_fields.values.yes"
              : "custom_fields.values.no",
          )}
        </label>
      );
    case "select":
      return (
        <select
          id={id}
          value={value == null ? "" : String(value)}
          onChange={(event) => text(event.target.value)}
          aria-invalid={invalid}
          className={cn(controlClass, "bg-background")}
        >
          <option value="">{translate("custom_fields.values.none")}</option>
          {value != null && !field.options.includes(String(value)) ? (
            <option value={String(value)}>{String(value)}</option>
          ) : null}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const chosen = Array.isArray(value) ? value : [];
      const options = [
        ...field.options,
        ...chosen.filter((option) => !field.options.includes(option)),
      ];
      return (
        <div
          id={id}
          role="group"
          aria-invalid={invalid}
          className="flex flex-wrap gap-x-4 gap-y-1.5 py-1.5"
        >
          {options.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={chosen.includes(option)}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? field.options.filter(
                        (o) => o === option || chosen.includes(o),
                      )
                    : chosen.filter((o) => o !== option);
                  onChange(next.length ? next : null);
                }}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    default:
      return (
        <Input
          id={id}
          type={
            field.type === "url"
              ? "url"
              : field.type === "phone"
                ? "tel"
                : "text"
          }
          placeholder={
            field.type === "phone"
              ? "+7 7__ ___ __ __"
              : field.type === "url"
                ? "https://"
                : undefined
          }
          value={value == null ? "" : String(value)}
          onChange={(event) => text(event.target.value)}
          aria-invalid={invalid}
        />
      );
  }
};

/** Whether the required fields apply to the deal being edited in a form */
const useDealRequired = () => {
  const { data: stages } = useStages();
  const pipelineId = useWatch({ name: "pipeline_id" });
  const stageId = useWatch({ name: "stage_id" });
  if (pipelineId == null || stageId == null) return false;
  return dealChecksRequired({
    stages,
    deal: { pipeline_id: pipelineId, stage_id: stageId },
    isNew: true,
    stageChanged: false,
    valuesChanged: false,
  });
};

/**
 * «Дополнительные поля» of a form (deal or patient): one control per
 * active field, stored in `custom_values`. The required fields are checked
 * like the database: deals outside the first stage, patients always.
 */
export const CustomFieldInputs = ({
  entity,
  className,
}: {
  entity: CustomFieldEntity;
  className?: string;
}) => {
  const { data: fields } = useEntityFields(entity);
  if (!fields.length) return null;
  return entity === "deal" ? (
    <DealCustomFieldInputs fields={fields} className={className} />
  ) : (
    <CustomFieldControls
      fields={fields}
      entity={entity}
      required
      className={className}
    />
  );
};

const DealCustomFieldInputs = ({
  fields,
  className,
}: {
  fields: CustomField[];
  className?: string;
}) => {
  const required = useDealRequired();
  return (
    <CustomFieldControls
      fields={fields}
      entity="deal"
      required={required}
      className={className}
    />
  );
};

const CustomFieldControls = ({
  fields,
  entity,
  required,
  className,
}: {
  fields: CustomField[];
  entity: CustomFieldEntity;
  required: boolean;
  className?: string;
}) => {
  const translate = useTranslate();
  const {
    field: input,
    fieldState: { error, invalid },
  } = useInput<CustomValues>({
    source: "custom_values",
    defaultValue: {},
    validate: (value: CustomValues | undefined) =>
      customValuesProblem(fields, entity, value ?? {}, { required }),
  });
  const values: CustomValues = input.value ?? {};
  const change = (fieldId: string, value: CustomValue | null) => {
    const next = { ...values };
    if (value == null) delete next[fieldId];
    else next[fieldId] = value;
    input.onChange(next);
  };

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {translate("custom_fields.section")}
      </h3>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        {fields.map((field) => {
          const id = `custom-field-${field.id}`;
          const wide =
            field.type === "textarea" || field.type === "multiselect";
          return (
            <div
              key={field.id}
              className={cn("flex flex-col gap-1.5", wide && "md:col-span-2")}
            >
              <label htmlFor={id} className="text-sm font-medium">
                {field.name}
                {field.required && (entity === "patient" || required) ? (
                  <span className="text-destructive"> *</span>
                ) : null}
              </label>
              <CustomValueControl
                id={id}
                field={field}
                value={values[String(field.id)]}
                onChange={(value) => change(String(field.id), value)}
              />
            </div>
          );
        })}
      </div>
      {invalid && error?.message ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
};
