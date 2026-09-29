import type { Identifier } from "ra-core";

import { formatMoney } from "../deals/kanbanFormat";
import {
  formatDuration,
  toReportFilters,
  type ReportPeriod,
} from "../reports/format";
import {
  changeFieldId,
  displayCustomValue,
} from "../custom-fields/customFields";
import type { AuditLogEntry, CustomField } from "../types";

/**
 * Pure formatting of the audit log (stage 15): values, human-readable
 * summaries of the changes, authors, filters. The labels come from the
 * `audit` namespace of the message catalogs.
 */

export type Translate = (key: string, options?: any) => string;

type Named = { id: Identifier; name: string };
type Person = { id: Identifier; first_name: string; last_name: string };

/** Dictionaries the values refer to */
export type AuditLookups = {
  currency: string;
  sales: Person[];
  stages: Named[];
  pipelines: Named[];
  lostReasons: Named[];
  sources: Named[];
  services: Named[];
  tags: Named[];
  doctors: Named[];
  /** Custom fields (stage 19), archived ones too: "cf:<id>" changes */
  customFields?: CustomField[];
};

const MONEY_FIELDS = new Set([
  "plan_amount",
  "paid_amount",
  "amount",
  "consultation_amount",
  // Treatment plans and the price list (stage 29)
  "unit_price",
  "discount_amount",
  "price",
  // The cash desk (stage 36)
  "opening_cash",
  "expected_cash",
  "counted_cash",
  "cash_received",
]);
const DATE_TIME_FIELDS = new Set([
  "due_date",
  "done_date",
  "appointment_at",
  "visit_at",
  "archived_at",
  "unsorted_at",
  "scheduled_at",
  "revoked_at",
  "occurred_at",
  "closed_at",
]);
const DATE_FIELDS = new Set([
  "paid_at",
  "month",
  // Lab work orders (stage 40)
  "sent_at",
  "fitting1_at",
  "fitting2_at",
  "due_at",
  "ready_at",
  "delivered_at",
]);
const BOOLEAN_FIELDS = new Set([
  "disabled",
  "is_active",
  "is_default",
  "connected",
  "unsorted_enabled",
]);
/** Values translated through audit.values.<field>.<value> */
const ENUM_FIELDS = new Set([
  "role",
  "kind",
  "type",
  "event",
  "manager_deal_visibility",
  "lead_distribution",
  "pipeline_move_mode",
  "provider",
]);
const REFERENCES: Record<
  string,
  keyof Omit<AuditLookups, "currency" | "customFields">
> = {
  sales_id: "sales",
  stage_id: "stages",
  pipeline_id: "pipelines",
  lost_reason_id: "lostReasons",
  source_id: "sources",
  service_id: "services",
  doctor_id: "doctors",
  preferred_doctor_id: "doctors",
  target_stage_id: "stages",
  target_sales_id: "sales",
  tag_id: "tags",
};
const LIST_REFERENCES: Record<
  string,
  keyof Omit<AuditLookups, "currency" | "customFields">
> = {
  tags: "tags",
  lead_distribution_sales_ids: "sales",
  unsorted_source_ids: "sources",
};

/** Entity types of the filter, and the logged entities they cover */
export const AUDIT_ENTITY_GROUPS = {
  deal: [
    "deal",
    "file",
    "treatment_plan",
    "treatment_plan_item",
    "treatment_stage",
  ],
  patient: [
    "patient",
    // The full patient card (stage 37)
    "patient_tooth",
    "visit_record",
    "patient_questionnaire",
    "patient_consent",
    "patient_file",
    // The waiting list (stage 38)
    "waiting_list",
    // Lab work orders (stage 40)
    "lab_order",
    "lab_order_item",
    "lab_order_price",
  ],
  payment: ["payment", "account_operation", "cash_shift"],
  task: ["task"],
  employee: [
    "employee",
    "access_rights",
    // Payroll (stage 39)
    "payroll_scheme",
    "payroll_adjustment",
    "payroll_month",
  ],
  settings: [
    "pipeline",
    "stage",
    "settings",
    "task_rule",
    "checklist_item",
    "messenger",
    "custom_field",
    "sales_plan",
    "mailing",
    "stage_trigger",
    "webhook",
    "api_key",
    "mis_connection",
    "salesbot",
    "service",
    "ad_spend",
    "branch",
    "treatment_stage_template",
    "consent_template",
    "visit_record_template",
    "lab",
    "lab_technician",
    "lab_work_type",
    "lab_work_type_price",
  ],
} as const;
export type AuditEntityGroup = keyof typeof AUDIT_ENTITY_GROUPS;

const EMPTY = "—";

const pad = (n: number) => String(n).padStart(2, "0");

/** 27.09.2026 14:05 in the browser's time zone */
export const formatAuditTime = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 2026-09-27 (a date without time) → 27.09.2026 */
const formatDay = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
};

export const personName = (person?: Partial<Person> | null) =>
  person ? [person.first_name, person.last_name].filter(Boolean).join(" ") : "";

const findName = (
  list: Array<Named | Person>,
  id: unknown,
): string | undefined => {
  const found = list.find((item) => String(item.id) === String(id));
  if (!found) return undefined;
  return "name" in found ? found.name : personName(found);
};

/** One value of a field, as people read it: names, money, dates, yes/no */
export const formatAuditValue = (
  field: string,
  value: unknown,
  lookups: AuditLookups,
  translate: Translate,
): string => {
  if (value == null || value === "") return EMPTY;
  if (Array.isArray(value)) {
    if (!value.length) return EMPTY;
    const list = LIST_REFERENCES[field];
    return value
      .map((item) =>
        list ? (findName(lookups[list], item) ?? `#${item}`) : String(item),
      )
      .join(", ");
  }
  if (MONEY_FIELDS.has(field)) {
    return formatMoney(Number(value), lookups.currency);
  }
  if (DATE_TIME_FIELDS.has(field)) return formatAuditTime(String(value));
  if (DATE_FIELDS.has(field)) return formatDay(String(value));
  if (BOOLEAN_FIELDS.has(field) || typeof value === "boolean") {
    return translate(value ? "audit.values.yes" : "audit.values.no");
  }
  if (field === "due_in_minutes") return formatDuration(Number(value) * 60);
  if (ENUM_FIELDS.has(field)) {
    return translate(`audit.values.${field}.${value}`, {
      // Events of the digital pipeline triggers (stage 20)
      _:
        field === "event"
          ? translate(`pipeline_automation.events.${value}`, {
              _: String(value),
            })
          : String(value),
    });
  }
  const list = REFERENCES[field];
  if (list) return findName(lookups[list], value) ?? `#${value}`;
  return String(value);
};

/**
 * A custom field change ("cf:<id>", stage 19): the name of the field and
 * its values as the screens show them. A deleted field reads «Поле #12».
 */
const customChange = (
  key: string,
  lookups: AuditLookups,
  translate: Translate,
) => {
  const id = changeFieldId(key);
  if (id == null) return null;
  const field = lookups.customFields?.find((f) => String(f.id) === id);
  return {
    label: field?.name ?? translate("custom_fields.audit.unknown", { id }),
    format: (value: unknown) =>
      (field
        ? displayCustomValue(field, value as never, {
            formatMoney: (amount) => formatMoney(amount, lookups.currency),
            yes: translate("audit.values.yes"),
            no: translate("audit.values.no"),
          })
        : value == null
          ? null
          : Array.isArray(value)
            ? value.join(", ")
            : String(value)) ?? EMPTY,
  };
};

/** Fields of a custom field definition (entity custom_field) */
const definitionChange = (field: string, translate: Translate) => ({
  label: translate(`custom_fields.audit.fields.${field}`, { _: field }),
  format: (value: unknown) =>
    value == null || value === ""
      ? EMPTY
      : field === "type"
        ? translate(`custom_fields.types.${value}`, { _: String(value) })
        : field === "entity"
          ? translate(`custom_fields.entities.${value}`, { _: String(value) })
          : typeof value === "boolean"
            ? translate(value ? "audit.values.yes" : "audit.values.no")
            : Array.isArray(value)
              ? value.length
                ? value.join(", ")
                : EMPTY
              : String(value),
});

/**
 * A cell of the access rights (stage 30): «Сделки · Просмотр: Все → Только
 * свои»
 */
const accessRightsChange = (field: string, translate: Translate) => {
  const [entity, action] = field.split(".");
  return {
    label: `${translate(`access_rights.entities.${entity}`, { _: entity })} · ${translate(`access_rights.actions.${action}`, { _: action })}`,
    format: (value: unknown) =>
      value == null
        ? EMPTY
        : translate(
            entity === "reports" || action === "create"
              ? `access_rights.scopes.${value === "all" ? "yes" : "no"}`
              : // «Мой филиал» (stage 33)
                value === "branch"
                ? "branches.scope"
                : `access_rights.scopes.${value}`,
            { _: String(value) },
          ),
  };
};

/** Actions that only have an "after" (or a "before") side */
const CREATION_ACTIONS = new Set(["create", "invite"]);
const DELETION_ACTIONS = new Set(["delete"]);

/**
 * One line per changed field: «Этап: В работе → Записан»,
 * «Сумма: 100 000 ₸ → 120 000 ₸». A created or deleted row shows its values.
 */
export const describeAuditChanges = (
  entry: Pick<AuditLogEntry, "action" | "changes"> &
    Partial<Pick<AuditLogEntry, "entity">>,
  lookups: AuditLookups,
  translate: Translate,
): string[] =>
  Object.entries(entry.changes ?? {})
    // A merge of patients (stage 18) names both patients with their ids
    .filter(
      ([field]) =>
        !(field === "merged_patient_id" && "merged_patient" in entry.changes),
    )
    .map(([field, pair]) => {
      const [before, after] = Array.isArray(pair) ? pair : [null, pair];
      const entity = (entry as Partial<AuditLogEntry>).entity as
        | string
        | undefined;
      const special =
        customChange(field, lookups, translate) ??
        (entity === "access_rights"
          ? accessRightsChange(field, translate)
          : entity === "custom_field"
            ? definitionChange(field, translate)
            : entity === "account_operation" &&
                ["kind", "method", "account", "parts"].includes(field)
              ? operationChange(field, translate)
              : entity === "patient_tooth" && field === "state"
                ? {
                    label: translate("patient_card.audit.fields.state"),
                    format: (value: unknown) =>
                      value == null
                        ? EMPTY
                        : translate(`patient_card.chart.states.${value}`, {
                            _: String(value),
                          }),
                  }
                : entity === "treatment_stage" && field === "status"
                  ? {
                      label: translate("plan_editor.stages.fields.status"),
                      format: (value: unknown) =>
                        value == null
                          ? EMPTY
                          : translate(`plan_editor.stages.statuses.${value}`, {
                              _: String(value),
                            }),
                    }
                  : entity === "waiting_list"
                    ? waitingListChange(field, translate)
                    : entity === "lab_order" && field === "status"
                      ? {
                          label: translate("lab.fields.status"),
                          format: (value: unknown) =>
                            value == null
                              ? EMPTY
                              : translate(`lab.statuses.${value}`, {
                                  _: String(value),
                                }),
                        }
                      : entity === "treatment_plan" && field === "status"
                        ? {
                            label: translate("treatment.audit.fields.status"),
                            format: (value: unknown) =>
                              value == null
                                ? EMPTY
                                : translate(`treatment.statuses.${value}`, {
                                    _: String(value),
                                  }),
                          }
                        : null);
      // Fields of the treatment plans and the patient card (stage 29)
      const label =
        special?.label ??
        translate(`audit.fields.${field}`, {
          _: translate(`treatment.audit.fields.${field}`, {
            // The plan editor (stage 34)
            _: translate(`plan_editor.audit.fields.${field}`, {
              // Ad spend (stage 32), branches (stage 33)
              _: translate(`marketing.audit.fields.${field}`, {
                _: translate(`branches.audit.fields.${field}`, {
                  // The cash desk (stage 36)
                  _: translate(`payments.audit.fields.${field}`, {
                    // The patient card (stage 37)
                    _: translate(`patient_card.audit.fields.${field}`, {
                      // The payroll (stage 39)
                      _: translate(`payroll.audit.fields.${field}`, {
                        // The waiting list (stage 38)
                        _: translate(`waiting_list.audit.fields.${field}`, {
                          _: translate(`lab.fields.${field}`, { _: field }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        });
      const format = (value: unknown) =>
        special
          ? special.format(value)
          : formatAuditValue(field, value, lookups, translate);
      if (CREATION_ACTIONS.has(entry.action))
        return `${label}: ${format(after)}`;
      if (DELETION_ACTIONS.has(entry.action))
        return `${label}: ${format(before)}`;
      return `${label}: ${format(before)} → ${format(after)}`;
    });

/**
 * Fields of an entry of the waiting list (stage 38) with their own values:
 * status, priority, days of the week, parts of the day
 */
const waitingListChange = (field: string, translate: Translate) => {
  const choice = (key: string) => (value: unknown) =>
    value == null
      ? EMPTY
      : translate(key.replace("*", String(value)), { _: String(value) });
  const list = (key: string) => (value: unknown) =>
    Array.isArray(value) && value.length
      ? value.map((item) => choice(key)(item)).join(", ")
      : translate("waiting_list.any");
  const format =
    field === "status"
      ? choice("waiting_list.statuses.*")
      : field === "priority"
        ? choice("waiting_list.priorities.*")
        : field === "weekdays"
          ? list("waiting_list.weekdays_short.*")
          : field === "day_parts"
            ? list("waiting_list.day_parts.*")
            : null;
  return format
    ? { label: translate(`waiting_list.audit.fields.${field}`), format }
    : null;
};

/** Fields of an account operation (stage 36): its kind, method, parts */
const operationChange = (field: string, translate: Translate) => ({
  label: translate(`payments.audit.fields.${field}`),
  format: (value: unknown) => {
    if (value == null) return EMPTY;
    if (field === "parts") {
      return Array.isArray(value)
        ? value
            .map(
              (part: { method?: string; amount?: number }) =>
                `${translate(`payments.methods.${part.method}`, { _: String(part.method) })} ${formatMoney(Number(part.amount ?? 0), "KZT")}`,
            )
            .join(" + ")
        : EMPTY;
    }
    const namespace =
      field === "kind" ? "kinds" : field === "method" ? "methods" : "accounts";
    return translate(`payments.${namespace}.${value}`, { _: String(value) });
  },
});

export const auditSummary = (
  entry: Pick<AuditLogEntry, "action" | "changes"> &
    Partial<Pick<AuditLogEntry, "entity">>,
  lookups: AuditLookups,
  translate: Translate,
) => describeAuditChanges(entry, lookups, translate).join("; ");

/** Who did it: the employee, else the source («Автоматически», «Вебхук») */
export const auditActor = (
  entry: Pick<AuditLogEntry, "sales_id" | "source">,
  lookups: AuditLookups,
  translate: Translate,
) => {
  if (entry.sales_id != null) {
    return findName(lookups.sales, entry.sales_id) ?? `#${entry.sales_id}`;
  }
  return translate(`audit.sources.${entry.source}`, { _: entry.source });
};

export const auditActionLabel = (
  entry: Pick<AuditLogEntry, "action">,
  translate: Translate,
) =>
  // Rights back to the role's (stage 30)
  entry.action === "reset"
    ? translate("access_rights.audit.reset")
    : translate(`audit.actions.${entry.action}`, { _: entry.action });

const changedName = (entry: AuditLogEntry, field = "name") => {
  const pair = entry.changes?.[field];
  if (!Array.isArray(pair)) return undefined;
  return (pair[1] ?? pair[0]) as string | undefined;
};

/** Entities of the schedule (stage 28), labels in the «schedule» namespace */
const SCHEDULE_ENTITIES = [
  "visit",
  "chair",
  "doctor_exception",
  "schedule_settings",
];

/**
 * What was changed: «Сделка «Имплантация»», «Пациент Ахметов Даулет»,
 * «Этап «Записан»»...
 */
export const auditEntityLabel = (
  entry: AuditLogEntry,
  lookups: AuditLookups,
  translate: Translate,
) => {
  const kind =
    entry.entity === "access_rights"
      ? translate("access_rights.audit.entity")
      : entry.entity === "custom_field"
        ? translate("custom_fields.audit.entity")
        : entry.entity === "mis_connection"
          ? translate("mis_connectors.audit.entity")
          : entry.entity === "ad_spend"
            ? translate("marketing.audit.entity")
            : entry.entity === "branch"
              ? translate("branches.audit.entity")
              : LAB_ENTITIES.includes(entry.entity)
                ? translate(`lab.audit.${entry.entity}`)
                : PAYROLL_ENTITIES.includes(entry.entity)
                  ? translate(`payroll.audit.${entry.entity}`)
                  : PAYMENT_ENTITIES.includes(entry.entity)
                    ? translate(`payments.audit.${entry.entity}`)
                    : entry.entity === "waiting_list"
                      ? translate("waiting_list.audit.entity")
                      : PATIENT_CARD_ENTITIES.includes(entry.entity)
                        ? translate(`patient_card.audit.${entry.entity}`)
                        : SCHEDULE_ENTITIES.includes(entry.entity)
                          ? translate(`schedule.audit.${entry.entity}`)
                          : PLAN_EDITOR_ENTITIES.includes(entry.entity)
                            ? translate(`plan_editor.audit.${entry.entity}`)
                            : TREATMENT_ENTITIES.includes(entry.entity)
                              ? translate(`treatment.audit.${entry.entity}`)
                              : translate(`audit.entities.${entry.entity}`, {
                                  _: entry.entity,
                                });
  const ref = entry.entity_id != null ? `#${entry.entity_id}` : "";
  let name: string | undefined;
  switch (entry.entity) {
    case "deal":
    case "payment":
    case "task":
    case "visit":
      name =
        entry.deal_name ??
        (entry.entity === "deal" ? changedName(entry) : undefined) ??
        (entry.deal_id != null ? `#${entry.deal_id}` : undefined);
      break;
    case "account_operation":
    case "waiting_list":
    case "visit_record":
    case "patient_questionnaire":
    case "lab_order_price":
      name = entry.patient_name ?? undefined;
      break;
    case "lab_order":
      name = [
        entry.patient_name,
        `№ ${changedName(entry, "number") ?? entry.entity_id}`,
      ]
        .filter(Boolean)
        .join(", ");
      break;
    case "lab_order_item":
    case "lab":
    case "lab_technician":
    case "lab_work_type":
      name = changedName(entry) ?? ref;
      break;
    case "patient_tooth": {
      const tooth = changedName(entry, "tooth");
      name = [entry.patient_name, tooth != null ? `№ ${tooth}` : null]
        .filter(Boolean)
        .join(", ");
      break;
    }
    case "patient_consent":
      name = changedName(entry, "title") ?? ref;
      break;
    case "patient_file":
    case "consent_template":
    case "visit_record_template":
      name = changedName(entry) ?? ref;
      break;
    case "patient":
      name =
        entry.patient_name ??
        ([changedName(entry, "last_name"), changedName(entry, "first_name")]
          .filter(Boolean)
          .join(" ") ||
          ref);
      break;
    case "employee":
    case "access_rights":
      name = findName(lookups.sales, entry.entity_id) ?? ref;
      break;
    case "stage":
      name = findName(lookups.stages, entry.entity_id) ?? changedName(entry);
      break;
    case "pipeline":
      name = findName(lookups.pipelines, entry.entity_id) ?? changedName(entry);
      break;
    case "custom_field":
      name =
        lookups.customFields?.find(
          (field) => String(field.id) === String(entry.entity_id),
        )?.name ??
        changedName(entry) ??
        ref;
      break;
    case "task_rule":
    case "checklist_item":
      name = changedName(entry, "text") ?? ref;
      break;
    case "file":
      name = changedName(entry) ?? ref;
      break;
    case "stage_trigger":
    case "api_key":
    case "salesbot":
    case "treatment_plan":
    case "treatment_plan_item":
    case "treatment_stage":
    case "treatment_stage_template":
    case "service":
      name = changedName(entry) ?? ref;
      break;
    case "webhook":
      name = changedName(entry) ?? changedName(entry, "url") ?? ref;
      break;
    default:
      name = undefined;
  }
  if (!name) return kind;
  const quoted = [
    "deal",
    "payment",
    "task",
    "stage",
    "pipeline",
    "file",
    "custom_field",
    ...TREATMENT_ENTITIES,
    ...PLAN_EDITOR_ENTITIES,
  ].includes(entry.entity)
    ? `«${name}»`
    : name;
  return `${kind} ${quoted}`;
};

/** Entities of the patient card (stage 37), labelled in its namespace */
const PATIENT_CARD_ENTITIES = [
  "patient_tooth",
  "visit_record",
  "patient_questionnaire",
  "patient_consent",
  "patient_file",
  "consent_template",
  "visit_record_template",
];

/** Entities of the payroll (stage 39), labelled in its namespace */
const PAYROLL_ENTITIES = [
  "payroll_scheme",
  "payroll_adjustment",
  "payroll_month",
];

/** Entities of the lab work orders (stage 40), labelled in its namespace */
const LAB_ENTITIES = [
  "lab_order",
  "lab_order_item",
  "lab_order_price",
  "lab",
  "lab_technician",
  "lab_work_type",
  "lab_work_type_price",
];

/** Entities of the cash desk (stage 36), labelled in its namespace */
const PAYMENT_ENTITIES = ["account_operation", "cash_shift"];

/** Entities of stage 29, labelled in the treatment namespace */
const TREATMENT_ENTITIES: string[] = [
  "treatment_plan",
  "treatment_plan_item",
  "service",
];

/** Entities of stage 34, labelled in the plan_editor namespace */
const PLAN_EDITOR_ENTITIES: string[] = [
  "treatment_stage",
  "treatment_stage_template",
];

/** The deal page, else the patient page */
export const auditEntityLink = (entry: AuditLogEntry) => {
  if (entry.deal_id != null) return `/deals/${entry.deal_id}/show`;
  if (entry.patient_id != null) return `/patients/${entry.patient_id}/show`;
  return null;
};

/** Filters of the journal screen */
export type AuditFilterState = {
  period: ReportPeriod;
  /** Custom period, local dates YYYY-MM-DD, both included */
  from?: string | null;
  to?: string | null;
  /** An employee id, or "system" for the actions without an employee */
  sales_id?: string | null;
  entity?: AuditEntityGroup | null;
  /** Deal or patient name, phone */
  q?: string | null;
};

export const AUDIT_SYSTEM = "system";

/** The screen's filters as list filters (ra-data-postgrest syntax) */
export const toAuditListFilter = (
  state: AuditFilterState,
  now = new Date(),
) => {
  const { from, to } = toReportFilters(
    { period: state.period, from: state.from, to: state.to },
    now,
  );
  const filter: Record<string, unknown> = {};
  if (from) filter["at@gte"] = from;
  if (to) filter["at@lt"] = to;
  if (state.sales_id === AUDIT_SYSTEM) filter["sales_id@is"] = null;
  else if (state.sales_id) filter.sales_id = Number(state.sales_id);
  if (state.entity) {
    filter["entity@in"] = `(${AUDIT_ENTITY_GROUPS[state.entity].join(",")})`;
  }
  const q = state.q?.trim();
  if (q) filter.q = q;
  return filter;
};

/** Rows of the CSV export, one column per header of the table */
export const toAuditCsvRows = (
  entries: AuditLogEntry[],
  lookups: AuditLookups,
  translate: Translate,
) =>
  entries.map((entry) => ({
    [translate("audit.columns.at")]: formatAuditTime(entry.at),
    [translate("audit.columns.employee")]: auditActor(
      entry,
      lookups,
      translate,
    ),
    [translate("audit.columns.entity")]: auditEntityLabel(
      entry,
      lookups,
      translate,
    ),
    [translate("audit.columns.action")]: auditActionLabel(entry, translate),
    [translate("audit.columns.changes")]: auditSummary(
      entry,
      lookups,
      translate,
    ),
  }));
