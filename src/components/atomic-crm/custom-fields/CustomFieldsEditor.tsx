import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from "lucide-react";
import { useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  moveItem,
  useDictionaryMutations,
} from "../settings/useDictionaryMutations";
import type { CustomField, CustomFieldEntity, CustomFieldType } from "../types";
import {
  cleanOptions,
  CUSTOM_FIELD_TYPES,
  definitionProblem,
  entityFields,
  LIST_TYPES,
  MAX_CARD_FIELDS,
  templateVariable,
} from "./customFields";
import { useCustomFields } from "./useCustomFields";

const ENTITIES: CustomFieldEntity[] = ["deal", "patient"];

const splitLines = (text: string) => cleanOptions(text.split(/\r?\n/));

/**
 * Settings → Поля (stage 19): the custom fields of deals and patients, like
 * amoCRM. Name, type (fixed once created), options of the lists, required,
 * order, archive; for deals, the two fields shown on the kanban card.
 */
export const CustomFieldsEditor = () => {
  const translate = useTranslate();
  const [entity, setEntity] = useState<CustomFieldEntity>("deal");
  const { data: all } = useCustomFields();
  const fields = entityFields(all, entity, { archived: true }).sort(
    (a, b) => Number(!a.is_active) - Number(!b.is_active),
  );
  const onCard = all.filter((field) => field.show_on_card).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="tablist">
        {ENTITIES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={entity === value}
            onClick={() => setEntity(value)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
              entity === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {translate(`custom_fields.settings.${value}`)}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {translate(`custom_fields.settings.required_hint_${entity}`)}
        {entity === "deal"
          ? ` ${translate("custom_fields.settings.on_card_hint", { max: MAX_CARD_FIELDS })}`
          : null}
      </p>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("custom_fields.settings.empty")}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {fields.map((field, index) => (
            <FieldRow
              key={field.id}
              field={field}
              fields={all}
              siblings={fields.filter((f) => f.is_active)}
              first={index === 0}
              last={index === fields.filter((f) => f.is_active).length - 1}
              cardFull={onCard >= MAX_CARD_FIELDS}
            />
          ))}
        </div>
      )}
      <NewField entity={entity} fields={all} />
    </div>
  );
};

const FieldRow = ({
  field,
  fields,
  siblings,
  first,
  last,
  cardFull,
}: {
  field: CustomField;
  fields: CustomField[];
  siblings: CustomField[];
  first: boolean;
  last: boolean;
  cardFull: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { update, remove } = useDictionaryMutations("custom_fields");
  const [showOptions, setShowOptions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isList = LIST_TYPES.includes(field.type);

  const save = (data: Partial<CustomField>) => {
    const problem = definitionProblem({ ...field, ...data }, fields);
    if (problem) {
      notify(problem, { type: "error", messageArgs: { max: MAX_CARD_FIELDS } });
      return;
    }
    update(field, data);
  };
  const move = (direction: -1 | 1) =>
    moveItem(siblings, field.id, direction).forEach(([record, position]) =>
      update(record, { position }),
    );

  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-3 py-2",
        !field.is_active && "bg-muted/40",
      )}
      data-custom-field-id={field.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!field.is_active || first}
            onClick={() => move(-1)}
            aria-label={translate("crm.settings.move_up")}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!field.is_active || last}
            onClick={() => move(1)}
            aria-label={translate("crm.settings.move_down")}
          >
            <ArrowDown className="size-4" />
          </Button>
        </div>
        <Input
          defaultValue={field.name}
          key={`${field.id}-${field.name}`}
          aria-label={translate("custom_fields.settings.name")}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== field.name) save({ name });
            else event.target.value = field.name;
          }}
          className={cn(
            "h-8 max-w-64",
            !field.is_active && "text-muted-foreground",
          )}
        />
        <span className="min-w-28 text-xs text-muted-foreground">
          {translate(`custom_fields.types.${field.type}`)}
        </span>
        {isList ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setShowOptions((value) => !value)}
            aria-expanded={showOptions}
          >
            <ListChecks className="size-4" />
            {translate("custom_fields.settings.options_count", {
              smart_count: field.options.length,
            })}
          </Button>
        ) : null}
        <span className="flex-1" />
        <ToggleLabel label={translate("custom_fields.settings.required")}>
          <Switch
            checked={field.required}
            disabled={!field.is_active}
            onCheckedChange={(required) => save({ required })}
            aria-label={`${field.name}: ${translate("custom_fields.settings.required")}`}
          />
        </ToggleLabel>
        {field.entity === "deal" ? (
          <ToggleLabel
            label={translate("custom_fields.settings.on_card")}
            title={
              cardFull && !field.show_on_card
                ? translate("custom_fields.errors.card_limit", {
                    max: MAX_CARD_FIELDS,
                  })
                : undefined
            }
          >
            <Switch
              checked={field.show_on_card}
              disabled={!field.is_active || (cardFull && !field.show_on_card)}
              onCheckedChange={(show_on_card) => save({ show_on_card })}
              aria-label={`${field.name}: ${translate("custom_fields.settings.on_card")}`}
            />
          </ToggleLabel>
        ) : null}
        <ToggleLabel label={translate("custom_fields.settings.active")}>
          <Switch
            checked={field.is_active}
            onCheckedChange={(is_active) =>
              save({
                is_active,
                ...(is_active ? {} : { show_on_card: false }),
              })
            }
            aria-label={`${field.name}: ${translate("custom_fields.settings.active")}`}
          />
        </ToggleLabel>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => setConfirmDelete(true)}
          aria-label={translate("ra.action.delete")}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {isList && showOptions ? (
        <div className="flex flex-col gap-1 pl-18">
          <Textarea
            defaultValue={field.options.join("\n")}
            key={field.options.join("|")}
            rows={Math.min(8, Math.max(3, field.options.length + 1))}
            aria-label={`${field.name}: ${translate("custom_fields.settings.options")}`}
            onBlur={(event) => {
              const options = splitLines(event.target.value);
              if (options.join("\n") !== field.options.join("\n")) {
                save({ options });
              }
            }}
            className="max-w-md text-sm"
          />
          <span className="text-xs text-muted-foreground">
            {translate("custom_fields.settings.options_hint")}
          </span>
        </div>
      ) : null}
      {field.entity === "deal" && field.is_active ? (
        <span className="pl-18 text-xs text-muted-foreground">
          {translate("custom_fields.settings.template_hint", {
            variable: `{${templateVariable(field)}}`,
          })}
        </span>
      ) : null}
      <Confirm
        isOpen={confirmDelete}
        title="custom_fields.settings.delete_title"
        titleTranslateOptions={{ name: field.name }}
        content="custom_fields.settings.delete_content"
        confirm="ra.action.delete"
        confirmColor="warning"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove(field);
        }}
      />
    </div>
  );
};

const ToggleLabel = ({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) => (
  <label
    className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    title={title}
  >
    {children}
    {label}
  </label>
);

const NewField = ({
  entity,
  fields,
}: {
  entity: CustomFieldEntity;
  fields: CustomField[];
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { create } = useDictionaryMutations("custom_fields");
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const isList = LIST_TYPES.includes(type);

  const add = () => {
    const definition = {
      entity,
      name: name.trim(),
      type,
      options: isList ? splitLines(options) : [],
      required: false,
      is_active: true,
      show_on_card: false,
      position:
        Math.max(
          -1,
          ...fields.filter((f) => f.entity === entity).map((f) => f.position),
        ) + 1,
    };
    const problem = definitionProblem(definition, fields);
    if (problem) {
      notify(problem, { type: "error", messageArgs: { max: MAX_CARD_FIELDS } });
      return;
    }
    create(definition);
    setName("");
    setOptions("");
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && !isList && add()}
          placeholder={translate("custom_fields.settings.new_name")}
          aria-label={translate("custom_fields.settings.new_name")}
          className="h-9 max-w-72"
        />
        <Select
          value={type}
          onValueChange={(value) => setType(value as CustomFieldType)}
        >
          <SelectTrigger
            className="h-9 w-48"
            aria-label={translate("custom_fields.settings.type")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CUSTOM_FIELD_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {translate(`custom_fields.types.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={add}
          disabled={!name.trim() || (isList && !splitLines(options).length)}
          variant="outline"
        >
          <Plus className="size-4" />
          {translate("custom_fields.settings.add")}
        </Button>
      </div>
      {isList ? (
        <Textarea
          value={options}
          onChange={(event) => setOptions(event.target.value)}
          rows={4}
          placeholder={translate("custom_fields.settings.options_placeholder")}
          aria-label={translate("custom_fields.settings.options")}
          className="max-w-md text-sm"
        />
      ) : null}
    </div>
  );
};
