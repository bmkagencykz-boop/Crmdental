import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { required, useTranslate } from "ra-core";
import { useEffect, useRef } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { DateTimeInput } from "@/components/admin";

import { patientDisplayName } from "../patients/parsePatientText";
import type { Deal, TaskType } from "../types";
import { defaultDuration, DURATION_CHOICES } from "./calendarLayout";
import { formatTaskDuration } from "./taskActions";
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

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4">
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
        <SelectInput
          source="duration_minutes"
          label="task_calendar.duration"
          choices={DURATION_CHOICES.map((minutes) => ({
            id: minutes,
            name: formatTaskDuration(minutes, translate),
          }))}
          emptyText="task_calendar.duration_default"
          helperText={false}
        />
      </div>
      <DurationFollowsType />
    </div>
  );
};

/**
 * A meeting takes an hour, a call half an hour: changing the type changes
 * the duration too, until the user picks a duration by hand.
 */
const DurationFollowsType = () => {
  const { setValue, getFieldState } = useFormContext();
  const type = useWatch({ name: "type" }) as TaskType | undefined;
  const previous = useRef(type);
  useEffect(() => {
    if (previous.current === type) return;
    previous.current = type;
    if (!getFieldState("duration_minutes").isDirty) {
      setValue("duration_minutes", defaultDuration(type));
    }
  }, [type, setValue, getFieldState]);
  return null;
};
