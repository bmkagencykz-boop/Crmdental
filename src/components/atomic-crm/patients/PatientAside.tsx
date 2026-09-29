import { useRecordContext, useTranslate } from "ra-core";
import type { ReactNode } from "react";
import { EditButton } from "@/components/admin/edit-button";

import { findById, useLeadSources } from "../dictionaries/useDictionaries";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Patient } from "../types";
import { TagsListEdit } from "./TagsListEdit";
import { PatientOptOutToggle } from "../mailings/PatientOptOutToggle";
import { CustomFieldValue } from "../custom-fields/CustomFieldValue";
import { useEntityFields } from "../custom-fields/useCustomFields";
import { formatPhone } from "../misc/formatPhone";
import { PatientArchiveActions } from "../data-safety/PatientArchive";

/** Contact card of a patient: phones, messengers, clinic info, tags */
export const PatientAside = () => {
  const record = useRecordContext<Patient>();
  const translate = useTranslate();
  const { data: sources } = useLeadSources();
  const salesName = useGetSalesName(record?.sales_id ?? undefined, {
    enabled: record?.sales_id != null,
  });
  if (!record) return null;

  return (
    <aside className="flex h-fit flex-col gap-5 rounded-[28px] bg-card p-6 text-sm">
      <div className="flex gap-2">
        <EditButton label="resources.patients.action.edit" />
      </div>

      <Section title={translate("crm.patients.sections.contacts")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {record.phones?.map((phone) => (
            <Term
              key={phone}
              label={translate("resources.patients.fields.phone_number")}
            >
              <a href={`tel:${phone}`} className="tabular-nums hover:underline">
                {formatPhone(phone)}
              </a>
            </Term>
          ))}
          {record.whatsapp ? (
            <Term label="WhatsApp">
              <span className="tabular-nums">
                {formatPhone(record.whatsapp)}
              </span>
            </Term>
          ) : null}
          {record.instagram ? (
            <Term label="Instagram">@{record.instagram}</Term>
          ) : null}
          {record.telegram ? (
            <Term label="Telegram">@{record.telegram}</Term>
          ) : null}
        </dl>
      </Section>

      <Section title={translate("crm.patients.sections.clinic")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Term label={translate("resources.patients.fields.source_id")}>
            {findById(sources, record.source_id)?.name}
          </Term>
          <Term label={translate("resources.patients.fields.sales_id")}>
            {salesName}
          </Term>
          <Term label={translate("resources.patients.fields.birth_date")}>
            {record.birth_date
              ? new Date(record.birth_date).toLocaleDateString("ru-RU")
              : null}
          </Term>
          <Term label={translate("resources.patients.fields.city")}>
            {record.city}
          </Term>
          <Term label={translate("resources.patients.fields.first_seen")}>
            {new Date(record.first_seen).toLocaleDateString("ru-RU")}
          </Term>
        </dl>
        {record.background ? (
          <p className="whitespace-pre-line leading-6">{record.background}</p>
        ) : null}
      </Section>

      <PatientCustomFields patient={record} />

      <Section title={translate("resources.tags.name", { smart_count: 2 })}>
        <TagsListEdit />
      </Section>

      <Section title={translate("mailings.opt_out.section")}>
        <PatientOptOutToggle patientId={record.id} />
      </Section>

      {/* Stage 41: the archive; the owner deletes a patient without history */}
      <PatientArchiveActions />
    </aside>
  );
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-2.5">
    <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {title}
    </h4>
    {children}
  </section>
);

const Term = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children || "—"}</dd>
  </>
);

/** «Дополнительные поля» of the patient (stage 19), edited in the form */
const PatientCustomFields = ({ patient }: { patient: Patient }) => {
  const translate = useTranslate();
  const { data: fields } = useEntityFields("patient");
  if (!fields.length) return null;
  const values = patient.custom_values ?? {};
  return (
    <Section title={translate("custom_fields.section")}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {fields.map((field) => (
          <Term key={field.id} label={field.name}>
            {values[String(field.id)] != null ? (
              <CustomFieldValue
                field={field}
                value={values[String(field.id)]}
              />
            ) : null}
          </Term>
        ))}
      </dl>
    </Section>
  );
};
