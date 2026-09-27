import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { required, useTranslate } from "ra-core";
import { DateTimeInput } from "@/components/admin";

import { patientDisplayName } from "../patients/parsePatientText";
import type { Deal } from "../types";
import { taskTypeChoices } from "./taskTypes";

const dealOptionText = (deal: Deal) =>
  [
    patientDisplayName({
      last_name: deal.patient_last_name,
      first_name: deal.patient_first_name,
    }),
    deal.name,
  ]
    .filter(Boolean)
    .join(" · ");

export const TaskFormContent = ({ selectDeal }: { selectDeal?: boolean }) => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-4">
      <TextInput
        autoFocus
        source="text"
        validate={required()}
        multiline
        className="m-0"
        helperText={false}
      />
      {selectDeal && (
        <ReferenceInput
          source="deal_id"
          reference="deals"
          filter={{ "archived_at@is": null }}
        >
          <AutocompleteInput
            label="resources.tasks.fields.deal_id"
            optionText={dealOptionText}
            helperText={false}
            validate={required()}
            modal
          />
        </ReferenceInput>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DateTimeInput
          source="due_date"
          helperText={false}
          validate={required()}
        />
        <SelectInput
          source="type"
          validate={required()}
          choices={taskTypeChoices(translate)}
          defaultValue="call"
          helperText={false}
        />
      </div>
    </div>
  );
};
