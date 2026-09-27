/**
 * Columns of the deal list (stage 21): which ones exist, their order and
 * which are hidden. The settings are per user (ra store, localStorage); a
 * stored setting is normalized against the current columns, so a column
 * added later shows up and a removed one is forgotten.
 */

export const DEAL_COLUMNS = [
  "name",
  "patient",
  "phone",
  "stage",
  "pipeline",
  "responsible",
  "service",
  "doctor",
  "source",
  "plan_amount",
  "paid_amount",
  "created_at",
  "last_activity_at",
  "next_task",
  "tags",
] as const;

export type DealColumnId = (typeof DEAL_COLUMNS)[number];

/** Sort field of each column; null: not sortable */
export const COLUMN_SORT: Record<DealColumnId, string | null> = {
  name: "name",
  patient: "patient_last_name",
  phone: "patient_phone",
  stage: "stage_id",
  pipeline: "pipeline_id",
  responsible: "sales_id",
  service: "service_id",
  doctor: "doctor_id",
  source: "source_id",
  plan_amount: "plan_amount",
  paid_amount: "paid_amount",
  created_at: "created_at",
  last_activity_at: "last_activity_at",
  next_task: "next_task_due_at",
  tags: null,
};

/** The deal name and the patient are always shown */
export const LOCKED_COLUMNS: readonly DealColumnId[] = ["name", "patient"];

export type ColumnSettings = {
  order: DealColumnId[];
  hidden: DealColumnId[];
};

export const DEFAULT_COLUMN_SETTINGS: ColumnSettings = {
  order: [...DEAL_COLUMNS],
  hidden: ["pipeline", "doctor", "last_activity_at"],
};

const isColumn = (value: unknown): value is DealColumnId =>
  DEAL_COLUMNS.includes(value as DealColumnId);

/**
 * A stored setting made valid: known columns only, no duplicates, every
 * column present (new ones at the end, hidden when hidden by default), the
 * locked columns shown
 */
export const normalizeColumns = (
  stored: Partial<ColumnSettings> | null | undefined,
): ColumnSettings => {
  if (!stored || !Array.isArray(stored.order)) {
    return {
      order: [...DEFAULT_COLUMN_SETTINGS.order],
      hidden: [...DEFAULT_COLUMN_SETTINGS.hidden],
    };
  }
  const order = [...new Set(stored.order.filter(isColumn))];
  const added = DEAL_COLUMNS.filter((column) => !order.includes(column));
  const hidden = [
    ...new Set([
      ...(Array.isArray(stored.hidden) ? stored.hidden : []).filter(isColumn),
      ...added.filter((column) =>
        DEFAULT_COLUMN_SETTINGS.hidden.includes(column),
      ),
    ]),
  ].filter((column) => !LOCKED_COLUMNS.includes(column));
  return { order: [...order, ...added], hidden };
};

/** The shown columns, in order */
export const visibleColumns = (settings: ColumnSettings): DealColumnId[] =>
  settings.order.filter((column) => !settings.hidden.includes(column));

export const toggleColumn = (
  settings: ColumnSettings,
  column: DealColumnId,
): ColumnSettings => {
  if (LOCKED_COLUMNS.includes(column)) return settings;
  return settings.hidden.includes(column)
    ? { ...settings, hidden: settings.hidden.filter((c) => c !== column) }
    : { ...settings, hidden: [...settings.hidden, column] };
};

/** Moves a column one place up (-1) or down (+1) */
export const moveColumn = (
  settings: ColumnSettings,
  column: DealColumnId,
  direction: -1 | 1,
): ColumnSettings => {
  const index = settings.order.indexOf(column);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= settings.order.length) {
    return settings;
  }
  const order = [...settings.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...settings, order };
};
