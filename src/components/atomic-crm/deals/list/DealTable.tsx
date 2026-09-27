import { ArrowDown, ArrowUp } from "lucide-react";
import {
  useGetList,
  useListContext,
  useTranslate,
  type Identifier,
} from "ra-core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  findById,
  useLeadSources,
  usePipelines,
  useServices,
  useStages,
} from "../../dictionaries/useDictionaries";
import { accent } from "../../misc/accent";
import { useConfigurationContext } from "../../root/ConfigurationContext";
import type { Deal, Sale, Tag } from "../../types";
import { formatMoney } from "../kanbanFormat";
import { getDealTaskState } from "../taskState";
import {
  COLUMN_SORT,
  visibleColumns,
  type ColumnSettings,
  type DealColumnId,
} from "./columns";

const pad = (value: number) => String(value).padStart(2, "0");
const formatDate = (value?: string | null, withTime = false) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  return withTime
    ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    : day;
};

/** Columns sorted from the latest first on the first click */
const DESC_FIRST = new Set<DealColumnId>([
  "created_at",
  "last_activity_at",
  "plan_amount",
  "paid_amount",
]);

/**
 * The dense table of the deal list (amoCRM «Список»): chosen columns in the
 * chosen order, sort by a click on a header, a checkbox per row and «all on
 * the page» in the header.
 */
export const DealTable = ({ settings }: { settings: ColumnSettings }) => {
  const translate = useTranslate();
  const {
    data,
    isPending,
    sort,
    setSort,
    selectedIds,
    onSelect,
    onToggleItem,
  } = useListContext<Deal>();
  const cell = useCellRenderer();
  const columns = visibleColumns(settings);
  const pageIds = (data ?? []).map((deal) => deal.id);
  const allOnPage =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const someOnPage = pageIds.some((id) => selectedIds.includes(id));

  const togglePage = () =>
    onSelect(
      allOnPage
        ? selectedIds.filter((id) => !pageIds.includes(id))
        : [
            ...selectedIds,
            ...pageIds.filter((id) => !selectedIds.includes(id)),
          ],
    );

  const sortBy = (column: DealColumnId) => {
    const field = COLUMN_SORT[column];
    if (!field) return;
    setSort({
      field,
      order:
        sort.field === field
          ? sort.order === "ASC"
            ? "DESC"
            : "ASC"
          : DESC_FIRST.has(column)
            ? "DESC"
            : "ASC",
    });
  };

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-8 rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table
        className="w-full min-w-max text-[13px]"
        aria-label={translate("deal_list.title")}
      >
        <thead>
          <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
            <th className="w-9 px-3 py-2">
              <Checkbox
                aria-label={translate("deal_list.select_page")}
                checked={
                  allOnPage ? true : someOnPage ? "indeterminate" : false
                }
                onCheckedChange={togglePage}
              />
            </th>
            {columns.map((column) => {
              const field = COLUMN_SORT[column];
              const active = field != null && sort.field === field;
              return (
                <th
                  key={column}
                  className={cn(
                    "px-3 py-2 font-semibold whitespace-nowrap",
                    NUMERIC.has(column) && "text-right",
                  )}
                  aria-sort={
                    active
                      ? sort.order === "ASC"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {field ? (
                    <button
                      type="button"
                      onClick={() => sortBy(column)}
                      className={cn(
                        "inline-flex items-center gap-1 uppercase hover:text-foreground",
                        active && "text-foreground",
                      )}
                    >
                      {translate(`deal_list.columns.${column}`)}
                      {active ? (
                        sort.order === "ASC" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : null}
                    </button>
                  ) : (
                    translate(`deal_list.columns.${column}`)
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((deal) => {
            const selected = selectedIds.includes(deal.id);
            return (
              <tr
                key={deal.id}
                className={cn(
                  "border-b last:border-0 transition-colors hover:bg-muted/40",
                  selected && "bg-primary/[0.06]",
                )}
              >
                <td className="px-3 py-1.5">
                  <Checkbox
                    aria-label={translate("deal_list.select_deal", {
                      name: deal.name ?? deal.id,
                    })}
                    checked={selected}
                    onCheckedChange={() => onToggleItem(deal.id)}
                  />
                </td>
                {columns.map((column) => (
                  <td
                    key={column}
                    className={cn(
                      "max-w-[16rem] px-3 py-1.5 align-middle",
                      NUMERIC.has(column) && "text-right tabular-nums",
                    )}
                  >
                    {cell(column, deal)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!data?.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {translate("deal_list.empty")}
        </p>
      ) : null}
    </div>
  );
};

const NUMERIC = new Set<DealColumnId>(["plan_amount", "paid_amount"]);

/** Content of a cell, with the dictionaries loaded once for the table */
const useCellRenderer = () => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: stages } = useStages();
  const { data: pipelines } = usePipelines();
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "last_name", order: "ASC" },
  });
  const { data: tags = [] } = useGetList<Tag>("tags", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "name", order: "ASC" },
  });
  const now = new Date();
  const name = (
    list: Array<{ id: Identifier; name: string }>,
    id?: Identifier | null,
  ) => findById(list, id)?.name ?? "—";

  return (column: DealColumnId, deal: Deal): ReactNode => {
    switch (column) {
      case "name":
        return (
          <Link
            to={`/deals/${deal.id}/show`}
            className="block truncate font-semibold text-brand-link no-underline hover:underline"
          >
            {deal.name || translate("deal_list.no_name")}
          </Link>
        );
      case "patient": {
        const patient =
          [deal.patient_last_name, deal.patient_first_name]
            .filter(Boolean)
            .join(" ") || "—";
        return (
          <Link
            to={`/patients/${deal.patient_id}/show`}
            className="block truncate text-foreground no-underline hover:underline"
          >
            {patient}
          </Link>
        );
      }
      case "phone":
        return deal.patient_phone ? (
          <a
            href={`tel:${deal.patient_phone}`}
            className="whitespace-nowrap tabular-nums text-foreground no-underline hover:underline"
          >
            {deal.patient_phone}
          </a>
        ) : (
          "—"
        );
      case "stage": {
        const stage = findById(stages, deal.stage_id);
        return stage ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: accent(stage.color) }}
              aria-hidden
            />
            {stage.name}
          </span>
        ) : (
          "—"
        );
      }
      case "pipeline":
        return name(pipelines, deal.pipeline_id);
      case "responsible": {
        const sale = sales.find((s) => String(s.id) === String(deal.sales_id));
        return sale ? (
          <span className="whitespace-nowrap">
            {`${sale.first_name} ${sale.last_name}`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {translate("crm.deals.unassigned")}
          </span>
        );
      }
      case "service":
        return name(services, deal.service_id);
      case "doctor":
        return deal.doctor_name ?? "—";
      case "source":
        return name(sources, deal.source_id);
      case "plan_amount":
        return formatMoney(deal.plan_amount, currency ?? "KZT");
      case "paid_amount":
        return formatMoney(deal.paid_amount, currency ?? "KZT");
      case "created_at":
        return (
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(deal.created_at)}
          </span>
        );
      case "last_activity_at":
        return (
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(deal.last_activity_at ?? deal.updated_at, true)}
          </span>
        );
      case "next_task": {
        const state = getDealTaskState(deal, now);
        if (state === "closed" && !deal.next_task_due_at) return "—";
        if (state === "no_task") {
          return (
            <span className="whitespace-nowrap font-medium text-brand-yellow">
              {translate("deal_list.no_task")}
            </span>
          );
        }
        return (
          <span
            className={cn(
              "flex min-w-0 flex-col",
              state === "overdue" && "text-brand-red",
            )}
          >
            <span className="whitespace-nowrap font-medium tabular-nums">
              {formatDate(deal.next_task_due_at, true)}
            </span>
            {deal.next_task_text ? (
              <span
                className={cn(
                  "truncate text-xs",
                  state !== "overdue" && "text-muted-foreground",
                )}
              >
                {deal.next_task_text}
              </span>
            ) : null}
          </span>
        );
      }
      case "tags":
        return deal.tags?.length ? (
          <span className="flex flex-wrap gap-1">
            {deal.tags.map((id) => {
              const tag = tags.find((t) => String(t.id) === String(id));
              return tag ? (
                <span
                  key={id}
                  className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] whitespace-nowrap"
                >
                  {tag.name}
                </span>
              ) : null;
            })}
          </span>
        ) : null;
    }
  };
};
