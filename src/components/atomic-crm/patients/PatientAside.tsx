import { Instagram, MessageCircle, Phone, Send } from "lucide-react";
import { CanAccess, useRecordContext, useTranslate } from "ra-core";
import type { ReactNode } from "react";
import { DeleteButton } from "@/components/admin";
import { EditButton } from "@/components/admin/edit-button";

import { findById, useLeadSources } from "../dictionaries/useDictionaries";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Patient } from "../types";
import { TagsListEdit } from "./TagsListEdit";
import { PatientOptOutToggle } from "../mailings/PatientOptOutToggle";
import { CustomFieldValue } from "../custom-fields/CustomFieldValue";
import { useEntityFields } from "../custom-fields/useCustomFields";
import { formatPhone } from "../misc/formatPhone";

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
    <aside className="glass flex h-fit flex-col gap-6 rounded-lg p-6 text-sm">
      <div className="flex gap-2">
        <EditButton label="resources.patients.action.edit" />
      </div>

      <Section title={translate("crm.patients.sections.contacts")}>
        {record.phones?.map((phone) => (
          <Row key={phone} icon={<Phone className="size-4" />}>
            <a href={`tel:${phone}`} className="tabular-nums hover:underline">
              {formatPhone(phone)}
            </a>
          </Row>
        ))}
        {record.whatsapp ? (
          <Row icon={<MessageCircle className="size-4" />}>
            WhatsApp ·{" "}
            <span className="tabular-nums">{formatPhone(record.whatsapp)}</span>
          </Row>
        ) : null}
        {record.instagram ? (
          <Row icon={<Instagram className="size-4" />}>@{record.instagram}</Row>
        ) : null}
        {record.telegram ? (
          <Row icon={<Send className="size-4" />}>@{record.telegram}</Row>
        ) : null}
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

      <CanAccess resource="patients" action="delete" record={record}>
        <div className="border-t border-border pt-4">
          <DeleteButton
            size="sm"
            className="text-destructive! hover:bg-destructive/10!"
          />
        </div>
      </CanAccess>
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

const Row = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <p className="flex items-center gap-2.5">
    <span className="text-muted-foreground">{icon}</span>
    <span className="min-w-0 truncate">{children}</span>
  </p>
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
