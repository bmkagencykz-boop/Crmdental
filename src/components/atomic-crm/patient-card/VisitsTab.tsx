import { useLocaleState, useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  findById,
  useDoctors,
  useServices,
} from "../dictionaries/useDictionaries";
import { Molar3D } from "../misc/Dental3D";
import type { Visit } from "../schedule/types";
import { VisitStatusBadge } from "../schedule/VisitDetails";
import { formatDateTime } from "../schedule/visitStyles";
import { dayKeyOf } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import { ruDate } from "./consents";
import { icdLabel } from "./icd10";
import type { VisitRecord } from "./types";
import { useMedicalRights, useVisitRecords } from "./usePatientCard";
import { VisitRecordDialog } from "./VisitRecordDialog";

/**
 * «Визиты» of the patient card (stage 37): every visit of the patient, the
 * CRM's and the MIS's, with the doctor, the service, the status and the
 * visit record («запись приёма»): diagnoses, treatment; records without a
 * visit are listed by their date.
 */
export const VisitsTab = ({
  patientId,
  visits,
}: {
  patientId: Identifier;
  visits: Visit[];
}) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const timeZone = useClinicTimeZone();
  const rights = useMedicalRights();
  const { data: doctors } = useDoctors();
  const { data: services } = useServices();
  const { data: records = [] } = useVisitRecords(patientId, rights.canSee);
  const [open, setOpen] = useState<{
    visit?: Visit;
    record?: VisitRecord;
  } | null>(null);

  const recordOf = (visit: Visit) =>
    records.find((record) => String(record.visit_id) === String(visit.id));
  const loose = records.filter((record) => record.visit_id == null);
  const rows = [
    ...visits.map((visit) => ({
      key: `v${visit.id}`,
      at: visit.starts_at,
      visit,
      record: recordOf(visit),
    })),
    ...loose.map((record) => ({
      key: `r${record.id}`,
      at: `${record.record_date ?? ""}T12:00:00`,
      visit: undefined,
      record,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section
      className="rounded-[28px] bg-card p-6"
      data-testid="patient-visits-tab"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("patient_card.visits.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate("patient_card.visits.subtitle", {
              smart_count: visits.length,
            })}
          </p>
        </div>
        {rights.canEdit ? (
          <Button variant="outline" onClick={() => setOpen({})}>
            {translate("patient_card.visits.new_record")}
          </Button>
        ) : null}
      </div>
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map(({ key, visit, record }) => (
            <li
              key={key}
              className="flex flex-wrap items-start gap-4 rounded-2xl bg-background px-4 py-3"
              data-testid="patient-visit-row"
            >
              <div className="w-44 shrink-0">
                {visit ? (
                  <Link
                    to={`/schedule?day=${dayKeyOf(visit.starts_at, timeZone)}`}
                    className={cn(
                      "text-sm font-medium tabular-nums text-foreground no-underline hover:underline",
                      visit.status === "cancelled" &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {formatDateTime(visit.starts_at, timeZone, locale)}
                  </Link>
                ) : (
                  <span className="text-sm font-medium tabular-nums">
                    {ruDate(record?.record_date)}
                  </span>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {visit ? <VisitStatusBadge status={visit.status} /> : null}
                  {visit?.source === "mis" ? (
                    <span className="rounded-full bg-pill px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                      {translate("schedule.mis.badge")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p>
                  {[
                    findById(
                      doctors,
                      (record?.doctor_id ?? visit?.doctor_id) as Identifier,
                    )?.name,
                    visit
                      ? findById(services, visit.service_id as Identifier)?.name
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || translate("schedule.deal.no_doctor")}
                </p>
                {record ? (
                  <div className="mt-1 flex flex-col gap-1">
                    {record.diagnosis_codes.length ? (
                      <div className="flex flex-wrap gap-1">
                        {record.diagnosis_codes.map((code) => (
                          <span
                            key={code}
                            className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
                            title={icdLabel(code)}
                          >
                            {code}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {record.diagnosis ? (
                      <p className="text-muted-foreground">
                        {record.diagnosis}
                      </p>
                    ) : null}
                    {record.treatment ? (
                      <p className="line-clamp-2 text-muted-foreground">
                        {record.treatment}
                      </p>
                    ) : null}
                  </div>
                ) : visit && ["arrived", "completed"].includes(visit.status) ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {translate("patient_card.visits.no_record")}
                  </p>
                ) : null}
                {visit?.deal_id != null ? (
                  <Link
                    to={`/deals/${visit.deal_id}/show`}
                    className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground"
                  >
                    {translate("schedule.popover.open_deal")}
                  </Link>
                ) : null}
              </div>
              {rights.canSee && (record || rights.canEdit) ? (
                <Button
                  size="sm"
                  variant={record ? "outline" : "default"}
                  onClick={() => setOpen({ visit, record })}
                >
                  {record
                    ? translate("patient_card.visits.open_record")
                    : translate("patient_card.visits.add_record")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Molar3D tone="soft" className="h-24 w-20" />
          <p className="text-sm text-muted-foreground">
            {translate("patient_card.visits.empty")}
          </p>
        </div>
      )}
      {open ? (
        <VisitRecordDialog
          open
          onClose={() => setOpen(null)}
          patientId={patientId}
          visit={open.visit}
          record={open.record}
        />
      ) : null}
    </section>
  );
};
