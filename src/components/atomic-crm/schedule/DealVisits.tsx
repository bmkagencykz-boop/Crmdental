import { useLocaleState, useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { findById, useDoctors } from "../dictionaries/useDictionaries";
import { addDays, dayKeyOf, todayKey } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Deal } from "../types";
import { toHm } from "./scheduleLayout";
import type { Visit } from "./types";
import { useScheduleSettings, useVisitsOf } from "./useSchedule";
import { VisitDialog } from "./VisitDialog";
import { VisitStatusBadge } from "./VisitDetails";
import { formatDateTime } from "./visitStyles";

/** A list of visits: date, doctor, status (and МИС), the link to the day */
export const VisitList = ({
  visits,
  showDeal = false,
}: {
  visits: Visit[];
  showDeal?: boolean;
}) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const timeZone = useClinicTimeZone();
  const { data: doctors } = useDoctors();
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {visits.map((visit) => (
        <li
          key={visit.id}
          className="flex flex-col gap-0.5 py-2"
          data-testid="visit-row"
          data-status={visit.status}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link
              to={`/schedule?day=${dayKeyOf(visit.starts_at, timeZone)}`}
              className={cn(
                "font-medium tabular-nums hover:underline",
                visit.status === "cancelled" &&
                  "text-muted-foreground line-through",
              )}
            >
              {formatDateTime(visit.starts_at, timeZone, locale)}
            </Link>
            <span className="flex items-center gap-1.5">
              {visit.source === "mis" ? (
                <span className="rounded-md border border-border px-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
                  {translate("schedule.mis.badge")}
                </span>
              ) : null}
              <VisitStatusBadge status={visit.status} />
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {[findById(doctors, visit.doctor_id)?.name, visit.note]
              .filter(Boolean)
              .join(" · ") || translate("schedule.deal.no_doctor")}
          </span>
          {showDeal && visit.deal_id != null ? (
            <Link
              to={`/deals/${visit.deal_id}/show`}
              className="text-xs text-brand-link hover:underline"
            >
              {translate("schedule.popover.open_deal")}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

/**
 * «Записи» of the deal page: the visits of the deal with their status and
 * «Записать», which opens the booking dialog with the deal, its patient,
 * doctor and service.
 */
export const DealVisits = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const timeZone = useClinicTimeZone();
  const { misKind } = useScheduleSettings();
  const { data: visits } = useVisitsOf("deal_id", deal.id);
  const [open, setOpen] = useState(false);
  const { data: doctors } = useDoctors();
  const tomorrow = addDays(todayKey(timeZone), 1);
  return (
    <section
      className="flex flex-col gap-2 border-t border-border px-5 py-4"
      data-testid="deal-visits"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {translate("schedule.deal.title")}
        </h3>
        {misKind ? (
          <span className="text-xs text-muted-foreground">
            {translate("schedule.mis.short")}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setOpen(true)}
          >
            {translate("schedule.deal.book")}
          </Button>
        )}
      </div>
      {visits.length ? (
        <VisitList visits={visits} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate("schedule.deal.empty")}
        </p>
      )}
      {open ? (
        <VisitDialog
          open
          onClose={() => setOpen(false)}
          draft={{
            patient_id: deal.patient_id,
            deal_id: deal.id,
            doctor_id: deal.doctor_id ?? null,
            service_id: deal.service_id ?? null,
            day: tomorrow,
            time: toHm(10 * 60),
            duration:
              findById(doctors, deal.doctor_id as Identifier | undefined)
                ?.visit_minutes ?? undefined,
          }}
        />
      ) : null}
    </section>
  );
};
