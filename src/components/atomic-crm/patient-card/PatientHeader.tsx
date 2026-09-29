import { useGetList, useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { findById, useDoctors } from "../dictionaries/useDictionaries";
import { formatPhone } from "../misc/formatPhone";
import { PaymentDialog } from "../payments/PaymentDialog";
import {
  money,
  usePatientAccount,
  usePaymentRights,
} from "../payments/usePayments";
import { patientDisplayName } from "../patients/parsePatientText";
import { TagsList } from "../patients/TagsList";
import { toHm } from "../schedule/scheduleLayout";
import type { Visit } from "../schedule/types";
import { useScheduleSettings } from "../schedule/useSchedule";
import { VisitDialog } from "../schedule/VisitDialog";
import { AddToWaitingListButton } from "../waiting-list/WaitingListBlock";
import { addDays, todayKey } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import { usePlanRights } from "../treatment/useTreatmentPlans";
import type { Deal, Patient, Sale } from "../types";
import { ruDate } from "./consents";
import { neverCame } from "./cardLogic";
import { ageOn, ageText, formatIin } from "./iin";

/** wa.me link of a Kazakh number */
const whatsappLink = (phone: string) =>
  `https://wa.me/${phone.replace(/\D/g, "")}`;

/**
 * The header of the patient card (stage 37): the name, large and light;
 * age and birth date, card number, IIN; phones to call or write; the
 * responsible and the doctor; tags; the balance or the debt (stage 36) and
 * «1В» for a patient who has never come; «Записать», «Новый план лечения»,
 * «Принять оплату», «Написать».
 */
export const PatientHeader = ({
  patient,
  deals,
  visits,
  canSeeMoney,
}: {
  patient: Patient;
  deals: Deal[];
  visits: Visit[];
  canSeeMoney: boolean;
}) => {
  const translate = useTranslate();
  const timeZone = useClinicTimeZone();
  const { data: doctors } = useDoctors();
  const { data: staff = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "last_name", order: "ASC" },
  });
  const { misKind } = useScheduleSettings();
  const payments = usePaymentRights();
  const { canEdit: canPlan } = usePlanRights();
  const { data: account } = usePatientAccount(canSeeMoney ? patient.id : null);
  const [booking, setBooking] = useState(false);
  const [paying, setPaying] = useState(false);

  const name = patientDisplayName(patient);
  const age = ageOn(patient.birth_date);
  const phones = patient.phones?.length
    ? patient.phones
    : (patient.phone_jsonb ?? []).map((phone) => phone.number).filter(Boolean);
  const responsible = staff.find((sale) => sameId(sale.id, patient.sales_id));
  const lastDeal =
    deals.find((deal) => !deal.archived_at) ?? (deals[0] as Deal | undefined);
  const doctorId =
    patient.preferred_doctor_id ??
    visits.find((visit) => visit.doctor_id != null)?.doctor_id ??
    lastDeal?.doctor_id ??
    null;
  const doctor = findById(doctors, doctorId as Identifier | undefined);
  const firstVisit = neverCame(visits);
  const debt = account?.debt ?? 0;
  const deposit = account?.deposit ?? 0;
  const advance = account?.advance ?? 0;

  return (
    <section
      className="relative overflow-hidden rounded-[28px] bg-card p-6"
      aria-label={name}
      data-testid="patient-header"
    >
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 text-[34px] leading-tight font-light tracking-[-0.03em]">
              {name}
            </h1>
            {firstVisit ? (
              <span
                className="rounded-full bg-neon px-3 py-1 text-xs font-semibold text-neon-ink"
                title={translate("patient_card.header.first_visit_hint")}
                data-testid="first-visit"
              >
                {translate("patient_card.header.first_visit")}
              </span>
            ) : null}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {age != null ? (
              <span className="text-foreground">{ageText(age)}</span>
            ) : null}
            {patient.birth_date ? (
              <span>
                {translate("patient_card.header.born", {
                  date: ruDate(patient.birth_date),
                })}
              </span>
            ) : null}
            {patient.gender ? (
              <span>
                {translate(`patient_card.header.gender.${patient.gender}`, {
                  _: patient.gender,
                })}
              </span>
            ) : null}
            <span data-testid="patient-card-number">
              {translate("patient_card.header.card", {
                number: patient.card_number || patient.id,
              })}
            </span>
            <span className="tabular-nums" data-testid="patient-iin">
              {patient.iin
                ? translate("patient_card.header.iin", {
                    iin: formatIin(patient.iin),
                  })
                : translate("patient_card.header.no_iin")}
            </span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {phones.map((phone) => (
              <span
                key={phone}
                className="flex items-center rounded-full bg-pill text-sm"
              >
                <a
                  href={`tel:${phone}`}
                  className="rounded-full px-3 py-1.5 tabular-nums text-foreground no-underline hover:bg-pill-hover"
                  title={translate("patient_card.header.call")}
                >
                  {formatPhone(phone)}
                </a>
                <a
                  href={whatsappLink(patient.whatsapp || phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full px-2.5 py-1.5 text-xs text-muted-foreground no-underline hover:bg-pill-hover hover:text-foreground"
                  aria-label={`${translate("patient_card.header.whatsapp")} ${formatPhone(phone)}`}
                >
                  WA
                </a>
              </span>
            ))}
            {responsible ? (
              <Fact label={translate("patient_card.header.responsible")}>
                {`${responsible.first_name} ${responsible.last_name}`}
              </Fact>
            ) : null}
            {doctor ? (
              <Fact label={translate("patient_card.header.doctor")}>
                {doctor.name}
              </Fact>
            ) : null}
            <TagsList />
          </div>
          {patient.allergies?.trim() ? (
            <p
              className="mt-3 w-fit rounded-full bg-tone-red/10 px-3 py-1.5 text-sm text-tone-red"
              data-testid="patient-allergy"
            >
              {translate("patient_card.header.allergy", {
                text: patient.allergies.trim(),
              })}
            </p>
          ) : null}
        </div>

        {canSeeMoney && account ? (
          <div
            className="flex flex-wrap items-stretch gap-2"
            data-testid="patient-money"
          >
            <MoneyChip
              label={translate("patient_card.header.balance")}
              value={money(account.balance ?? 0)}
              tone={(account.balance ?? 0) < 0 ? "debt" : "plain"}
            />
            {debt > 0 ? (
              <MoneyChip
                label={translate("patient_card.header.debt")}
                value={money(debt)}
                tone="debt"
              />
            ) : null}
            {deposit > 0 ? (
              <MoneyChip
                label={translate("patient_card.header.deposit")}
                value={money(deposit)}
                tone="plain"
              />
            ) : null}
            {advance > 0 ? (
              <MoneyChip
                label={translate("patient_card.header.advance")}
                value={money(advance)}
                tone="plain"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {!misKind && payments.canAccept ? (
          <Button onClick={() => setBooking(true)}>
            {translate("patient_card.header.actions.book")}
          </Button>
        ) : null}
        {canPlan ? (
          <Button variant="outline" className="bg-background" asChild>
            <Link
              to={`/patients/${patient.id}/plans/new${lastDeal ? `?deal_id=${lastDeal.id}` : ""}`}
            >
              {translate("patient_card.header.actions.new_plan")}
            </Link>
          </Button>
        ) : null}
        {canSeeMoney && payments.canAccept ? (
          <Button
            variant="outline"
            className="bg-background"
            onClick={() => setPaying(true)}
          >
            {translate("patient_card.header.actions.pay")}
          </Button>
        ) : null}
        {lastDeal ? (
          <Button variant="outline" className="bg-background" asChild>
            <Link
              to={`/deals/${lastDeal.id}/show`}
              title={translate("patient_card.header.actions.write_hint")}
            >
              {translate("patient_card.header.actions.write")}
            </Link>
          </Button>
        ) : null}
        {/* «В лист ожидания» (stage 38) */}
        <AddToWaitingListButton
          draft={{
            patient_id: patient.id,
            deal_id: lastDeal && !lastDeal.archived_at ? lastDeal.id : null,
            doctor_id: doctorId,
            service_id: lastDeal?.service_id ?? null,
            branch_id: lastDeal?.branch_id ?? null,
          }}
          className="bg-background"
        />
        <Button variant="ghost" asChild>
          <Link to={`/patients/${patient.id}`}>
            {translate("patient_card.header.actions.edit")}
          </Link>
        </Button>
      </div>

      {booking ? (
        <VisitDialog
          open
          onClose={() => setBooking(false)}
          draft={{
            patient_id: patient.id,
            deal_id: lastDeal && !lastDeal.archived_at ? lastDeal.id : null,
            doctor_id: doctorId,
            service_id: lastDeal?.service_id ?? null,
            day: addDays(todayKey(timeZone), 1),
            time: toHm(10 * 60),
            duration: doctor?.visit_minutes ?? undefined,
          }}
        />
      ) : null}
      {paying ? (
        <PaymentDialog
          open
          onOpenChange={setPaying}
          patientId={patient.id}
          dealId={lastDeal?.id ?? null}
        />
      ) : null}
    </section>
  );
};

const sameId = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const Fact = ({ label, children }: { label: string; children: string }) => (
  <span className="rounded-full bg-pill px-3 py-1.5 text-sm">
    <span className="text-muted-foreground">{label} </span>
    {children}
  </span>
);

const MoneyChip = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "plain" | "debt";
}) => (
  <div
    className={cn(
      "flex min-w-32 flex-col justify-between rounded-2xl px-4 py-3",
      tone === "debt" ? "bg-neon text-neon-ink" : "bg-background",
    )}
  >
    <span
      className={cn(
        "text-xs",
        tone === "debt" ? "text-neon-ink/80" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
    <span className="mt-1 text-[22px] leading-none font-light tracking-[-0.02em] tabular-nums">
      {value}
    </span>
  </div>
);
