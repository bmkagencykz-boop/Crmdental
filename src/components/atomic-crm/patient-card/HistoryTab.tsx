import { useGetList, useTranslate, type Identifier } from "ra-core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import { findById, useDoctors } from "../dictionaries/useDictionaries";
import { Molar3D } from "../misc/Dental3D";
import { money } from "../payments/usePayments";
import type { AccountOperation } from "../payments/types";
import type { Visit } from "../schedule/types";
import { planPath } from "../treatment/planUi";
import { usePlans } from "../treatment/useTreatmentPlans";
import type { Call, Deal, DealFile, Message } from "../types";
import { ruDate } from "./consents";
import {
  buildPatientHistory,
  filterHistory,
  groupByDay,
  type HistoryEvent,
  type HistoryKind,
} from "./history";
import {
  useMedicalRights,
  usePatientConsents,
  usePatientFiles,
  useToothHistory,
  useVisitRecords,
} from "./usePatientCard";

const KINDS: HistoryKind[] = [
  "deal",
  "messages",
  "call",
  "visit",
  "record",
  "payment",
  "plan",
  "file",
  "tooth",
  "consent",
];

const ALL = { page: 1, perPage: 1000 };

const time = (at: string) => {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const duration = (seconds: number) =>
  seconds >= 60
    ? `${Math.floor(seconds / 60)} мин ${seconds % 60} с`
    : `${seconds} с`;

/**
 * «История» of the patient card (stage 37): deals, the conversation (per
 * day and channel), calls, visits and their records, payments, plans,
 * files, the dental chart and the consents on one timeline, newest first,
 * with a filter by kind.
 */
export const HistoryTab = ({
  patientId,
  deals,
  visits,
  canSeeMoney,
}: {
  patientId: Identifier;
  deals: Deal[];
  visits: Visit[];
  canSeeMoney: boolean;
}) => {
  const translate = useTranslate();
  const rights = useMedicalRights();
  const medical = rights.canSee;
  const byPatient = { filter: { patient_id: patientId }, pagination: ALL };
  const { data: messages = [] } = useGetList<Message>("messages", {
    ...byPatient,
    sort: { field: "sent_at", order: "DESC" },
  });
  const { data: calls = [] } = useGetList<Call & { id: Identifier }>("calls", {
    ...byPatient,
    sort: { field: "called_at", order: "DESC" },
  });
  const { data: operations = [] } = useGetList<AccountOperation>(
    "account_operations",
    { ...byPatient, sort: { field: "occurred_at", order: "DESC" } },
    { enabled: canSeeMoney },
  );
  const { data: plans = [] } = usePlans({
    patient_id: canSeeMoney ? patientId : undefined,
  });
  const { data: dealFiles = [] } = useGetList<DealFile>("deal_files", {
    ...byPatient,
    sort: { field: "created_at", order: "DESC" },
  });
  const { data: records = [] } = useVisitRecords(patientId, medical);
  const { data: patientFiles = [] } = usePatientFiles(patientId, medical);
  const { data: teeth = [] } = useToothHistory(patientId, medical);
  const { data: consents = [] } = usePatientConsents(patientId, medical);
  const { data: doctors } = useDoctors();
  const [kind, setKind] = useState<HistoryKind | null>(null);

  const events = useMemo(
    () =>
      buildPatientHistory({
        deals,
        messages,
        calls,
        visits,
        records: medical ? records : [],
        operations: canSeeMoney ? operations : [],
        plans: canSeeMoney ? plans : [],
        dealFiles,
        patientFiles: medical ? patientFiles : [],
        teeth: medical ? teeth : [],
        consents: medical ? consents : [],
      }),
    [
      deals,
      messages,
      calls,
      visits,
      records,
      operations,
      plans,
      dealFiles,
      patientFiles,
      teeth,
      consents,
      medical,
      canSeeMoney,
    ],
  );
  const present = new Set(events.map((event) => event.kind));
  const days = groupByDay(filterHistory(events, kind ? [kind] : null));
  const dealName = (id: Identifier | null | undefined) =>
    deals.find((deal) => String(deal.id) === String(id))?.name;

  const text = (event: HistoryEvent): string => {
    const d = event.data;
    switch (event.kind) {
      case "deal":
        return translate("patient_card.history.events.deal", {
          name: d.name || translate("crm.deals.untitled"),
        });
      case "messages":
        return translate("patient_card.history.events.messages", {
          transport: translate(
            `patient_card.history.transports.${d.transport}`,
            {
              _: String(d.transport),
            },
          ),
          count: d.count,
          incoming: d.incoming,
        });
      case "call":
        return translate(
          d.direction === "in"
            ? "patient_card.history.events.call_in"
            : "patient_card.history.events.call_out",
          { duration: duration(Number(d.duration ?? 0)) },
        );
      case "visit":
        return translate("patient_card.history.events.visit", {
          status: translate(`schedule.statuses.${d.status}`),
          doctor:
            findById(doctors, d.doctor_id as Identifier)?.name ??
            translate("schedule.deal.no_doctor"),
        });
      case "record":
        return translate("patient_card.history.events.record", {
          diagnosis:
            [((d.codes as string[]) ?? []).join(", "), d.diagnosis]
              .filter(Boolean)
              .join(" ") || "—",
        });
      case "payment":
        return translate("patient_card.history.events.payment", {
          kind: translate(`payments.kinds.${d.kind}`, { _: String(d.kind) }),
          amount: money(Number(d.amount ?? 0)),
        });
      case "plan":
        return translate(
          d.event === "agreed"
            ? "patient_card.history.events.plan_agreed"
            : "patient_card.history.events.plan_created",
          { name: d.name },
        );
      case "file":
        return translate("patient_card.history.events.file", {
          name: d.name,
          kind: d.kind
            ? translate(`patient_card.files.kinds.${d.kind}`)
            : translate("patient_card.files.deal_files"),
        });
      case "tooth":
        return translate(
          d.source === "plan"
            ? "patient_card.history.events.tooth_plan"
            : "patient_card.history.events.tooth",
          {
            tooth: d.tooth,
            before: d.state_before
              ? translate(`patient_card.chart.states.${d.state_before}`)
              : "—",
            after: d.state
              ? translate(`patient_card.chart.states.${d.state}`)
              : translate("patient_card.chart.cleared"),
          },
        );
      case "consent":
        return translate(
          d.signed_at
            ? "patient_card.history.events.consent_signed"
            : "patient_card.history.events.consent",
          { title: d.title },
        );
    }
  };

  const link = (event: HistoryEvent) => {
    if (event.kind === "plan")
      return planPath(patientId, event.data.id as Identifier);
    if (event.dealId != null) return `/deals/${event.dealId}/show`;
    return null;
  };

  return (
    <section
      className="rounded-[28px] bg-card p-6"
      data-testid="patient-history"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
          {translate("patient_card.history.title")}
        </h2>
        <div
          className="flex flex-wrap gap-1.5"
          role="tablist"
          aria-label={translate("patient_card.history.filter")}
        >
          {[null, ...KINDS.filter((k) => present.has(k))].map((value) => (
            <button
              key={value ?? "all"}
              type="button"
              role="tab"
              aria-selected={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                kind === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-pill text-foreground hover:bg-pill-hover",
              )}
            >
              {translate(`patient_card.history.kinds.${value ?? "all"}`)}
            </button>
          ))}
        </div>
      </div>
      {days.length ? (
        <ol className="flex flex-col gap-5">
          {days.map(([day, list]) => (
            <li key={day}>
              <p className="mb-2 text-xs text-muted-foreground">
                {ruDate(day)}
              </p>
              <ul className="flex flex-col gap-1.5">
                {list.map((event) => {
                  const to = link(event);
                  return (
                    <li
                      key={event.key}
                      className="flex items-baseline gap-3 rounded-2xl bg-background px-4 py-2.5 text-sm"
                      data-kind={event.kind}
                    >
                      <span className="w-11 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {time(event.at)}
                      </span>
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">
                        {translate(`patient_card.history.kinds.${event.kind}`)}
                      </span>
                      <span className="min-w-0 flex-1">{text(event)}</span>
                      {event.dealId != null && event.kind !== "deal" ? (
                        <span className="hidden truncate text-xs text-muted-foreground md:block">
                          {dealName(event.dealId)}
                        </span>
                      ) : null}
                      {to ? (
                        <Link
                          to={to}
                          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {translate("patient_card.history.open")}
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Molar3D tone="soft" className="h-24 w-20" />
          <p className="text-sm text-muted-foreground">
            {translate("patient_card.history.empty")}
          </p>
        </div>
      )}
    </section>
  );
};
