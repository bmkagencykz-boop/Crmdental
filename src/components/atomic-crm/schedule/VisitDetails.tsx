import {
  useCanAccess,
  useDataProvider,
  useGetOne,
  useLocaleState,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  findById,
  useDoctors,
  useServices,
} from "../dictionaries/useDictionaries";
import { patientDisplayName } from "../patients/parsePatientText";
import type { CrmDataProvider } from "../providers/types";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Patient } from "../types";
import { visitDuration } from "./scheduleLayout";
import type { Visit, VisitStatus } from "./types";
import { useChairs } from "./useSchedule";
import { useVisitStatus } from "./useVisitStatus";
import {
  formatDateTime,
  formatTime,
  STATUS_ACTIONS,
  STATUS_DOT,
} from "./visitStyles";

/** Status of a visit as a small badge */
export const VisitStatusBadge = ({
  status,
  className,
}: {
  status: VisitStatus;
  className?: string;
}) => {
  const translate = useTranslate();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-xs font-medium",
        className,
      )}
      data-status={status}
    >
      <span className={cn("size-2 rounded-sm", STATUS_DOT[status])} />
      {translate(`schedule.statuses.${status}`)}
    </span>
  );
};

/**
 * The popover of a visit: patient (phone), time, doctor, chair, service,
 * note; the status buttons (Подтвердил / Пришёл / Не пришёл / Отменил /
 * Завершён), links to the deal and the patient, edit and delete (owner and
 * head). A visit of the MIS is read-only.
 */
export const VisitDetails = ({
  visit,
  onEdit,
  onDone,
}: {
  visit: Visit;
  onEdit: () => void;
  onDone: () => void;
}) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const timeZone = useClinicTimeZone();
  const { data: doctors } = useDoctors();
  const { data: services } = useServices();
  const { data: chairs } = useChairs();
  const { data: patient } = useGetOne<Patient>("patients", {
    id: visit.patient_id,
  });
  const { setStatus, pending } = useVisitStatus();
  const { canAccess: canDelete } = useCanAccess({
    resource: "visits",
    action: "delete",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = visit.source === "mis";
  const phone = patient?.phones?.[0] ?? patient?.phone_jsonb?.[0]?.number;

  const remove = async () => {
    try {
      await dataProvider.delete("visits", {
        id: visit.id,
        previousData: visit,
      });
      notify("schedule.popover.deleted", { type: "info" });
      refresh();
      onDone();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="visit-details">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/patients/${visit.patient_id}/show`}
            className="font-semibold text-brand-link hover:underline"
          >
            {patientDisplayName(patient) || "…"}
          </Link>
          {phone ? (
            <div className="text-xs tabular-nums text-muted-foreground">
              {phone}
            </div>
          ) : null}
        </div>
        <VisitStatusBadge status={visit.status} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">
          {translate("schedule.fields.time")}
        </dt>
        <dd>
          {formatDateTime(visit.starts_at, timeZone, locale)}–
          {formatTime(visit.ends_at, timeZone)} ·{" "}
          {translate("schedule.minutes", { count: visitDuration(visit) })}
        </dd>
        <dt className="text-muted-foreground">
          {translate("schedule.fields.doctor")}
        </dt>
        <dd>{findById(doctors, visit.doctor_id)?.name ?? "—"}</dd>
        <dt className="text-muted-foreground">
          {translate("schedule.fields.chair")}
        </dt>
        <dd>{findById(chairs, visit.chair_id)?.name ?? "—"}</dd>
        <dt className="text-muted-foreground">
          {translate("schedule.fields.service")}
        </dt>
        <dd>{findById(services, visit.service_id)?.name ?? "—"}</dd>
        {visit.note ? (
          <>
            <dt className="text-muted-foreground">
              {translate("schedule.fields.note")}
            </dt>
            <dd className="whitespace-pre-line break-words">{visit.note}</dd>
          </>
        ) : null}
      </dl>
      {readOnly ? (
        <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {translate("schedule.mis.readonly")}
        </p>
      ) : (
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={translate("schedule.popover.status")}
        >
          {STATUS_ACTIONS.map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={visit.status === status ? "default" : "outline"}
              aria-pressed={visit.status === status}
              className="h-7 px-2 text-xs"
              disabled={pending}
              onClick={() => setStatus(visit, status)}
            >
              {translate(`schedule.actions.${status}`)}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs">
        {visit.deal_id != null ? (
          <Link
            to={`/deals/${visit.deal_id}/show`}
            className="text-brand-link hover:underline"
          >
            {translate("schedule.popover.open_deal")}
          </Link>
        ) : null}
        <Link
          to={`/patients/${visit.patient_id}/show`}
          className="text-brand-link hover:underline"
        >
          {translate("schedule.popover.open_patient")}
        </Link>
        {!readOnly ? (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="text-brand-link hover:underline"
            >
              {translate("schedule.popover.edit")}
            </button>
            {canDelete ? (
              confirmDelete ? (
                <button
                  type="button"
                  onClick={remove}
                  className="font-semibold text-destructive hover:underline"
                >
                  {translate("schedule.popover.confirm_delete")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-muted-foreground hover:text-destructive hover:underline"
                >
                  {translate("schedule.popover.delete")}
                </button>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
};
