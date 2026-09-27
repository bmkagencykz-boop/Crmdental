import type { DataProvider, Identifier } from "ra-core";

import { exportCsv, type ReportColumn } from "../../reports/csv";
import type { Deal } from "../../types";

type Named = {
  id: Identifier;
  name?: string;
  first_name?: string;
  last_name?: string;
};

const everything = {
  pagination: { page: 1, perPage: 1000 },
  sort: { field: "id", order: "ASC" as const },
  filter: {},
};

const localDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** The chosen deals as a CSV file, with names instead of ids */
export const exportDealsCsv = async (
  deals: Deal[],
  dataProvider: DataProvider,
  translate: (key: string, options?: any) => string,
) => {
  const load = async (resource: string) =>
    (
      await dataProvider.getList<Named & { id: Identifier }>(
        resource,
        everything,
      )
    ).data;
  const [stages, pipelines, services, sources, sales, tags] = await Promise.all(
    ["stages", "pipelines", "services", "lead_sources", "sales", "tags"].map(
      load,
    ),
  );
  const name = (list: Named[], id?: Identifier | null) => {
    const found = list.find((item) => String(item.id) === String(id));
    if (!found) return "";
    return (
      found.name ?? `${found.first_name ?? ""} ${found.last_name ?? ""}`.trim()
    );
  };
  const label = (column: string) => translate(`deal_list.columns.${column}`);
  const columns: ReportColumn<Deal>[] = [
    { label: "ID", render: (deal) => String(deal.id) },
    { label: label("name"), render: (deal) => deal.name ?? "" },
    {
      label: label("patient"),
      render: (deal) =>
        [deal.patient_last_name, deal.patient_first_name]
          .filter(Boolean)
          .join(" "),
    },
    { label: label("phone"), render: (deal) => deal.patient_phone ?? "" },
    {
      label: label("pipeline"),
      render: (deal) => name(pipelines, deal.pipeline_id),
    },
    { label: label("stage"), render: (deal) => name(stages, deal.stage_id) },
    {
      label: label("responsible"),
      render: (deal) => name(sales, deal.sales_id),
    },
    {
      label: label("service"),
      render: (deal) => name(services, deal.service_id),
    },
    { label: label("doctor"), render: (deal) => deal.doctor_name ?? "" },
    { label: label("source"), render: (deal) => name(sources, deal.source_id) },
    {
      label: label("plan_amount"),
      render: () => "",
      csv: (deal) => Number(deal.plan_amount ?? 0),
    },
    {
      label: label("paid_amount"),
      render: () => "",
      csv: (deal) => Number(deal.paid_amount ?? 0),
    },
    {
      label: label("created_at"),
      render: (deal) => localDateTime(deal.created_at),
    },
    {
      label: label("next_task"),
      render: (deal) =>
        [localDateTime(deal.next_task_due_at), deal.next_task_text]
          .filter(Boolean)
          .join(" "),
    },
    {
      label: label("tags"),
      render: (deal) =>
        (deal.tags ?? []).map((id) => name(tags, id)).join(", "),
    },
  ];
  await exportCsv("deals", columns, deals);
};
