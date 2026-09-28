import type { ReactNode } from "react";
import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";
import { formatMoney } from "../deals/kanbanFormat";
import { useConfigurationContext } from "../root/ConfigurationContext";
import {
  formatPhone,
  fullName,
  highlightParts,
  parseSearchQuery,
  quickCreatePhone,
  type GlobalSearchResult,
  type SearchDeal,
  type SearchKind,
  type SearchMessage,
  type SearchPatient,
  type SearchTask,
} from "./globalSearch";
import type { RecentItem } from "./recent";

/** One line of the search dropdown or page, opened with Enter or a click */
export type SearchItem = {
  key: string;
  group: SearchKind | "recent" | "actions";
  to: string;
  /** Remembered in «Недавние» when opened */
  recent?: RecentItem;
  node: ReactNode;
};

/** Text with the query words in bold */
export const Highlight = ({ text, q }: { text: string; q: string }) => (
  <>
    {highlightParts(text, q).map((part, index) =>
      part.hit ? (
        <mark
          key={index}
          className="bg-transparent font-semibold text-foreground"
        >
          {part.text}
        </mark>
      ) : (
        <span key={index}>{part.text}</span>
      ),
    )}
  </>
);

const pad = (n: number) => String(n).padStart(2, "0");
export const formatDay = (value?: string | null) => {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d && m && y ? `${d}.${m}.${y}` : value;
};
const formatDayTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** The phone that matched the query first, formatted */
const shownPhone = (phones: string[], q: string) => {
  const query = parseSearchQuery(q);
  const digits = query?.phoneDigits;
  const hit = digits
    ? phones.find((p) => p.replace(/\D/g, "").includes(digits))
    : null;
  return formatPhone(hit ?? phones[0]);
};

const Line = ({
  title,
  details,
  aside,
}: {
  title: ReactNode;
  details?: ReactNode;
  aside?: ReactNode;
}) => (
  <div className="flex min-w-0 items-baseline gap-3">
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm text-foreground">{title}</div>
      {details ? (
        <div className="truncate text-xs text-muted-foreground">{details}</div>
      ) : null}
    </div>
    {aside ? (
      <div className="shrink-0 text-xs text-muted-foreground">{aside}</div>
    ) : null}
  </div>
);

const Dot = () => <span className="px-1 text-muted-foreground/60">·</span>;

/** Builds the lines of the results (dropdown and page share them) */
export const useSearchItems = (
  result: GlobalSearchResult | undefined,
  q: string,
): SearchItem[] => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  if (!result) return [];
  const noName = translate("search.no_name");

  const patient = (row: SearchPatient): SearchItem => {
    const phone = shownPhone(row.phones, q);
    const phoneHit = parseSearchQuery(q)?.isPhone;
    return {
      key: `patient-${row.id}`,
      group: "patients",
      to: `/patients/${row.id}/show`,
      recent: { kind: "patient", id: row.id },
      node: (
        <Line
          title={<Highlight text={fullName(row) || noName} q={q} />}
          details={
            <>
              {phone ? (
                <span
                  className={cn(phoneHit && "font-semibold text-foreground")}
                >
                  {phone}
                </span>
              ) : null}
              {row.birth_date ? (
                <>
                  {phone ? <Dot /> : null}
                  {translate("search.birth", {
                    date: formatDay(row.birth_date),
                  })}
                </>
              ) : null}
            </>
          }
          aside={
            <>
              {translate("search.card", { id: row.id })}
              {row.card ? (
                <>
                  <Dot />
                  {translate("search.mis_card", { card: row.card })}
                </>
              ) : null}
            </>
          }
        />
      ),
    };
  };

  const deal = (row: SearchDeal): SearchItem => ({
    key: `deal-${row.id}`,
    group: "deals",
    to: `/deals/${row.id}/show`,
    recent: { kind: "deal", id: row.id },
    node: (
      <Line
        title={
          <>
            <Highlight
              text={row.name || translate("search.no_deal_name")}
              q={q}
            />
            <span className="ml-2 text-xs text-muted-foreground">
              № {row.id}
            </span>
          </>
        }
        details={
          <>
            <Highlight
              text={
                fullName({
                  last_name: row.patient_last_name,
                  first_name: row.patient_first_name,
                }) || noName
              }
              q={q}
            />
            {row.stage_name ? (
              <>
                <Dot />
                <span
                  className="mr-1 inline-block size-2 rounded-full align-middle"
                  style={{ backgroundColor: row.stage_color ?? undefined }}
                />
                {row.stage_name}
              </>
            ) : null}
            {row.archived_at ? (
              <>
                <Dot />
                {translate("search.archived")}
              </>
            ) : null}
            {row.sales_name ? (
              <>
                <Dot />
                {row.sales_name}
              </>
            ) : null}
          </>
        }
        aside={
          row.plan_amount ? formatMoney(row.plan_amount, currency) : undefined
        }
      />
    ),
  });

  const task = (row: SearchTask): SearchItem => ({
    key: `task-${row.id}`,
    group: "tasks",
    to: `/deals/${row.deal_id}/show`,
    node: (
      <Line
        title={
          <span className={cn(row.done_date && "line-through opacity-70")}>
            <span className="font-medium">
              {translate(`crm.tasks.types.${row.type}`, { _: row.type })}
            </span>{" "}
            <Highlight text={row.text ?? ""} q={q} />
          </span>
        }
        details={
          <Highlight
            text={
              fullName({
                last_name: row.patient_last_name,
                first_name: row.patient_first_name,
              }) || noName
            }
            q={q}
          />
        }
        aside={
          row.done_date
            ? translate("search.task_done")
            : formatDayTime(row.due_date)
        }
      />
    ),
  });

  const message = (row: SearchMessage): SearchItem => ({
    key: `message-${row.id}`,
    group: "messages",
    to: `/deals/${row.deal_id}/show`,
    node: (
      <Line
        title={<Highlight text={row.snippet} q={q} />}
        details={
          <>
            {translate(
              row.direction === "in" ? "search.incoming" : "search.outgoing",
            )}
            <Dot />
            {fullName({
              last_name: row.patient_last_name,
              first_name: row.patient_first_name,
            }) || noName}
          </>
        }
        aside={formatDayTime(row.sent_at)}
      />
    ),
  });

  const items: SearchItem[] = [
    ...result.patients.map(patient),
    ...result.deals.map(deal),
    ...result.tasks.map(task),
    ...result.messages.map(message),
  ];
  // Nobody with this number: create the patient right away
  const phone = quickCreatePhone(q);
  if (phone && result.patients.length === 0) {
    items.push({
      key: "new-patient",
      group: "actions",
      to: `/patients/create?phone=${encodeURIComponent(phone)}`,
      node: (
        <span className="text-sm font-medium text-primary">
          {translate("search.new_patient_with_phone", {
            phone: formatPhone(phone),
          })}
        </span>
      ),
    });
  }
  return items;
};

export const groupLabel = (
  translate: ReturnType<typeof useTranslate>,
  group: SearchItem["group"],
) => (group === "actions" ? null : translate(`search.groups.${group}`));
