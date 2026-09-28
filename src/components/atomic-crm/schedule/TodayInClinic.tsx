import { useCanAccess, useGetMany, useTranslate } from "ra-core";
import { useMemo } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";

import { patientDisplayName } from "../patients/parsePatientText";
import {
  addDays,
  dayKeyOf,
  todayKey,
  zonedMoment,
} from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Patient } from "../types";
import { countByStatus } from "./scheduleLayout";
import { VISIT_STATUSES } from "./types";
import { useVisits } from "./useSchedule";
import { StatusGlyph } from "./StatusGlyph";
import { formatTime } from "./visitStyles";

/** Visits of tomorrow listed before «ещё N» */
const PREVIEW = 4;

/**
 * Dashboard widget «Сегодня в клинике»: today's visits by status and the
 * visits of tomorrow the patients have not confirmed yet (to call them).
 */
export const TodayInClinic = () => {
  const { canAccess, isPending } = useCanAccess({
    resource: "visits",
    action: "list",
  });
  if (isPending || !canAccess) return null;
  return <TodayInClinicCard />;
};

const TodayInClinicCard = () => {
  const translate = useTranslate();
  const timeZone = useClinicTimeZone();
  const today = todayKey(timeZone);
  const tomorrow = addDays(today, 1);
  const from = useMemo(
    () => zonedMoment(today, 0, timeZone),
    [today, timeZone],
  );
  const to = useMemo(
    () => zonedMoment(addDays(today, 2), 0, timeZone),
    [today, timeZone],
  );
  const { data: visits } = useVisits(from, to);
  const todays = visits.filter(
    (visit) => dayKeyOf(visit.starts_at, timeZone) === today,
  );
  const unconfirmed = visits.filter(
    (visit) =>
      visit.status === "scheduled" &&
      dayKeyOf(visit.starts_at, timeZone) === tomorrow,
  );
  const counts = countByStatus(todays);
  const { data: patients = [] } = useGetMany<Patient>(
    "patients",
    { ids: unconfirmed.slice(0, PREVIEW).map((visit) => visit.patient_id) },
    { enabled: unconfirmed.length > 0 },
  );

  return (
    <div className="flex flex-col gap-2" data-testid="today-in-clinic">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">
          {translate("schedule.dashboard.title")}
        </h2>
        <Link
          to="/schedule"
          className="text-xs text-brand-link hover:underline"
        >
          {translate("schedule.dashboard.open")}
        </Link>
      </div>
      <Card className="gap-2 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">
            {todays.length}
          </span>
          <span className="text-xs text-muted-foreground">
            {translate("schedule.dashboard.visits", {
              smart_count: todays.length,
            })}
          </span>
        </div>
        {todays.length ? (
          <ul className="flex flex-col gap-0.5 text-xs">
            {VISIT_STATUSES.filter((status) => counts[status]).map((status) => (
              <li key={status} className="flex items-center gap-1.5">
                <StatusGlyph status={status} className="size-3.5" />
                <span className="flex-1">
                  {translate(`schedule.statuses.${status}`)}
                </span>
                <span className="font-semibold tabular-nums">
                  {counts[status]}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="border-t border-border pt-2 text-xs">
          {unconfirmed.length ? (
            <>
              <Link
                to={`/schedule?day=${tomorrow}`}
                className="font-semibold text-warn hover:underline"
              >
                {translate("schedule.dashboard.unconfirmed", {
                  smart_count: unconfirmed.length,
                })}
              </Link>
              <ul className="mt-1 flex flex-col gap-0.5">
                {unconfirmed.slice(0, PREVIEW).map((visit) => {
                  const patient = patients.find(
                    (p) => String(p.id) === String(visit.patient_id),
                  );
                  return (
                    <li key={visit.id} className="flex gap-2">
                      <span className="tabular-nums text-muted-foreground">
                        {formatTime(visit.starts_at, timeZone)}
                      </span>
                      {visit.deal_id != null ? (
                        <Link
                          to={`/deals/${visit.deal_id}/show`}
                          className="truncate hover:underline"
                        >
                          {patientDisplayName(patient) || "…"}
                        </Link>
                      ) : (
                        <span className="truncate">
                          {patientDisplayName(patient) || "…"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <span className="text-muted-foreground">
              {translate("schedule.dashboard.all_confirmed")}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
};
