import { useEffect, useState } from "react";
import { useDataProvider, useRecordContext, useTranslate } from "ra-core";
import { useWatch } from "react-hook-form";
import { Link } from "react-router";
import { ArrayInput } from "@/components/admin/array-input";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";
import { SimpleFormIterator } from "@/components/admin/simple-form-iterator";
import { TextInput } from "@/components/admin/text-input";

import { toChoices, useLeadSources } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import { phoneQueryDigits } from "../providers/commons/search";
import { AccountManagerInput } from "../sales/AccountManagerInput";
import { CustomFieldInputs } from "../custom-fields/CustomFieldInputs";
import type { Patient } from "../types";
import { patientDisplayName } from "./parsePatientText";

/** Patient card fields (spec §3) */
export const PatientInputs = () => {
  const translate = useTranslate();
  const { data: sources } = useLeadSources();
  const sourceId = useWatch({ name: "source_id" });
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
      <section className="flex flex-col gap-4">
        <SectionTitle>
          {translate("crm.patients.sections.identity")}
        </SectionTitle>
        <TextInput source="last_name" helperText={false} />
        <TextInput source="first_name" helperText={false} />
        <TextInput source="middle_name" helperText={false} />
        <div className="grid grid-cols-2 gap-4">
          <DateInput source="birth_date" helperText={false} />
          <TextInput source="city" helperText={false} />
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <SectionTitle>
          {translate("crm.patients.sections.contacts")}
        </SectionTitle>
        <ArrayInput source="phone_jsonb" helperText={false}>
          <SimpleFormIterator disableReordering disableClear>
            <TextInput
              source="number"
              label={false}
              helperText={false}
              placeholder="+7 7__ ___ __ __"
            />
          </SimpleFormIterator>
        </ArrayInput>
        <DuplicatePhoneHint />
        <TextInput
          source="whatsapp"
          helperText={false}
          placeholder="+7 7__ ___ __ __"
        />
        <div className="grid grid-cols-2 gap-4">
          <TextInput source="instagram" helperText={false} placeholder="@" />
          <TextInput source="telegram" helperText={false} placeholder="@" />
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <SectionTitle>{translate("crm.patients.sections.clinic")}</SectionTitle>
        <SelectInput
          source="source_id"
          choices={toChoices(sources, sourceId)}
          helperText={false}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            {translate("resources.patients.fields.sales_id")}
          </span>
          <AccountManagerInput source="sales_id" />
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <SectionTitle>{translate("crm.patients.sections.notes")}</SectionTitle>
        <TextInput source="background" multiline rows={4} helperText={false} />
      </section>
      <CustomFieldInputs entity="patient" className="md:col-span-2" />
    </div>
  );
};

const SectionTitle = ({ children }: { children: string }) => (
  <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
    {children}
  </h3>
);

/**
 * Deduplication of the MVP: while typing a phone, show the patient who
 * already has it.
 */
const DuplicatePhoneHint = () => {
  const translate = useTranslate();
  const record = useRecordContext<Patient>();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const phones: { number?: string }[] = useWatch({ name: "phone_jsonb" }) ?? [];
  const numbers = phones
    .map((phone) => phone?.number ?? "")
    .filter((number) => (phoneQueryDigits(number) ?? "").length >= 10);
  const key = numbers.join(",");
  const [duplicates, setDuplicates] = useState<Patient[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!numbers.length) {
      setDuplicates([]);
      return;
    }
    Promise.all(numbers.map((n) => dataProvider.findPatientsByPhone(n)))
      .then((results) => {
        if (cancelled) return;
        const found = results
          .flat()
          .filter((patient) => String(patient.id) !== String(record?.id));
        setDuplicates(
          found.filter(
            (patient, index) =>
              found.findIndex((p) => p.id === patient.id) === index,
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, record?.id]);

  if (!duplicates.length) return null;
  return (
    <div className="rounded-lg bg-brand-yellow/30 px-4 py-3 text-sm">
      {translate("crm.patients.duplicate_phone")}{" "}
      {duplicates.map((patient, index) => (
        <span key={patient.id}>
          {index > 0 ? ", " : ""}
          <Link
            to={`/patients/${patient.id}/show`}
            className="font-semibold underline"
          >
            {patientDisplayName(patient)}
          </Link>
        </span>
      ))}
    </div>
  );
};
