import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCreate,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useLeadSources, useServices } from "../dictionaries/useDictionaries";
import {
  previewValues,
  renderTemplate,
  TEMPLATE_VARIABLES,
} from "../providers/commons/automessages";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { MessageTemplate, Sale, Tag } from "../types";
import { cleanSegment } from "./segment";
import type { MailingSegment, MailingSettings } from "./types";

const ANY = "any";

const useDebounced = <T,>(value: T, delay = 400) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

/**
 * A new mailing: the segment (with its live count and preview), the text
 * (a template with the stage 6 variables) and when to start.
 */
export const MailingCreate = ({
  settings,
  onDone,
}: {
  settings: MailingSettings;
  onDone: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const config = useConfigurationContext();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [create, { isPending: saving }] = useCreate();
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<MailingSegment>({ tag_mode: "any" });
  const [templateId, setTemplateId] = useState<Identifier | null>(null);
  const [body, setBody] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    {
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 200 },
    },
  );
  const cleaned = useDebounced(cleanSegment(segment));
  const { data: preview, isFetching } = useQuery({
    queryKey: ["mailingSegmentPreview", cleaned],
    queryFn: () => dataProvider.getSegmentPreview(cleaned),
  });

  const set = (patch: Partial<MailingSegment>) =>
    setSegment((current) => ({ ...current, ...patch }));
  const chooseTemplate = (value: string) => {
    const template = templates.find((t) => String(t.id) === value);
    setTemplateId(template?.id ?? null);
    if (template) {
      setBody(template.body);
      if (!name.trim()) setName(template.name);
    }
  };
  const insert = (variable: string) => {
    const element = textarea.current;
    const token = `{${variable}}`;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const scheduledAt =
    when === "later" && at ? new Date(at).toISOString() : null;
  const count = preview?.count ?? 0;
  const canSave =
    !!name.trim() &&
    !!body.trim() &&
    count > 0 &&
    (when === "now" || !!scheduledAt) &&
    !saving;

  const save = () =>
    create(
      "mailings",
      {
        data: {
          name: name.trim(),
          segment: cleanSegment(segment),
          template_id: templateId,
          body: body.trim(),
          ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
        },
      },
      {
        onSuccess: () => {
          notify("mailings.create.saved", {
            type: "info",
            messageArgs: { smart_count: count },
          });
          queryClient.invalidateQueries({ queryKey: ["mailings_summary"] });
          onDone();
        },
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );

  return (
    <section
      className="flex flex-col gap-5 rounded-lg border bg-card p-5"
      aria-labelledby="mailing-create-title"
      data-testid="mailing-create"
    >
      <h2 id="mailing-create-title" className="text-lg font-semibold">
        {translate("mailings.create.title")}
      </h2>
      <Field label={translate("mailings.create.name")}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="max-w-md"
          aria-label={translate("mailings.create.name")}
        />
      </Field>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <SegmentBuilder segment={segment} onChange={set} />
        <SegmentPreviewPanel
          preview={preview}
          loading={isFetching}
          settings={settings}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Field label={translate("mailings.create.template")}>
            <Select
              value={templateId == null ? "" : String(templateId)}
              onValueChange={chooseTemplate}
            >
              <SelectTrigger
                className="w-72 max-w-full"
                aria-label={translate("mailings.create.template")}
              >
                <SelectValue
                  placeholder={translate(
                    "mailings.create.template_placeholder",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={String(template.id)}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Textarea
            ref={textarea}
            value={body}
            rows={5}
            aria-label={translate("mailings.create.body")}
            placeholder={translate("mailings.create.body_placeholder")}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((variable) => (
              <button
                key={variable}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(variable)}
                className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs text-foreground hover:bg-accent"
              >
                {`{${variable}}`}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {translate("mailings.create.variables_hint")}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {translate("automessages.settings.preview")}
          </span>
          <p className="min-h-16 whitespace-pre-line rounded-md bg-muted px-3 py-2 text-sm">
            {renderTemplate(body, previewValues(config.title))}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={translate("mailings.create.when")}>
          <Select
            value={when}
            onValueChange={(value) => setWhen(value as typeof when)}
          >
            <SelectTrigger
              className="w-48"
              aria-label={translate("mailings.create.when")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="now">
                {translate("mailings.create.now")}
              </SelectItem>
              <SelectItem value="later">
                {translate("mailings.create.later")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {when === "later" ? (
          <Input
            type="datetime-local"
            className="w-56"
            value={at}
            onChange={(event) => setAt(event.target.value)}
            aria-label={translate("mailings.create.at")}
          />
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            {translate("ra.action.cancel")}
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {translate("mailings.create.submit", { smart_count: count })}
          </Button>
        </div>
      </div>
    </section>
  );
};

const SegmentBuilder = ({
  segment,
  onChange,
}: {
  segment: MailingSegment;
  onChange: (patch: Partial<MailingSegment>) => void;
}) => {
  const translate = useTranslate();
  const { data: tags = [] } = useGetList<Tag>("tags", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "last_name", order: "ASC" },
  });
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();

  return (
    <div className="flex flex-col gap-4" data-testid="segment-builder">
      <h3 className="text-sm font-semibold">
        {translate("mailings.segment.title")}
      </h3>
      <Field
        label={translate("mailings.segment.tags")}
        extra={
          <Select
            value={segment.tag_mode ?? "any"}
            onValueChange={(tag_mode) =>
              onChange({ tag_mode: tag_mode as "any" | "all" })
            }
          >
            <SelectTrigger
              className="h-7 w-40 text-xs"
              aria-label={translate("mailings.segment.tag_mode")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">
                {translate("mailings.segment.tag_any")}
              </SelectItem>
              <SelectItem value="all">
                {translate("mailings.segment.tag_all")}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      >
        <Chips
          items={tags.map((t) => ({ id: t.id, name: t.name }))}
          value={segment.tag_ids ?? []}
          onChange={(tag_ids) => onChange({ tag_ids })}
          testId="segment-tags"
        />
      </Field>
      <Field label={translate("mailings.segment.services")}>
        <Chips
          items={services}
          value={segment.service_ids ?? []}
          onChange={(service_ids) => onChange({ service_ids })}
        />
      </Field>
      <Field label={translate("mailings.segment.sources")}>
        <Chips
          items={sources}
          value={segment.source_ids ?? []}
          onChange={(source_ids) => onChange({ source_ids })}
        />
      </Field>
      <Field label={translate("mailings.segment.sales")}>
        <Chips
          items={sales.map((s) => ({
            id: s.id,
            name: `${s.first_name} ${s.last_name}`,
          }))}
          value={segment.sales_ids ?? []}
          onChange={(sales_ids) => onChange({ sales_ids })}
        />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field label={translate("mailings.segment.inactive")}>
          <div className="flex items-center gap-2 text-sm">
            <Input
              type="number"
              min={1}
              className="w-20"
              value={segment.inactive_months ?? ""}
              aria-label={translate("mailings.segment.inactive")}
              onChange={(event) =>
                onChange({
                  inactive_months: event.target.value
                    ? Math.max(1, Math.round(Number(event.target.value)))
                    : null,
                })
              }
            />
            <span className="text-muted-foreground">
              {translate("mailings.segment.months")}
            </span>
          </div>
        </Field>
        <Field label={translate("mailings.segment.open_deal")}>
          <Select
            value={
              segment.has_open_deal == null
                ? ANY
                : segment.has_open_deal
                  ? "yes"
                  : "no"
            }
            onValueChange={(value) =>
              onChange({
                has_open_deal: value === ANY ? null : value === "yes",
              })
            }
          >
            <SelectTrigger
              className="w-44"
              aria-label={translate("mailings.segment.open_deal")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>
                {translate("mailings.segment.any")}
              </SelectItem>
              <SelectItem value="yes">
                {translate("mailings.segment.yes")}
              </SelectItem>
              <SelectItem value="no">
                {translate("mailings.segment.no")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </div>
  );
};

const SegmentPreviewPanel = ({
  preview,
  loading,
  settings,
}: {
  preview:
    | Awaited<ReturnType<CrmDataProvider["getSegmentPreview"]>>
    | undefined;
  loading: boolean;
  settings: MailingSettings;
}) => {
  const translate = useTranslate();
  const count = preview?.count ?? 0;
  const days = Math.max(1, Math.ceil(count / settings.per_day));
  return (
    <aside
      className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4"
      aria-live="polite"
    >
      <div>
        <span className="text-xs text-muted-foreground">
          {translate("mailings.preview.recipients")}
        </span>
        <p
          className={cn(
            "text-3xl font-semibold tabular-nums",
            loading && "opacity-60",
          )}
          data-testid="segment-count"
        >
          {preview ? count : "…"}
        </p>
      </div>
      {preview ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          <li>
            {translate("mailings.preview.matched", {
              smart_count: preview.matched,
            })}
          </li>
          {preview.opted_out ? (
            <li>
              {translate("mailings.preview.opted_out", {
                smart_count: preview.opted_out,
              })}
            </li>
          ) : null}
          {preview.no_contact ? (
            <li>
              {translate("mailings.preview.no_contact", {
                smart_count: preview.no_contact,
              })}
            </li>
          ) : null}
          {preview.duplicates ? (
            <li>
              {translate("mailings.preview.duplicates", {
                smart_count: preview.duplicates,
              })}
            </li>
          ) : null}
        </ul>
      ) : null}
      {preview?.patients.length ? (
        <ul
          className="flex max-h-56 flex-col gap-1 overflow-auto text-sm"
          data-testid="segment-patients"
        >
          {preview.patients.map((patient) => (
            <li key={patient.id} className="flex justify-between gap-2">
              <span className="truncate">
                {[patient.last_name, patient.first_name]
                  .filter(Boolean)
                  .join(" ") || "—"}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {patient.phone}
              </span>
            </li>
          ))}
          {count > preview.patients.length ? (
            <li className="text-xs text-muted-foreground">
              {translate("mailings.preview.more", {
                smart_count: count - preview.patients.length,
              })}
            </li>
          ) : null}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {translate("mailings.preview.pace", {
          per_minute: settings.per_minute,
          per_day: settings.per_day,
          start: settings.work_start,
          end: settings.work_end,
          smart_count: days,
        })}
      </p>
    </aside>
  );
};

const Field = ({
  label,
  extra,
  children,
}: {
  label: string;
  extra?: ReactNode;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {extra}
    </div>
    {children}
  </div>
);

/** Toggle buttons for a multiple choice */
const Chips = ({
  items,
  value,
  onChange,
  testId,
}: {
  items: { id: Identifier; name: string }[];
  value: Identifier[];
  onChange: (value: Identifier[]) => void;
  testId?: string;
}) => {
  const translate = useTranslate();
  if (!items.length) {
    return (
      <span className="text-sm text-muted-foreground">
        {translate("mailings.segment.nothing")}
      </span>
    );
  }
  const selected = new Set(value.map(String));
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {items.map((item) => {
        const active = selected.has(String(item.id));
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? value.filter((id) => String(id) !== String(item.id))
                  : [...value, item.id],
              )
            }
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-accent",
            )}
          >
            {item.name}
          </button>
        );
      })}
    </div>
  );
};
