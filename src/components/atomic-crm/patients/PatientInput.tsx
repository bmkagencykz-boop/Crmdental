import {
  required,
  useCreate,
  useDataProvider,
  useNotify,
  useTranslate,
  type InputProps,
} from "ra-core";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { ReferenceInput } from "@/components/admin/reference-input";

import type { CrmDataProvider } from "../providers/types";
import type { Patient } from "../types";
import { parsePatientText, patientDisplayName } from "./parsePatientText";

/**
 * Pick the patient of a deal by name or phone, or create them on the fly.
 * A phone that already belongs to a patient selects that patient instead of
 * creating a duplicate (the only deduplication of the MVP).
 */
export const PatientInput = ({
  source = "patient_id",
  label = "resources.deals.fields.patient_id",
}: Partial<Pick<InputProps, "source" | "label">>) => {
  const translate = useTranslate();
  const [create] = useCreate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();

  const handleCreate = async (text?: string) => {
    const parsed = parsePatientText(text ?? "");
    if (!parsed.last_name && !parsed.first_name && !parsed.phone) return;
    try {
      if (parsed.phone) {
        const [existing] = await dataProvider.findPatientsByPhone(parsed.phone);
        if (existing) {
          notify("crm.patients.found_by_phone", {
            type: "info",
            messageArgs: { name: patientDisplayName(existing) },
          });
          return existing;
        }
      }
      return await create(
        "patients",
        {
          data: {
            last_name: parsed.last_name ?? null,
            first_name: parsed.first_name ?? null,
            middle_name: parsed.middle_name ?? null,
            phone_jsonb: parsed.phone
              ? [{ number: parsed.phone, type: "Mobile" }]
              : [],
            tags: [],
          },
        },
        { returnPromise: true },
      );
    } catch {
      notify("crm.patients.create_error", { type: "error" });
    }
  };

  return (
    <ReferenceInput source={source} reference="patients">
      <AutocompleteInput
        label={label}
        optionText={(patient: Patient) => patientOptionText(patient)}
        helperText={false}
        validate={required()}
        onCreate={handleCreate}
        createItemLabel="crm.patients.create_item"
        createLabel={translate("crm.patients.create_label")}
      />
    </ReferenceInput>
  );
};

const patientOptionText = (patient: Patient) => {
  const phone = patient.phones?.[0] ?? patient.phone_jsonb?.[0]?.number;
  const name = patientDisplayName(patient);
  return phone && phone !== name ? `${name} · ${phone}` : name;
};
