import { useGetList, useTranslate, type Identifier } from "ra-core";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import type { Deal } from "../types";
import type { MisAppointment } from "./types";

const dateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const useMisVisits = (filter: Record<string, unknown>, enabled = true) =>
  useGetList<MisAppointment>(
    "mis_appointments",
    {
      filter,
      sort: { field: "starts_at", order: "DESC" },
      pagination: { page: 1, perPage: 20 },
    },
    { enabled },
  );

/**
 * «Визиты из МИС» of a patient: the appointments the MIS connector synced
 * (date, status as the MIS words it, doctor, service). Nothing is shown for
 * a patient without synced visits. compact: inside the deal page.
 */
export const MisVisits = ({
  patientId,
  compact = false,
}: {
  patientId: Identifier;
  compact?: boolean;
}) => {
  const translate = useTranslate();
  const { data: visits = [] } = useMisVisits({ patient_id: patientId });
  if (!visits.length) return null;
  return (
    <section
      className={cn(
        "flex flex-col gap-2",
        compact ? "border-t border-border px-6 py-5" : "glass rounded-lg p-6",
      )}
      data-testid="mis-visits"
    >
      <h3
        className={cn(
          "font-semibold",
          compact ? "text-sm" : "mb-2 text-[15px]",
        )}
      >
        {translate("mis_connectors.visits.title")}
      </h3>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {visits.map((visit) => (
          <li key={visit.id} className="flex flex-col gap-0.5 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium tabular-nums">
                {dateTime(visit.completed_at ?? visit.starts_at)}
              </span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-xs font-semibold",
                  ["cancelled", "no_show"].includes(visit.status)
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-foreground",
                )}
              >
                {visit.status_label ||
                  translate(`mis_connectors.statuses.${visit.status}`)}
              </span>
            </div>
            <span className="text-muted-foreground">
              {[visit.service_name, visit.doctor_name]
                .filter(Boolean)
                .join(" · ") || translate("mis_connectors.visits.no_details")}
            </span>
            {!compact && visit.deal_id != null ? (
              <Link
                to={`/deals/${visit.deal_id}/show`}
                className="text-xs text-brand-link hover:underline"
              >
                {translate("mis_connectors.visits.open_deal")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
};

/** Small «МИС» mark of a deal synced from the MIS */
export const MisDealBadge = ({ deal }: { deal: Pick<Deal, "id"> }) => {
  const translate = useTranslate();
  const { data: visits = [] } = useMisVisits({ deal_id: deal.id });
  const kind = visits[0]?.kind;
  if (!kind) return null;
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center rounded-md border border-border px-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground"
      title={translate("mis_connectors.visits.badge_hint", {
        name: translate(`mis_connectors.name.${kind}`),
      })}
      data-testid="mis-badge"
    >
      {translate("mis_connectors.visits.badge")}
    </span>
  );
};
