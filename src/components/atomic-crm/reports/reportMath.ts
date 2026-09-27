import type { Identifier } from "ra-core";

import type {
  Deal,
  DealEvent,
  DealPayment,
  LeadSource,
  LostReason,
  Message,
  Pipeline,
  Sale,
  Service,
  Stage,
  StageKind,
  Task,
} from "../types";

/**
 * Report computations of the demo (FakeRest). They are the TypeScript twin of
 * the public.report_* functions of the database (supabase/schemas/09_reports.sql)
 * and return the same shapes.
 */

export type ReportFilters = {
  /** Start of the period (inclusive), ISO date-time; null: no start */
  from?: string | null;
  /** End of the period (exclusive), ISO date-time; null: up to now */
  to?: string | null;
  pipeline_id?: Identifier | null;
  sales_id?: Identifier | null;
  source_id?: Identifier | null;
};

export type ReportData = {
  deals: Deal[];
  stages: Stage[];
  pipelines: Pipeline[];
  deal_events: DealEvent[];
  deal_payments: DealPayment[];
  tasks: Task[];
  messages: Message[];
  sales: Sale[];
  lead_sources: LeadSource[];
  services: Service[];
  lost_reasons: LostReason[];
  /** Clinic time zone: the dates of the payments are local dates */
  timeZone?: string;
};

export type ConversionMetrics = {
  deals: number;
  appointment: number;
  visit: number;
  plan: number;
  paid: number;
  won: number;
  lost: number;
};

export type NamedRow = { id: Identifier | null; name: string | null };

export type ConversionReport = {
  pipeline_id: Identifier | null;
  funnel: Array<{
    stage_id: Identifier;
    name: string;
    kind: StageKind;
    color: string;
    deals: number;
  }>;
  totals: ConversionMetrics;
  by_source: Array<NamedRow & ConversionMetrics>;
  by_sales: Array<NamedRow & ConversionMetrics>;
};

export type SpeedReport = {
  first_response: { deals: number; avg_seconds: number | null };
  stages: Array<{
    stage_id: Identifier;
    name: string;
    color: string;
    pipeline_id: Identifier;
    pipeline_name: string;
    stays: number;
    avg_seconds: number | null;
  }>;
  by_sales: Array<{
    id: Identifier;
    name: string;
    deals: number;
    first_response_seconds: number | null;
    tasks_created: number;
    tasks_done: number;
    tasks_due: number;
    tasks_overdue: number;
    messages_sent: number;
    open_deals: number;
    deals_without_task: number;
  }>;
};

export type LostReport = {
  totals: { deals: number; plan_amount: number };
  by_reason: Array<NamedRow & { deals: number; plan_amount: number }>;
  by_stage: Array<
    NamedRow & {
      pipeline_name: string | null;
      deals: number;
      plan_amount: number;
    }
  >;
};

export type MoneyMetrics = {
  agreed_deals: number;
  agreed_amount: number;
  paid_amount: number;
  paying_deals: number;
  average_check: number | null;
};

export type MoneyReport = {
  totals: MoneyMetrics;
  by_service: Array<NamedRow & MoneyMetrics>;
  by_sales: Array<NamedRow & MoneyMetrics>;
};

export type ReportName = "conversion" | "speed" | "lost_reasons" | "money";

export type ReportResult = {
  conversion: ConversionReport;
  speed: SpeedReport;
  lost_reasons: LostReport;
  money: MoneyReport;
};

// --- helpers ---------------------------------------------------------------

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const time = (value: string | null | undefined) =>
  value ? new Date(value).getTime() : NaN;

/** In [from, to): a null bound is open */
export const inPeriod = (
  value: string | null | undefined,
  { from, to }: ReportFilters,
) => {
  if (!value) return false;
  const t = time(value);
  return (from == null || t >= time(from)) && (to == null || t < time(to));
};

const byOrder =
  <T>(...keys: Array<(item: T) => number | string>) =>
  (a: T, b: T) => {
    for (const key of keys) {
      const x = key(a);
      const y = key(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };

const num = (value: Identifier | null | undefined) =>
  value == null ? Number.POSITIVE_INFINITY : Number(value);

const average = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
    : null;

const fullName = (sale?: Sale) =>
  sale ? `${sale.first_name ?? ""} ${sale.last_name ?? ""}`.trim() : null;

/** Local date (YYYY-MM-DD) of an instant in a time zone */
export const localDate = (value: string, timeZone = "Asia/Almaty") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

// --- key stages and deal progress (private.report_key_stages / report_deal_progress)

export type KeyStages = {
  appointment: number | null;
  visit: number | null;
  plan: number | null;
};

const KEY_NAMES = {
  appointment: "Записан",
  visit: "Пришёл на консультацию",
  plan: "План согласован",
} as const;
const KEY_ORDER = { appointment: 2, visit: 3, plan: 4 } as const;

/**
 * Positions of the key stages of a pipeline: by the template names, else by
 * the template order among the open stages. Without a "plan agreed" stage,
 * the first won stage counts.
 */
export const keyStages = (
  stages: Stage[],
  pipelineId: Identifier,
): KeyStages => {
  const own = stages
    .filter((stage) => same(stage.pipeline_id, pipelineId))
    .sort(
      byOrder(
        (s) => s.position,
        (s) => num(s.id),
      ),
    );
  const open = own.filter((stage) => stage.kind === "open");
  const find = (key: keyof typeof KEY_NAMES) =>
    (
      open.find((stage) => stage.name === KEY_NAMES[key]) ??
      open[KEY_ORDER[key]]
    )?.position ?? null;
  return {
    appointment: find("appointment"),
    visit: find("visit"),
    plan:
      find("plan") ??
      own.find((stage) => stage.kind === "won")?.position ??
      null,
  };
};

export type DealProgress = {
  deal: Deal;
  stage_kind: StageKind | undefined;
  reached_position: number | null;
  reached_appointment: boolean;
  reached_visit: boolean;
  reached_plan: boolean;
  agreed_at: string | null;
  lost_from_stage_id: Identifier | null;
};

export const dealProgress = (
  data: ReportData,
  filters: Pick<ReportFilters, "pipeline_id" | "sales_id" | "source_id">,
): DealProgress[] => {
  const stagesById = new Map(data.stages.map((s) => [String(s.id), s]));
  const keysByPipeline = new Map<string, KeyStages>();
  const keysOf = (pipelineId: Identifier) => {
    const key = String(pipelineId);
    if (!keysByPipeline.has(key)) {
      keysByPipeline.set(key, keyStages(data.stages, pipelineId));
    }
    return keysByPipeline.get(key)!;
  };
  const eventsByDeal = new Map<string, DealEvent[]>();
  for (const event of data.deal_events) {
    if (event.type !== "created" && event.type !== "stage_changed") continue;
    const key = String(event.deal_id);
    eventsByDeal.set(key, [...(eventsByDeal.get(key) ?? []), event]);
  }

  return data.deals
    .filter(
      (deal) =>
        (filters.pipeline_id == null ||
          same(deal.pipeline_id, filters.pipeline_id)) &&
        (filters.sales_id == null || same(deal.sales_id, filters.sales_id)) &&
        (filters.source_id == null || same(deal.source_id, filters.source_id)),
    )
    .map((deal) => {
      const stage = stagesById.get(String(deal.stage_id));
      const events = eventsByDeal.get(String(deal.id)) ?? [];
      const entries: Array<{ position: number; at: string }> = [];
      for (const event of events) {
        const entered = stagesById.get(String(event.to_stage_id));
        if (
          entered &&
          same(entered.pipeline_id, deal.pipeline_id) &&
          entered.kind !== "lost"
        ) {
          entries.push({ position: entered.position, at: event.created_at });
        }
      }
      if (stage && stage.kind !== "lost") {
        entries.push({
          position: stage.position,
          at: deal.stage_changed_at ?? deal.created_at,
        });
      }
      const keys = keysOf(deal.pipeline_id);
      const reached = entries.length
        ? Math.max(...entries.map((entry) => entry.position))
        : null;
      const reaches = (position: number | null) =>
        reached != null && position != null && reached >= position;
      const agreed = entries
        .filter((entry) => keys.plan != null && entry.position >= keys.plan)
        .map((entry) => entry.at)
        .sort((a, b) => time(a) - time(b))[0];
      const lostEvent =
        stage?.kind === "lost"
          ? events
              .filter(
                (event) =>
                  event.type === "stage_changed" &&
                  same(event.to_stage_id, deal.stage_id),
              )
              .sort(
                (a, b) =>
                  time(b.created_at) - time(a.created_at) ||
                  Number(b.id) - Number(a.id),
              )[0]
          : undefined;
      return {
        deal,
        stage_kind: stage?.kind,
        reached_position: reached,
        reached_appointment: reaches(keys.appointment),
        reached_visit: reaches(keys.visit),
        reached_plan: reaches(keys.plan),
        agreed_at: agreed ?? null,
        lost_from_stage_id: lostEvent?.from_stage_id ?? null,
      };
    });
};

// --- conversion --------------------------------------------------------------

const conversionMetrics = (rows: DealProgress[]): ConversionMetrics => ({
  deals: rows.length,
  appointment: rows.filter((r) => r.reached_appointment).length,
  visit: rows.filter((r) => r.reached_visit).length,
  plan: rows.filter((r) => r.reached_plan).length,
  paid: rows.filter((r) => r.reached_plan && r.deal.paid_amount > 0).length,
  won: rows.filter((r) => r.stage_kind === "won").length,
  lost: rows.filter((r) => r.stage_kind === "lost").length,
});

const groupBy = <T>(
  rows: T[],
  key: (row: T) => Identifier | null | undefined,
) => {
  const groups = new Map<string, { id: Identifier | null; rows: T[] }>();
  for (const row of rows) {
    const id = key(row) ?? null;
    const k = id == null ? "" : String(id);
    if (!groups.has(k)) groups.set(k, { id, rows: [] });
    groups.get(k)!.rows.push(row);
  }
  return [...groups.values()];
};

/** Same as public.report_conversion */
export const conversionReport = (
  data: ReportData,
  filters: ReportFilters,
): ConversionReport => {
  const pipelineId =
    filters.pipeline_id ??
    [...data.pipelines].sort(
      byOrder(
        (p) => (p.is_default ? 0 : 1),
        (p) => p.position,
        (p) => num(p.id),
      ),
    )[0]?.id ??
    null;
  const cohort = dealProgress(data, filters).filter((row) =>
    inPeriod(row.deal.created_at, filters),
  );
  const sources = new Map(data.lead_sources.map((s) => [String(s.id), s]));
  const sales = new Map(data.sales.map((s) => [String(s.id), s]));

  return {
    pipeline_id: pipelineId,
    funnel: data.stages
      .filter((stage) => same(stage.pipeline_id, pipelineId))
      .sort(
        byOrder(
          (s) => s.position,
          (s) => num(s.id),
        ),
      )
      .map((stage) => ({
        stage_id: stage.id,
        name: stage.name,
        kind: stage.kind,
        color: stage.color,
        deals: cohort.filter(
          (row) =>
            same(row.deal.pipeline_id, stage.pipeline_id) &&
            (stage.kind === "open"
              ? row.reached_position != null &&
                row.reached_position >= stage.position
              : same(row.deal.stage_id, stage.id)),
        ).length,
      })),
    totals: conversionMetrics(cohort),
    by_source: groupBy(cohort, (row) => row.deal.source_id)
      .map(({ id, rows }) => {
        const source = id == null ? undefined : sources.get(String(id));
        return {
          id,
          name: source?.name ?? null,
          ...conversionMetrics(rows),
          _order: [source?.position ?? Infinity, num(id)],
        };
      })
      .sort(
        byOrder(
          (r) => -r.deals,
          (r) => r._order[0],
          (r) => r._order[1],
        ),
      )
      .map(({ _order, ...row }) => row),
    by_sales: groupBy(cohort, (row) => row.deal.sales_id)
      .map(({ id, rows }) => {
        const sale = id == null ? undefined : sales.get(String(id));
        return {
          id,
          name: fullName(sale),
          ...conversionMetrics(rows),
          _order: [sale?.last_name ?? "￿", num(id)] as const,
        };
      })
      .sort(
        byOrder(
          (r) => -r.deals,
          (r) => r._order[0],
          (r) => r._order[1],
        ),
      )
      .map(({ _order, ...row }) => row),
  };
};

// --- speed and KPI -------------------------------------------------------------

/** Same as public.report_speed */
export const speedReport = (
  data: ReportData,
  filters: ReportFilters,
  now = new Date(),
): SpeedReport => {
  // Tasks and messages belong to an employee whoever leads the deal
  const scope = dealProgress(data, { ...filters, sales_id: null });
  const scopeIds = new Set(scope.map((row) => String(row.deal.id)));
  const cohort = scope.filter((row) => inPeriod(row.deal.created_at, filters));
  const answered = cohort
    .filter(
      (row) =>
        row.deal.first_response_at &&
        time(row.deal.first_response_at) >= time(row.deal.created_at) &&
        (filters.sales_id == null || same(row.deal.sales_id, filters.sales_id)),
    )
    .map((row) => ({
      sales_id: row.deal.sales_id,
      seconds:
        (time(row.deal.first_response_at) - time(row.deal.created_at)) / 1000,
    }));

  // Stays in a stage: from entering it to entering the next one (or now)
  const dealsById = new Map(data.deals.map((d) => [String(d.id), d]));
  const eventsByDeal = groupBy(
    data.deal_events.filter(
      (e) => e.type === "created" || e.type === "stage_changed",
    ),
    (event) => event.deal_id,
  );
  const stays: Array<{ stage_id: Identifier; seconds: number }> = [];
  for (const { id, rows } of eventsByDeal) {
    const deal = dealsById.get(String(id));
    if (!deal) continue;
    if (filters.sales_id != null && !same(deal.sales_id, filters.sales_id))
      continue;
    if (filters.source_id != null && !same(deal.source_id, filters.source_id))
      continue;
    const sorted = [...rows].sort(
      (a, b) =>
        time(a.created_at) - time(b.created_at) || Number(a.id) - Number(b.id),
    );
    sorted.forEach((event, index) => {
      const next = sorted[index + 1];
      const left = next
        ? time(next.created_at)
        : same(deal.stage_id, event.to_stage_id)
          ? now.getTime()
          : NaN;
      if (Number.isNaN(left) || event.to_stage_id == null) return;
      if (!inPeriod(event.created_at, filters)) return;
      stays.push({
        stage_id: event.to_stage_id,
        seconds: (left - time(event.created_at)) / 1000,
      });
    });
  }
  const pipelines = new Map(data.pipelines.map((p) => [String(p.id), p]));

  const salesRows = data.sales
    .filter(
      (sale) => filters.sales_id == null || same(sale.id, filters.sales_id),
    )
    .map((sale) => {
      const tasks = data.tasks.filter(
        (task) =>
          same(task.sales_id, sale.id) && scopeIds.has(String(task.deal_id)),
      );
      const due = tasks.filter(
        (task) =>
          time(task.due_date) < now.getTime() &&
          inPeriod(task.due_date, filters),
      );
      const open = scope.filter(
        (row) =>
          same(row.deal.sales_id, sale.id) &&
          row.stage_kind === "open" &&
          !row.deal.archived_at,
      );
      return {
        id: sale.id,
        name: fullName(sale) ?? "",
        deals: cohort.filter((row) => same(row.deal.sales_id, sale.id)).length,
        first_response_seconds: average(
          answered
            .filter((a) => same(a.sales_id, sale.id))
            .map((a) => a.seconds),
        ),
        tasks_created: tasks.filter((task) =>
          inPeriod(task.created_at, filters),
        ).length,
        tasks_done: tasks.filter(
          (task) => task.done_date && inPeriod(task.done_date, filters),
        ).length,
        tasks_due: due.length,
        tasks_overdue: due.filter(
          (task) =>
            !task.done_date || time(task.done_date) > time(task.due_date),
        ).length,
        messages_sent: data.messages.filter(
          (message) =>
            message.direction === "out" &&
            same(message.sales_id, sale.id) &&
            scopeIds.has(String(message.deal_id)) &&
            inPeriod(message.sent_at, filters),
        ).length,
        open_deals: open.length,
        deals_without_task: open.filter(
          (row) =>
            !data.tasks.some(
              (task) => same(task.deal_id, row.deal.id) && !task.done_date,
            ),
        ).length,
        _disabled: !!sale.disabled,
        _last_name: sale.last_name ?? "",
      };
    })
    .filter(
      (row) =>
        !row._disabled ||
        row.deals +
          row.tasks_created +
          row.tasks_done +
          row.messages_sent +
          row.open_deals >
          0,
    )
    .sort(
      byOrder(
        (r) => -r.deals,
        (r) => r._last_name,
        (r) => num(r.id),
      ),
    )
    .map(({ _disabled, _last_name, ...row }) => row);

  return {
    first_response: {
      deals: answered.length,
      avg_seconds: average(answered.map((a) => a.seconds)),
    },
    stages: data.stages
      .filter(
        (stage) =>
          stage.kind === "open" &&
          (filters.pipeline_id == null ||
            same(stage.pipeline_id, filters.pipeline_id)),
      )
      .sort(
        byOrder(
          (s) => pipelines.get(String(s.pipeline_id))?.position ?? 0,
          (s) => num(s.pipeline_id),
          (s) => s.position,
          (s) => num(s.id),
        ),
      )
      .map((stage) => {
        const own = stays.filter((stay) => same(stay.stage_id, stage.id));
        const pipeline = pipelines.get(String(stage.pipeline_id));
        return {
          stage_id: stage.id,
          name: stage.name,
          color: stage.color,
          pipeline_id: stage.pipeline_id,
          pipeline_name: pipeline?.name ?? "",
          stays: own.length,
          avg_seconds: average(own.map((stay) => stay.seconds)),
        };
      }),
    by_sales: salesRows,
  };
};

// --- lost reasons ---------------------------------------------------------------

/** Same as public.report_lost_reasons */
export const lostReport = (
  data: ReportData,
  filters: ReportFilters,
): LostReport => {
  const lost = dealProgress(data, filters).filter(
    (row) => row.stage_kind === "lost" && inPeriod(row.deal.closed_at, filters),
  );
  const reasons = new Map(data.lost_reasons.map((r) => [String(r.id), r]));
  const stages = new Map(data.stages.map((s) => [String(s.id), s]));
  const pipelines = new Map(data.pipelines.map((p) => [String(p.id), p]));
  const plan = (rows: DealProgress[]) =>
    rows.reduce((sum, row) => sum + Number(row.deal.plan_amount ?? 0), 0);

  return {
    totals: { deals: lost.length, plan_amount: plan(lost) },
    by_reason: groupBy(lost, (row) => row.deal.lost_reason_id)
      .map(({ id, rows }) => {
        const reason = id == null ? undefined : reasons.get(String(id));
        return {
          id,
          name: reason?.name ?? null,
          deals: rows.length,
          plan_amount: plan(rows),
          _order: [reason?.position ?? Infinity, num(id)],
        };
      })
      .sort(
        byOrder(
          (r) => -r.deals,
          (r) => r._order[0],
          (r) => r._order[1],
        ),
      )
      .map(({ _order, ...row }) => row),
    by_stage: groupBy(lost, (row) => row.lost_from_stage_id)
      .map(({ id, rows }) => {
        const stage = id == null ? undefined : stages.get(String(id));
        const pipeline = stage
          ? pipelines.get(String(stage.pipeline_id))
          : undefined;
        return {
          id,
          name: stage?.name ?? null,
          pipeline_name: pipeline?.name ?? null,
          deals: rows.length,
          plan_amount: plan(rows),
          _order: [
            pipeline?.position ?? Infinity,
            num(pipeline?.id),
            stage?.position ?? Infinity,
            num(id),
          ],
        };
      })
      .sort(
        byOrder(
          (r) => r._order[0],
          (r) => r._order[1],
          (r) => r._order[2],
          (r) => r._order[3],
        ),
      )
      .map(({ _order, ...row }) => row),
  };
};

// --- money -----------------------------------------------------------------------

type MoneyRow = {
  deal: Deal;
  agreed: boolean;
  paid: number;
};

const moneyMetrics = (rows: MoneyRow[]): MoneyMetrics => {
  const agreed = rows.filter((row) => row.agreed);
  const paying = rows.filter((row) => row.paid > 0).length;
  const paid = rows.reduce((sum, row) => sum + row.paid, 0);
  return {
    agreed_deals: agreed.length,
    agreed_amount: agreed.reduce(
      (sum, row) => sum + Number(row.deal.plan_amount ?? 0),
      0,
    ),
    paid_amount: paid,
    paying_deals: paying,
    average_check: paying ? Math.round(paid / paying) : null,
  };
};

/** Same as public.report_money */
export const moneyReport = (
  data: ReportData,
  filters: ReportFilters,
): MoneyReport => {
  const timeZone = data.timeZone ?? "Asia/Almaty";
  const firstDay = filters.from ? localDate(filters.from, timeZone) : null;
  const afterLastDay = filters.to ? localDate(filters.to, timeZone) : null;
  const paymentsByDeal = groupBy(
    data.deal_payments.filter(
      (p) =>
        (firstDay == null || p.paid_at.slice(0, 10) >= firstDay) &&
        (afterLastDay == null || p.paid_at.slice(0, 10) < afterLastDay),
    ),
    (p) => p.deal_id,
  );
  const paidByDeal = new Map(
    paymentsByDeal.map(({ id, rows }) => [
      String(id),
      rows.reduce((sum, p) => sum + Number(p.amount), 0),
    ]),
  );
  const rows: MoneyRow[] = dealProgress(data, filters)
    .map((row) => ({
      deal: row.deal,
      agreed: row.agreed_at != null && inPeriod(row.agreed_at, filters),
      paid: paidByDeal.get(String(row.deal.id)) ?? 0,
    }))
    .filter((row) => row.agreed || row.paid > 0);
  const services = new Map(data.services.map((s) => [String(s.id), s]));
  const sales = new Map(data.sales.map((s) => [String(s.id), s]));

  return {
    totals: moneyMetrics(rows),
    by_service: groupBy(rows, (row) => row.deal.service_id)
      .map(({ id, rows }) => {
        const service = id == null ? undefined : services.get(String(id));
        return {
          id,
          name: service?.name ?? null,
          ...moneyMetrics(rows),
          _order: [service?.position ?? Infinity, num(id)],
        };
      })
      .sort(
        byOrder(
          (r) => -r.paid_amount,
          (r) => -r.agreed_amount,
          (r) => r._order[0],
          (r) => r._order[1],
        ),
      )
      .map(({ _order, ...row }) => row),
    by_sales: groupBy(rows, (row) => row.deal.sales_id)
      .map(({ id, rows }) => {
        const sale = id == null ? undefined : sales.get(String(id));
        return {
          id,
          name: fullName(sale),
          ...moneyMetrics(rows),
          _order: [sale?.last_name ?? "￿", num(id)] as const,
        };
      })
      .sort(
        byOrder(
          (r) => -r.paid_amount,
          (r) => -r.agreed_amount,
          (r) => r._order[0],
          (r) => r._order[1],
        ),
      )
      .map(({ _order, ...row }) => row),
  };
};

/** Every report by name, as the data providers expose them */
export const computeReport = <Name extends ReportName>(
  name: Name,
  data: ReportData,
  filters: ReportFilters,
  now = new Date(),
): ReportResult[Name] => {
  switch (name) {
    case "conversion":
      return conversionReport(data, filters) as ReportResult[Name];
    case "speed":
      return speedReport(data, filters, now) as ReportResult[Name];
    case "lost_reasons":
      return lostReport(data, filters) as ReportResult[Name];
    case "money":
      return moneyReport(data, filters) as ReportResult[Name];
    default:
      throw new Error(`Unknown report ${name}`);
  }
};
