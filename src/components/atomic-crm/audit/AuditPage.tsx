import jsonExport from "jsonexport/dist";
import { Download } from "lucide-react";
import {
  downloadCSV,
  useCanAccess,
  useDataProvider,
  useGetList,
  useNotify,
  useStore,
  useTranslate,
} from "ra-core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  useLeadSources,
  useLostReasons,
  useDoctors,
  usePipelines,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { REPORT_PERIODS } from "../reports/format";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { AuditLogEntry, Sale, Tag } from "../types";
import {
  AUDIT_ENTITY_GROUPS,
  AUDIT_SYSTEM,
  auditActionLabel,
  auditActor,
  auditEntityLabel,
  auditEntityLink,
  describeAuditChanges,
  formatAuditTime,
  toAuditCsvRows,
  toAuditListFilter,
  type AuditEntityGroup,
  type AuditFilterState,
  type AuditLookups,
} from "./format";
import { useCustomFields } from "../custom-fields/useCustomFields";

const PER_PAGE = 50;
const EXPORT_LIMIT = 5000;
const ALL = "all";
const SORT = { field: "at", order: "DESC" as const };

/**
 * Audit log of the clinic (spec §9): who changed what and when. Owner and
 * head only (the database gives nobody else a row).
 */
export const AuditPage = () => {
  const translate = useTranslate();
  const { canAccess, isPending: accessPending } = useCanAccess({
    resource: "audit_log",
    action: "list",
  });
  const [state, setState] = useStore<AuditFilterState>("audit.filters", {
    period: "month",
  });
  const [page, setPage] = useState(1);
  const update = (patch: Partial<AuditFilterState>) => {
    setState({ ...state, ...patch });
    setPage(1);
  };
  const filter = useMemo(() => toAuditListFilter(state), [state]);
  const lookups = useAuditLookups(canAccess === true);
  const { data, total, isPending, error } = useGetList<AuditLogEntry>(
    "audit_log",
    { pagination: { page, perPage: PER_PAGE }, sort: SORT, filter },
    { enabled: canAccess === true },
  );

  if (accessPending) return null;
  if (!canAccess) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("audit.forbidden")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AuditFiltersBar state={state} onChange={update} sales={lookups.sales} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AuditPagination page={page} total={total ?? 0} onChange={setPage} />
        <ExportButton filter={filter} lookups={lookups} />
      </div>
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">
                {translate("audit.columns.at")}
              </TableHead>
              <TableHead className="w-44">
                {translate("audit.columns.employee")}
              </TableHead>
              <TableHead className="w-56">
                {translate("audit.columns.entity")}
              </TableHead>
              <TableHead className="w-36">
                {translate("audit.columns.action")}
              </TableHead>
              <TableHead>{translate("audit.columns.changes")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((entry) => (
              <AuditRow key={entry.id} entry={entry} lookups={lookups} />
            ))}
          </TableBody>
        </Table>
        {!isPending && !error && !data?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {translate("audit.empty")}
          </p>
        ) : null}
        {error ? (
          <p className="p-6 text-center text-sm text-destructive">
            {translate("audit.forbidden")}
          </p>
        ) : null}
      </div>
    </div>
  );
};

AuditPage.path = "/audit";

const AuditRow = ({
  entry,
  lookups,
}: {
  entry: AuditLogEntry;
  lookups: AuditLookups;
}) => {
  const translate = useTranslate();
  const link = auditEntityLink(entry);
  const label = auditEntityLabel(entry, lookups, translate);
  const lines = describeAuditChanges(entry, lookups, translate);
  const system = entry.sales_id == null;
  return (
    <TableRow className="align-top" data-testid="audit-row">
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatAuditTime(entry.at)}
      </TableCell>
      <TableCell className={system ? "text-muted-foreground italic" : ""}>
        {auditActor(entry, lookups, translate)}
      </TableCell>
      <TableCell>
        {link ? (
          <Link to={link} className="text-brand-link hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </TableCell>
      <TableCell>
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium">
          {auditActionLabel(entry, translate)}
        </span>
      </TableCell>
      <TableCell className="whitespace-normal">
        {lines.length ? (
          <ul className="flex flex-col gap-0.5">
            {lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
};

/** Names of the employees, stages, dictionaries the log refers to */
const useAuditLookups = (enabled: boolean): AuditLookups => {
  const { currency } = useConfigurationContext();
  const { data: sales } = useGetList<Sale>(
    "sales",
    {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "last_name", order: "ASC" },
    },
    { enabled },
  );
  const { data: tags } = useGetList<Tag>(
    "tags",
    { pagination: { page: 1, perPage: 500 }, sort: SORT_BY_NAME },
    { enabled },
  );
  const { data: stages } = useStages();
  const { data: pipelines } = usePipelines();
  const { data: lostReasons } = useLostReasons();
  const { data: sources } = useLeadSources();
  const { data: services } = useServices();
  const { data: doctors } = useDoctors();
  const { data: customFields } = useCustomFields();
  return useMemo(
    () => ({
      currency: currency ?? "KZT",
      sales: sales ?? [],
      tags: tags ?? [],
      stages,
      pipelines,
      lostReasons,
      sources,
      services,
      doctors,
      customFields,
    }),
    [
      currency,
      sales,
      tags,
      stages,
      pipelines,
      lostReasons,
      sources,
      services,
      doctors,
      customFields,
    ],
  );
};
const SORT_BY_NAME = { field: "name", order: "ASC" as const };

const ExportButton = ({
  filter,
  lookups,
}: {
  filter: Record<string, unknown>;
  lookups: AuditLookups;
}) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const exportCsv = async () => {
    setBusy(true);
    try {
      const { data, total } = await dataProvider.getList<AuditLogEntry>(
        "audit_log",
        {
          pagination: { page: 1, perPage: EXPORT_LIMIT },
          sort: SORT,
          filter,
        },
      );
      const rows = toAuditCsvRows(data, lookups, translate);
      const csv = await jsonExport(rows, {
        rowDelimiter: ";",
        headers: Object.keys(rows[0] ?? {}),
      });
      downloadCSV(csv, "audit-log");
      if ((total ?? 0) > EXPORT_LIMIT) {
        notify("audit.export_limit", {
          type: "warning",
          messageArgs: { count: EXPORT_LIMIT },
        });
      }
    } catch {
      notify("ra.notification.http_error", { type: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-md"
      onClick={exportCsv}
      disabled={busy}
    >
      <Download className="size-4" />
      {translate("audit.export")}
    </Button>
  );
};

const AuditPagination = ({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) => {
  const translate = useTranslate();
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total ? (page - 1) * PER_PAGE + 1 : 0;
  const to = Math.min(total, page * PER_PAGE);
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button
        variant="outline"
        size="sm"
        className="rounded-md"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {translate("audit.pagination.previous")}
      </Button>
      <span className="text-muted-foreground">
        {translate("audit.pagination.range", { from, to, total })}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="rounded-md"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        {translate("audit.pagination.next")}
      </Button>
    </div>
  );
};

const AuditFiltersBar = ({
  state,
  onChange,
  sales,
}: {
  state: AuditFilterState;
  onChange: (patch: Partial<AuditFilterState>) => void;
  sales: AuditLookups["sales"];
}) => {
  const translate = useTranslate();
  // The search waits for a pause in typing
  const [search, setSearch] = useState(state.q ?? "");
  useEffect(() => {
    if (search === (state.q ?? "")) return;
    const timer = setTimeout(() => onChange({ q: search }), 400);
    return () => clearTimeout(timer);
  });

  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-4"
      role="search"
    >
      <Filter label={translate("audit.filters.period")}>
        <Select
          value={state.period}
          onValueChange={(period) =>
            onChange({ period: period as AuditFilterState["period"] })
          }
        >
          <SelectTrigger
            className="w-40 rounded-md"
            aria-label={translate("audit.filters.period")}
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
          <Filter label={translate("audit.filters.from")}>
            <Input
              type="date"
              className="w-40 rounded-md"
              aria-label={translate("audit.filters.from")}
              value={state.from ?? ""}
              onChange={(event) =>
                onChange({ from: event.target.value || null })
              }
            />
          </Filter>
          <Filter label={translate("audit.filters.to")}>
            <Input
              type="date"
              className="w-40 rounded-md"
              aria-label={translate("audit.filters.to")}
              value={state.to ?? ""}
              onChange={(event) => onChange({ to: event.target.value || null })}
            />
          </Filter>
        </>
      ) : null}
      <ChoiceFilter
        label={translate("audit.filters.employee")}
        allLabel={translate("audit.filters.all_employees")}
        value={state.sales_id}
        choices={[
          { id: AUDIT_SYSTEM, name: translate("audit.filters.system") },
          ...sales.map((sale) => ({
            id: String(sale.id),
            name: `${sale.first_name} ${sale.last_name}`,
          })),
        ]}
        onChange={(sales_id) => onChange({ sales_id })}
      />
      <ChoiceFilter
        label={translate("audit.filters.entity")}
        allLabel={translate("audit.filters.all_entities")}
        value={state.entity}
        choices={Object.keys(AUDIT_ENTITY_GROUPS).map((group) => ({
          id: group,
          name: translate(`audit.entity_groups.${group}`),
        }))}
        onChange={(entity) =>
          onChange({ entity: entity as AuditEntityGroup | null })
        }
      />
      <Filter label={translate("audit.filters.search")}>
        <Input
          type="search"
          className="w-64 rounded-md"
          aria-label={translate("audit.filters.search")}
          placeholder={translate("audit.filters.search_placeholder")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Filter>
    </div>
  );
};

const Filter = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
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
      <SelectTrigger className="w-52 rounded-md" aria-label={label}>
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
