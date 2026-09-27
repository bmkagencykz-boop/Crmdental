import { useCanAccess, useGetList, useStore, useTranslate } from "ra-core";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  useDoctors,
  useLeadSources,
  usePipelines,
} from "../dictionaries/useDictionaries";
import type { Sale } from "../types";
import {
  REPORT_PERIODS,
  toReportFilters,
  type ReportFilterState,
} from "./format";
import {
  ConversionTab,
  LostReasonsTab,
  MoneyTab,
  SpeedTab,
} from "./ReportTabs";
import { RecallsTab } from "../mailings/RecallsTab";
import { SalesPlanTab } from "./SalesPlanTab";

const TABS = [
  "conversion",
  "speed",
  "lost_reasons",
  "money",
  "recalls",
  "sales_plan",
] as const;
const ALL = "all";

/**
 * Reports of the clinic manager (spec §7): conversion, speed and KPI, lost
 * reasons, money. Owner and head only (checked by the database as well).
 */
export const ReportsPage = () => {
  const translate = useTranslate();
  const { canAccess, isPending } = useCanAccess({
    resource: "reports",
    action: "list",
  });
  const [state, setState] = useStore<ReportFilterState>("reports.filters", {
    period: "month",
  });
  const [tab, setTab] = useStore<(typeof TABS)[number]>(
    "reports.tab",
    "conversion",
  );
  // Recomputed when the filters change; presets start at midnight, so the
  // query key stays the same all day long
  const filters = useMemo(() => toReportFilters(state), [state]);

  if (isPending) return null;
  if (!canAccess) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("reports.forbidden")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The sales plan has its own month */}
      {tab === "sales_plan" ? null : (
        <ReportFiltersBar state={state} onChange={setState} />
      )}
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="rounded-md">
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value} className="rounded-md">
              {translate(
                value === "recalls"
                  ? "recalls.title"
                  : value === "sales_plan"
                    ? "sales_plan.tab"
                    : `reports.tabs.${value}`,
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="conversion" className="mt-4">
          <ConversionTab filters={filters} />
        </TabsContent>
        <TabsContent value="speed" className="mt-4">
          <SpeedTab filters={filters} />
        </TabsContent>
        <TabsContent value="lost_reasons" className="mt-4">
          <LostReasonsTab filters={filters} />
        </TabsContent>
        <TabsContent value="money" className="mt-4">
          <MoneyTab filters={filters} />
        </TabsContent>
        <TabsContent value="recalls" className="mt-4">
          <RecallsTab filters={filters} />
        </TabsContent>
        <TabsContent value="sales_plan" className="mt-4">
          <SalesPlanTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

ReportsPage.path = "/reports";

const ReportFiltersBar = ({
  state,
  onChange,
}: {
  state: ReportFilterState;
  onChange: (state: ReportFilterState) => void;
}) => {
  const translate = useTranslate();
  const { data: pipelines } = usePipelines();
  const { data: sources } = useLeadSources();
  const { data: doctors } = useDoctors();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "last_name", order: "ASC" },
  });
  const set = (patch: Partial<ReportFilterState>) =>
    onChange({ ...state, ...patch });

  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-4"
      role="search"
    >
      <Filter label={translate("reports.filters.period")}>
        <Select
          value={state.period}
          onValueChange={(period) =>
            set({ period: period as ReportFilterState["period"] })
          }
        >
          <SelectTrigger
            className="w-40 rounded-md"
            aria-label={translate("reports.filters.period")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_PERIODS.map((period) => (
              <SelectItem key={period} value={period}>
                {translate(`reports.periods.${period}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Filter>
      {state.period === "custom" ? (
        <>
          <Filter label={translate("reports.filters.from")}>
            <Input
              type="date"
              className="w-40 rounded-md"
              aria-label={translate("reports.filters.from")}
              value={state.from ?? ""}
              onChange={(event) => set({ from: event.target.value || null })}
            />
          </Filter>
          <Filter label={translate("reports.filters.to")}>
            <Input
              type="date"
              className="w-40 rounded-md"
              aria-label={translate("reports.filters.to")}
              value={state.to ?? ""}
              onChange={(event) => set({ to: event.target.value || null })}
            />
          </Filter>
        </>
      ) : null}
      <ChoiceFilter
        label={translate("reports.filters.pipeline")}
        allLabel={translate("reports.filters.all_pipelines")}
        value={state.pipeline_id}
        choices={pipelines.map((p) => ({ id: String(p.id), name: p.name }))}
        onChange={(pipeline_id) => set({ pipeline_id })}
      />
      <ChoiceFilter
        label={translate("reports.filters.employee")}
        allLabel={translate("reports.filters.all_employees")}
        value={state.sales_id}
        choices={sales.map((s) => ({
          id: String(s.id),
          name: `${s.first_name} ${s.last_name}`,
        }))}
        onChange={(sales_id) => set({ sales_id })}
      />
      <ChoiceFilter
        label={translate("reports.filters.source")}
        allLabel={translate("reports.filters.all_sources")}
        value={state.source_id}
        choices={sources.map((s) => ({ id: String(s.id), name: s.name }))}
        onChange={(source_id) => set({ source_id })}
      />
      <ChoiceFilter
        label={translate("doctors.reports.filter")}
        allLabel={translate("doctors.reports.all")}
        value={state.doctor_id}
        choices={doctors.map((d) => ({ id: String(d.id), name: d.name }))}
        onChange={(doctor_id) => set({ doctor_id })}
      />
    </div>
  );
};

const Filter = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </div>
);

const ChoiceFilter = ({
  label,
  allLabel,
  value,
  choices,
  onChange,
}: {
  label: string;
  allLabel: string;
  value?: string | null;
  choices: Array<{ id: string; name: string }>;
  onChange: (value: string | null) => void;
}) => (
  <Filter label={label}>
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? null : next)}
    >
      <SelectTrigger className="w-48 rounded-md" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </Filter>
);
