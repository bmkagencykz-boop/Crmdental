import {
  useCreate,
  useDataProvider,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { NativeSelect } from "../payments/PaymentDialog";
import { todayKey } from "../tasks/calendarLayout";
import { addMonths, monthOf } from "./financeMath";
import { modelRows, type TableRow } from "./financeTable";
import {
  bigMoney,
  Chips,
  downloadTable,
  Empty,
  FinanceChart,
  FinanceTable,
  num,
  periodLabel,
  Tile,
} from "./FinanceParts";
import {
  MODEL_DRIVERS,
  MODEL_LINE_PNL,
  type FinanceModel,
  type FinanceModelLine,
  type FinanceModelMonth,
  type ModelDriver,
  type Scenario,
} from "./types";
import {
  useFinanceModels,
  useModelReport,
  useRefreshFinance,
} from "./useFinance";

const SCENARIOS: Scenario[] = ["base", "optimistic", "pessimistic"];

/** Typical lines of a dental clinic, % of revenue or a month's amount */
const DEFAULT_MODEL_LINES: Omit<FinanceModelLine, "id" | "model_id">[] =
  [
    {
      name: "Врачи",
      pnl_line: "doctors",
      kind: "percent",
      amount: 0,
      percent: 30,
      from_index: 0,
      to_index: 11,
      position: 0,
    },
    {
      name: "Лаборатория",
      pnl_line: "lab",
      kind: "percent",
      amount: 0,
      percent: 8,
      from_index: 0,
      to_index: 11,
      position: 1,
    },
    {
      name: "Материалы",
      pnl_line: "materials",
      kind: "percent",
      amount: 0,
      percent: 6,
      from_index: 0,
      to_index: 11,
      position: 2,
    },
    {
      name: "Персонал",
      pnl_line: "staff",
      kind: "fixed",
      amount: 2_500_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 3,
    },
    {
      name: "Аренда",
      pnl_line: "opex",
      kind: "fixed",
      amount: 1_500_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 4,
    },
    {
      name: "Маркетинг",
      pnl_line: "marketing",
      kind: "fixed",
      amount: 800_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 5,
    },
    {
      name: "Налоги",
      pnl_line: "tax",
      kind: "percent",
      amount: 0,
      percent: 3,
      from_index: 0,
      to_index: 11,
      position: 6,
    },
  ];

const parse = (text: string) => {
  const value = Number(text.replace(/[\s\u00a0₸%]/g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

/** A number input that saves on blur */
const NumberField = ({
  value,
  onSave,
  label,
  placeholder,
  className,
  disabled,
}: {
  value: number | null | undefined;
  onSave: (value: number | null) => void;
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) => {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  return (
    <Input
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      className={cn("h-9 text-right tabular-nums", className)}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = text.trim() === "" ? null : parse(text);
        if (next !== (value ?? null)) onSave(next);
      }}
    />
  );
};

/**
 * «Финмодель» (stage 44): a 12-month budget per named version. The driver:
 * visits = chairs × working days × hours × visits per chair-hour ×
 * utilization, revenue = visits × average check; planned lines fixed or
 * % of revenue; scenarios multiply the utilization; the P&L plan, the
 * cash plan, break-even, payback of an investment, plan vs fact.
 */
export const ModelTab = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshFinance();
  const dataProvider = useDataProvider();
  const { data: models = [], isPending } = useFinanceModels(true);
  const [modelId, setModelId] = useState<Identifier | null>(null);
  const [scenario, setScenario] = useState<Scenario>("base");
  const model =
    models.find((m) => String(m.id) === String(modelId)) ?? models[0];
  useEffect(() => {
    if (!modelId && models[0]) setModelId(models[0].id);
  }, [modelId, models]);
  const { data: report, error } = useModelReport(model?.id ?? null, scenario);
  const [update] = useUpdate();
  const [remove] = useDelete();
  const onError = (e: any) =>
    notify(e?.message || "ra.notification.http_error", { type: "error" });

  const saveModel = (data: Partial<FinanceModel>) =>
    model &&
    update(
      "finance_models",
      { id: model.id, data, previousData: model },
      { onSuccess: refresh, onError },
    );

  const newModel = async (copyOf?: FinanceModel) => {
    const base: Partial<FinanceModel> = copyOf
      ? {
          ...copyOf,
          id: undefined,
          name: `${copyOf.name} (${translate("finance.model.copy_suffix")})`,
        }
      : {
          name: translate("finance.model.new_name", { n: models.length + 1 }),
          start_month: addMonths(monthOf(todayKey()), 1),
          chairs: 3,
          working_days: 24,
          hours_per_day: 10,
          utilization: 70,
          visits_per_chair_hour: 0.8,
          avg_check: 35_000,
          optimistic_factor: 1.15,
          pessimistic_factor: 0.85,
          opening_cash: 0,
          investment_amount: 0,
          investment_month: 0,
        };
    delete (base as Record<string, unknown>).id;
    delete (base as Record<string, unknown>).created_at;
    delete (base as Record<string, unknown>).updated_at;
    delete (base as Record<string, unknown>).created_by;
    delete (base as Record<string, unknown>).organization_id;
    try {
      const { data: created } = await dataProvider.create<FinanceModel>(
        "finance_models",
        { data: base },
      );
      const lines = copyOf
        ? (
            await dataProvider.getList<FinanceModelLine>(
              "finance_model_lines",
              {
                filter: { model_id: copyOf.id },
                pagination: { page: 1, perPage: 500 },
                sort: { field: "position", order: "ASC" },
              },
            )
          ).data
        : DEFAULT_MODEL_LINES;
      for (const line of lines) {
        const {
          id: _id,
          organization_id: _org,
          ...rest
        } = line as FinanceModelLine;
        await dataProvider.create("finance_model_lines", {
          data: { ...rest, model_id: created.id },
        });
      }
      if (copyOf) {
        const months = (
          await dataProvider.getList<FinanceModelMonth>(
            "finance_model_months",
            {
              filter: { model_id: copyOf.id },
              pagination: { page: 1, perPage: 50 },
              sort: { field: "month_index", order: "ASC" },
            },
          )
        ).data;
        for (const month of months) {
          const { id: _id, organization_id: _org, ...rest } = month;
          await dataProvider.create("finance_model_months", {
            data: { ...rest, model_id: created.id },
          });
        }
      }
      setModelId(created.id);
      refresh();
    } catch (e) {
      onError(e);
    }
  };

  if (isPending) return <Empty>{translate("finance.loading")}</Empty>;

  const rows = report ? modelRows(report) : [];
  const headers = (report?.months ?? []).map((m) => periodLabel(m.month));
  const labelOf = (row: TableRow) =>
    row.labelKey ? translate(row.labelKey) : (row.name ?? "");
  const beAverage = report
    ? Math.round(
        report.months.reduce((s, m) => s + (m.break_even_revenue ?? 0), 0) /
          Math.max(1, report.months.length),
      )
    : null;
  const beUtil = report?.months[0]?.break_even_utilization;

  return (
    <div className="flex flex-col gap-5" data-testid="finance-model">
      <div className="flex flex-wrap items-center gap-2">
        {models.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setModelId(m.id)}
            className={cn(
              "h-11 rounded-full px-5 text-sm transition-colors",
              String(m.id) === String(model?.id)
                ? "bg-neon text-neon-ink"
                : "bg-card hover:bg-pill",
            )}
          >
            {m.name}
          </button>
        ))}
        <Button
          variant="outline"
          className="h-11 px-5"
          onClick={() => newModel()}
          data-testid="finance-model-new"
        >
          {translate("finance.model.new")}
        </Button>
        {model ? (
          <>
            <Button
              variant="outline"
              className="h-11 px-5"
              onClick={() => newModel(model)}
            >
              {translate("finance.model.duplicate")}
            </Button>
            <Button
              variant="outline"
              className="h-11 px-5"
              onClick={() =>
                window.confirm(
                  translate("finance.model.delete_confirm", {
                    name: model.name,
                  }),
                ) &&
                remove(
                  "finance_models",
                  { id: model.id, previousData: model },
                  {
                    onSuccess: () => {
                      setModelId(null);
                      refresh();
                    },
                    onError,
                  },
                )
              }
            >
              {translate("ra.action.delete")}
            </Button>
          </>
        ) : null}
        {model ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Chips<Scenario>
              label={translate("finance.model.scenario")}
              value={scenario}
              options={SCENARIOS.map((value) => ({
                value,
                label: translate(`finance.model.scenarios.${value}`),
              }))}
              onChange={setScenario}
            />
            <Button
              variant="outline"
              className="h-11 px-5"
              disabled={!report}
              onClick={() =>
                downloadTable({
                  rows,
                  headers,
                  labelOf,
                  labelHeader: translate("finance.pnl.line"),
                  totalHeader: translate("finance.total"),
                  filename: `model-${model.name}-${scenario}`,
                })
              }
            >
              {translate("finance.csv")}
            </Button>
          </div>
        ) : null}
      </div>

      {!model ? (
        <Empty>{translate("finance.model.empty")}</Empty>
      ) : (
        <>
          <ModelDrivers model={model} onSave={saveModel} />
          {error ? <Empty>{(error as Error).message}</Empty> : null}
          {report ? (
            <>
              <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
                <Tile
                  accent
                  label={translate("finance.model.revenue_year")}
                  value={report.total.revenue}
                  testId="finance-model-revenue"
                  hint={translate("finance.model.visits_year", {
                    count: report.total.visits,
                  })}
                />
                <Tile
                  label={translate("finance.model.net_year")}
                  value={report.total.net}
                  tone={report.total.net < 0 ? "negative" : undefined}
                  hint={`${translate("finance.pnl.lines.net_margin")}: ${report.total.net_margin == null ? "—" : `${String(report.total.net_margin).replace(".", ",")} %`}`}
                />
                <Tile
                  label={translate("finance.model.break_even")}
                  value={beAverage}
                  testId="finance-model-break-even"
                  hint={
                    beUtil == null
                      ? undefined
                      : translate("finance.model.break_even_hint", {
                          percent: String(beUtil).replace(".", ","),
                        })
                  }
                />
                <section
                  className="flex min-h-40 flex-col rounded-[28px] bg-card p-6"
                  data-testid="finance-model-payback"
                >
                  <p className="text-sm text-muted-foreground">
                    {translate("finance.model.payback")}
                  </p>
                  <p className="mt-auto pt-6 text-[40px] leading-none font-light tracking-[-0.04em] tabular-nums">
                    {report.payback_months == null
                      ? "—"
                      : translate("finance.model.months", {
                          count: report.payback_months,
                          smart_count: report.payback_months,
                        })}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {report.investment > 0
                      ? translate(
                          report.payback_in_horizon
                            ? "finance.model.payback_in"
                            : "finance.model.payback_estimate",
                          {
                            amount: bigMoney(report.investment).join(" "),
                          },
                        )
                      : translate("finance.model.no_investment")}
                  </p>
                </section>
              </div>
              <StudioCard
                title={translate("finance.model.chart")}
                subtitle={translate("finance.model.chart_hint")}
              >
                <FinanceChart
                  labels={headers}
                  a={report.months.map((m) => m.revenue)}
                  b={report.months.map((m) => m.revenue - m.net)}
                  line={report.months.map((m) => m.cash)}
                  aLabel={translate("finance.model.rows.revenue")}
                  bLabel={translate("finance.pnl.expenses")}
                  lineLabel={translate("finance.model.rows.cash")}
                />
              </StudioCard>
              <StudioCard
                title={translate("finance.model.plan")}
                subtitle={translate("finance.model.plan_hint")}
              >
                <FinanceTable
                  rows={rows}
                  headers={headers}
                  labelOf={labelOf}
                  totalLabel={translate("finance.total")}
                  testId="finance-model-table"
                />
              </StudioCard>
              <PlanFact report={report} />
            </>
          ) : null}
          <ModelLines model={model} />
          <ModelMonths model={model} />
        </>
      )}
    </div>
  );
};

/** The drivers of a model */
const ModelDrivers = ({
  model,
  onSave,
}: {
  model: FinanceModel;
  onSave: (data: Partial<FinanceModel>) => void;
}) => {
  const translate = useTranslate();
  const [name, setName] = useState(model.name);
  useEffect(() => setName(model.name), [model.name]);
  const field = (key: keyof FinanceModel, className = "w-28") => (
    <label key={key} className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">
        {translate(`finance.model.fields.${key}`)}
      </span>
      <NumberField
        className={className}
        value={model[key] as number}
        label={translate(`finance.model.fields.${key}`)}
        onSave={(value) =>
          value != null && onSave({ [key]: value } as Partial<FinanceModel>)
        }
      />
    </label>
  );
  return (
    <StudioCard
      title={translate("finance.model.drivers")}
      subtitle={translate("finance.model.formula")}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("finance.model.fields.name")}
          </span>
          <Input
            className="h-9 w-56"
            value={name}
            aria-label={translate("finance.model.fields.name")}
            onChange={(event) => setName(event.target.value)}
            onBlur={() =>
              name.trim() &&
              name !== model.name &&
              onSave({ name: name.trim() })
            }
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("finance.model.fields.start_month")}
          </span>
          <Input
            type="month"
            className="h-9 w-40"
            value={model.start_month.slice(0, 7)}
            aria-label={translate("finance.model.fields.start_month")}
            onChange={(event) =>
              event.target.value &&
              onSave({ start_month: `${event.target.value}-01` })
            }
          />
        </label>
        {MODEL_DRIVERS.map((key) =>
          field(key, key === "avg_check" ? "w-32" : "w-24"),
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {field("optimistic_factor", "w-24")}
        {field("pessimistic_factor", "w-24")}
        {field("opening_cash", "w-36")}
        {field("investment_amount", "w-36")}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("finance.model.fields.investment_month")}
          </span>
          <NativeSelect
            value={String(model.investment_month)}
            onChange={(value) => onSave({ investment_month: Number(value) })}
            aria-label={translate("finance.model.fields.investment_month")}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={String(i)}>
                {periodLabel(addMonths(monthOf(model.start_month), i))}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
    </StudioCard>
  );
};

/** The planned lines of a model */
const ModelLines = ({ model }: { model: FinanceModel }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshFinance();
  const [create] = useCreate();
  const [update] = useUpdate();
  const [remove] = useDelete();
  const { data: lines = [] } = useGetList<FinanceModelLine>(
    "finance_model_lines",
    {
      filter: { model_id: model.id },
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 200 },
    },
  );
  const onError = (e: any) =>
    notify(e?.message || "ra.notification.http_error", { type: "error" });
  const save = (line: FinanceModelLine, data: Partial<FinanceModelLine>) =>
    update(
      "finance_model_lines",
      { id: line.id, data, previousData: line },
      { onSuccess: refresh, onError },
    );
  const monthOptions = Array.from({ length: 12 }, (_, i) => (
    <option key={i} value={String(i)}>
      {periodLabel(addMonths(monthOf(model.start_month), i))}
    </option>
  ));
  return (
    <StudioCard
      title={translate("finance.model.lines")}
      subtitle={translate("finance.model.lines_hint")}
    >
      <div className="flex flex-col gap-2" data-testid="finance-model-lines">
        {lines.map((line) => (
          <div
            key={line.id}
            className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-3 py-2"
          >
            <Input
              className="h-9 w-48"
              defaultValue={line.name}
              aria-label={translate("finance.model.line_name")}
              onBlur={(event) =>
                event.target.value.trim() &&
                event.target.value !== line.name &&
                save(line, { name: event.target.value.trim() })
              }
            />
            <NativeSelect
              value={line.pnl_line}
              onChange={(value) =>
                save(line, { pnl_line: value as FinanceModelLine["pnl_line"] })
              }
              aria-label={translate("finance.model.line_pnl")}
            >
              {MODEL_LINE_PNL.map((value) => (
                <option key={value} value={value}>
                  {translate(
                    `finance.model.rows.${value === "opex" ? "opex_other" : value}`,
                  )}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={line.kind}
              onChange={(value) =>
                save(line, { kind: value as FinanceModelLine["kind"] })
              }
              aria-label={translate("finance.model.line_kind")}
            >
              <option value="fixed">
                {translate("finance.model.kinds.fixed")}
              </option>
              <option value="percent">
                {translate("finance.model.kinds.percent")}
              </option>
            </NativeSelect>
            {line.kind === "percent" ? (
              <NumberField
                className="w-20"
                value={line.percent}
                label={translate("finance.model.kinds.percent")}
                onSave={(value) =>
                  value != null && save(line, { percent: value })
                }
              />
            ) : (
              <NumberField
                className="w-32"
                value={line.amount}
                label={translate("finance.model.kinds.fixed")}
                onSave={(value) =>
                  value != null && save(line, { amount: Math.round(value) })
                }
              />
            )}
            <span className="text-xs text-muted-foreground">
              {translate("finance.model.line_months")}
            </span>
            <NativeSelect
              value={String(line.from_index)}
              onChange={(value) =>
                save(line, {
                  from_index: Number(value),
                  to_index: Math.max(Number(value), line.to_index),
                })
              }
              aria-label={translate("finance.period.from")}
            >
              {monthOptions}
            </NativeSelect>
            <NativeSelect
              value={String(line.to_index)}
              onChange={(value) =>
                save(line, {
                  to_index: Number(value),
                  from_index: Math.min(Number(value), line.from_index),
                })
              }
              aria-label={translate("finance.period.to")}
            >
              {monthOptions}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 rounded-full px-3"
              aria-label={translate("ra.action.delete")}
              onClick={() =>
                remove(
                  "finance_model_lines",
                  { id: line.id, previousData: line },
                  { onSuccess: refresh, onError },
                )
              }
            >
              ×
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="outline"
            className="h-10 px-5"
            onClick={() =>
              create(
                "finance_model_lines",
                {
                  data: {
                    model_id: model.id,
                    name: translate("finance.model.new_line"),
                    pnl_line: "opex",
                    kind: "fixed",
                    amount: 0,
                    percent: 0,
                    from_index: 0,
                    to_index: 11,
                    position: lines.length,
                  },
                },
                { onSuccess: refresh, onError },
              )
            }
          >
            {translate("finance.model.add_line")}
          </Button>
        </div>
      </div>
    </StudioCard>
  );
};

/** The drivers of each month: empty — the model's */
const ModelMonths = ({ model }: { model: FinanceModel }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshFinance();
  const [create] = useCreate();
  const [update] = useUpdate();
  const [remove] = useDelete();
  const { data: months = [] } = useGetList<FinanceModelMonth>(
    "finance_model_months",
    {
      filter: { model_id: model.id },
      sort: { field: "month_index", order: "ASC" },
      pagination: { page: 1, perPage: 50 },
    },
  );
  const onError = (e: any) =>
    notify(e?.message || "ra.notification.http_error", { type: "error" });
  const save = (index: number, key: ModelDriver, value: number | null) => {
    const row = months.find((m) => Number(m.month_index) === index);
    if (!row) {
      if (value == null) return;
      create(
        "finance_model_months",
        { data: { model_id: model.id, month_index: index, [key]: value } },
        { onSuccess: refresh, onError },
      );
      return;
    }
    const next = { ...row, [key]: value };
    if (MODEL_DRIVERS.every((k) => next[k] == null)) {
      remove(
        "finance_model_months",
        { id: row.id, previousData: row },
        { onSuccess: refresh, onError },
      );
    } else {
      update(
        "finance_model_months",
        { id: row.id, data: { [key]: value }, previousData: row },
        { onSuccess: refresh, onError },
      );
    }
  };
  const indexes = useMemo(() => Array.from({ length: 12 }, (_, i) => i), []);
  return (
    <StudioCard
      title={translate("finance.model.months_title")}
      subtitle={translate("finance.model.months_hint")}
    >
      <div className="overflow-x-auto" data-testid="finance-model-months">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-2 text-left text-xs font-normal text-muted-foreground" />
              {indexes.map((i) => (
                <th
                  key={i}
                  className="px-1 text-xs font-normal whitespace-nowrap text-muted-foreground"
                >
                  {periodLabel(addMonths(monthOf(model.start_month), i))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODEL_DRIVERS.map((key) => (
              <tr key={key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-2 text-left text-xs font-normal whitespace-nowrap"
                >
                  {translate(`finance.model.fields.${key}`)}
                </th>
                {indexes.map((i) => {
                  const row = months.find((m) => Number(m.month_index) === i);
                  return (
                    <td key={i}>
                      <NumberField
                        className={cn(
                          "w-20 px-2",
                          row?.[key] != null && "bg-neon-soft",
                        )}
                        value={row?.[key] ?? null}
                        placeholder={String(model[key])}
                        label={`${translate(`finance.model.fields.${key}`)} ${i + 1}`}
                        onSave={(value) => save(i, key, value)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StudioCard>
  );
};

/** Plan vs fact: the months of the model that already happened */
const PlanFact = ({
  report,
}: {
  report: NonNullable<ReturnType<typeof useModelReport>["data"]>;
}) => {
  const translate = useTranslate();
  if (!report.fact.length) {
    return (
      <StudioCard title={translate("finance.model.plan_fact")}>
        <Empty>{translate("finance.model.no_fact")}</Empty>
      </StudioCard>
    );
  }
  return (
    <StudioCard
      title={translate("finance.model.plan_fact")}
      subtitle={translate("finance.model.plan_fact_hint")}
    >
      <div className="overflow-x-auto" data-testid="finance-plan-fact">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              {[
                "month",
                "plan_revenue",
                "fact_revenue",
                "delta",
                "percent",
                "plan_net",
                "fact_net",
                "delta_net",
              ].map((key) => (
                <th
                  key={key}
                  className={cn(
                    "px-3 py-2 font-normal whitespace-nowrap",
                    key === "month" ? "text-left" : "text-right",
                  )}
                >
                  {translate(`finance.model.fact_columns.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.fact.map((fact) => {
              const plan = report.months.find((m) => m.month === fact.month);
              return (
                <tr key={fact.month} className="odd:bg-muted/50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {periodLabel(fact.month)}
                    {fact.partial ? (
                      <span className="ml-2 rounded-full bg-neon-soft px-2 py-0.5 text-[11px]">
                        {translate("finance.model.partial")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num(plan?.revenue)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num(fact.revenue)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      fact.revenue_delta < 0
                        ? "text-tone-red"
                        : "text-tone-green",
                    )}
                  >
                    {fact.revenue_delta > 0 ? "+" : ""}
                    {num(fact.revenue_delta)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fact.revenue_percent == null
                      ? "—"
                      : `${String(fact.revenue_percent).replace(".", ",")} %`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num(plan?.net)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num(fact.net)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      fact.net_delta < 0 ? "text-tone-red" : "text-tone-green",
                    )}
                  >
                    {fact.net_delta > 0 ? "+" : ""}
                    {num(fact.net_delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </StudioCard>
  );
};
