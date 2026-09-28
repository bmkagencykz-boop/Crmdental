import { useCanAccess, useNotify, useTranslate, useUpdate } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import {
  findById,
  toDoctorChoices,
  useDoctors,
} from "../dictionaries/useDictionaries";
import { formatTenge } from "../onboarding/servicePresets";
import type { Patient } from "../types";
import { MEDICAL_FIELDS, type MedicalField } from "./medical";
import { MainPlanMark, PlanStatusBadge } from "./PlanBits";
import { AGREED_STATUSES } from "./types";
import { usePlans } from "./useTreatmentPlans";

const tenge = (amount: number) => `${formatTenge(amount)} ₸`;

/**
 * «Медицинская справка» of the patient card (stage 29): allergies,
 * contraindications, chronic diseases (free text, edited in place) and the
 * preferred doctor. Not a medical record: what the administrator must know
 * before booking and selling a treatment.
 */
export const PatientMedical = ({ patient }: { patient: Patient }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const [update] = useUpdate();
  const { data: doctors } = useDoctors();
  const { canAccess: canEdit = false } = useCanAccess({
    resource: "patients",
    action: "edit",
  });
  const save = (data: Partial<Patient>) =>
    update(
      "patients",
      { id: patient.id, data, previousData: patient },
      {
        mutationMode: "pessimistic",
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );

  return (
    <dl
      className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-1.5 text-sm"
      data-testid="patient-medical"
    >
      {MEDICAL_FIELDS.map((field) => (
        <MedicalRow
          key={field}
          field={field}
          value={patient[field] ?? null}
          canEdit={canEdit}
          onSave={(value) => save({ [field]: value })}
        />
      ))}
      <dt className="py-1 text-muted-foreground">
        {translate("treatment.patient.preferred_doctor")}
      </dt>
      <dd>
        {canEdit ? (
          <select
            value={
              patient.preferred_doctor_id == null
                ? ""
                : String(patient.preferred_doctor_id)
            }
            aria-label={translate("treatment.patient.preferred_doctor")}
            onChange={(event) =>
              save({
                preferred_doctor_id:
                  event.target.value === ""
                    ? null
                    : (findById(doctors, event.target.value)?.id ??
                      event.target.value),
              })
            }
            className="soft h-8 w-full max-w-xs rounded-md border-0 px-2 text-sm"
          >
            <option value="">{translate("treatment.patient.not_set")}</option>
            {toDoctorChoices(doctors, patient.preferred_doctor_id).map(
              (doctor) => (
                <option key={doctor.id} value={String(doctor.id)}>
                  {doctor.name}
                </option>
              ),
            )}
          </select>
        ) : (
          <span className="py-1">
            {findById(doctors, patient.preferred_doctor_id)?.name ??
              translate("treatment.patient.not_set")}
          </span>
        )}
      </dd>
    </dl>
  );
};

const MedicalRow = ({
  field,
  value,
  canEdit,
  onSave,
}: {
  field: MedicalField;
  value: string | null;
  canEdit: boolean;
  onSave: (value: string | null) => void;
}) => {
  const translate = useTranslate();
  const [editing, setEditing] = useState(false);
  const label = translate(`treatment.patient.${field}`);
  // Allergies are the one thing nobody may miss
  const alert = field === "allergies" && !!value?.trim();
  return (
    <>
      <dt className="py-1 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {editing ? (
          <textarea
            autoFocus
            defaultValue={value ?? ""}
            rows={2}
            aria-label={label}
            onBlur={(event) => {
              setEditing(false);
              const next = event.target.value.trim() || null;
              if (next !== (value?.trim() || null)) onSave(next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
            className="field w-full rounded-md border border-input px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setEditing(true)}
            aria-label={translate("treatment.patient.edit", { field: label })}
            className={cn(
              "w-full rounded-sm px-1 py-1 text-left whitespace-pre-line transition-colors enabled:hover:bg-muted/60",
              !value && "text-muted-foreground",
              alert && "font-semibold text-destructive",
            )}
          >
            {value?.trim() || translate("treatment.patient.not_set")}
          </button>
        )}
      </dd>
    </>
  );
};

/**
 * The patient's treatment plans across all deals, and the money: agreed in
 * the main plans, paid on those deals, and what is left to pay.
 */
export const PatientPlans = ({ patient }: { patient: Patient }) => {
  const translate = useTranslate();
  const { data: plans = [], isPending } = usePlans({ patient_id: patient.id });
  if (isPending) return null;
  const main = plans.filter(
    (plan) => plan.is_main && AGREED_STATUSES.includes(plan.status),
  );
  const agreed = main.reduce((sum, plan) => sum + plan.total_amount, 0);
  const paid = main.reduce(
    (sum, plan) => sum + Number(plan.deal_paid_amount ?? 0),
    0,
  );
  const balance = agreed - paid;

  return (
    <div className="flex flex-col gap-4">
      {main.length ? (
        <div
          className="grid grid-cols-3 gap-2 text-sm"
          aria-label={translate("treatment.patient.money")}
        >
          <Figure
            label={translate("treatment.patient.agreed_total")}
            value={tenge(agreed)}
          />
          <Figure
            label={translate("treatment.patient.paid")}
            value={tenge(paid)}
          />
          <Figure
            label={translate(
              balance >= 0
                ? "treatment.patient.balance"
                : "treatment.patient.overpaid",
            )}
            value={tenge(Math.abs(balance))}
            strong={balance > 0}
          />
        </div>
      ) : null}
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("treatment.patient.no_plans")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
          {[...plans].reverse().map((plan) => (
            <li key={plan.id}>
              <Link
                to={`/deals/${plan.deal_id}/show`}
                className="flex items-center gap-2 px-3 py-2 text-foreground no-underline transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {plan.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {plan.deal_name || translate("crm.deals.untitled")} ·{" "}
                    {translate("treatment.totals.progress", {
                      done: plan.done_count,
                      total: plan.items_count,
                    })}
                  </span>
                </span>
                <PlanStatusBadge status={plan.status} />
                {plan.is_main ? <MainPlanMark /> : null}
                <span className="w-28 shrink-0 text-right font-semibold tabular-nums">
                  {tenge(plan.total_amount)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Figure = ({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) => (
  <div className="rounded-md bg-card/70 px-3 py-2">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className={cn("font-semibold tabular-nums", strong && "text-primary")}>
      {value}
    </div>
  </div>
);
