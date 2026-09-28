import { useGetOne, useTranslate } from "ra-core";
import { Link } from "react-router";

import { DuplicateWarning } from "../../duplicates/DuplicateWarning";
import { formatPhone } from "../../misc/formatPhone";
import { patientDisplayName } from "../../patients/parsePatientText";
import type { Deal, Patient } from "../../types";

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

/** The patient of the deal: contacts in messengers, phones, other requests */
export const PatientBlock = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: patient } = useGetOne<Patient>("patients", {
    id: deal.patient_id,
  });
  if (!patient) return null;
  const name = patientDisplayName(patient) || patient.phones?.[0] || "—";
  const phones = patient.phones?.length
    ? patient.phones
    : (patient.phone_jsonb?.map((p) => p.number) ?? []);

  return (
    <div className="flex flex-col gap-3 border-t border-border px-6 py-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
          {initials(name)}
        </span>
        <div className="min-w-0">
          <Link
            to={`/patients/${patient.id}/show`}
            className="block truncate font-semibold hover:underline"
          >
            {name}
          </Link>
          <div className="mt-1 flex flex-wrap gap-1">
            {patient.whatsapp ? (
              <Badge>WhatsApp {formatPhone(patient.whatsapp)}</Badge>
            ) : null}
            {patient.instagram ? (
              <Badge>Instagram @{patient.instagram}</Badge>
            ) : null}
            {patient.telegram ? (
              <Badge>Telegram @{patient.telegram}</Badge>
            ) : null}
          </div>
        </div>
      </div>
      <DuplicateWarning patientId={patient.id} />
      <dl className="grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {phones.map((phone) => (
          <div key={phone} className="contents">
            <dt className="text-muted-foreground">
              {translate("resources.patients.fields.phone_number")}
            </dt>
            <dd>
              <a
                href={`tel:${phone}`}
                className="tabular-nums text-brand-link hover:underline"
              >
                {phone}
              </a>
            </dd>
          </div>
        ))}
        {patient.city ? (
          <>
            <dt className="text-muted-foreground">
              {translate("resources.patients.fields.city")}
            </dt>
            <dd>{patient.city}</dd>
          </>
        ) : null}
      </dl>
      <Link
        to={`/patients/${patient.id}/show`}
        className="text-sm text-brand-link hover:underline"
      >
        {translate("crm.deals.page.patient_card")}
      </Link>
    </div>
  );
};

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
    {children}
  </span>
);
