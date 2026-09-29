import {
  Form,
  required,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useMemo, useState } from "react";
import { useController, useWatch } from "react-hook-form";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { branchChoices } from "../branches/branches";
import { useBranches } from "../branches/useBranches";
import {
  toChoices,
  toDoctorChoices,
  useDoctors,
  useServices,
} from "../dictionaries/useDictionaries";
import { PatientInput } from "../patients/PatientInput";
import { DURATION_CHOICES, toHm } from "../schedule/scheduleLayout";
import { todayKey } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Deal } from "../types";
import {
  DAY_PARTS,
  ISO_WEEKDAYS,
  PRIORITIES,
  type DayPart,
  type WaitingEntry,
} from "./types";
import { useRefreshWaiting } from "./useWaitingList";

const NO_DEAL = "none";

/** What the dialog starts from: a patient (card), a deal, or nothing */
export type WaitingDraft = Partial<
  Pick<
    WaitingEntry,
    "patient_id" | "deal_id" | "doctor_id" | "service_id" | "branch_id"
  >
>;

type FormValues = {
  patient_id: Identifier | null;
  deal_id: Identifier | typeof NO_DEAL;
  doctor_id: Identifier | null;
  service_id: Identifier | null;
  direction: string;
  branch_id: Identifier | null;
  date_from: string;
  date_to: string;
  weekdays: number[];
  day_parts: DayPart[];
  time_from: string | null;
  time_to: string | null;
  duration_minutes: number | null;
  priority: WaitingEntry["priority"];
  comment: string;
};

/** Hours of the hour range, 07:00 … 22:00 */
const HOUR_CHOICES = Array.from({ length: 16 }, (_, index) => {
  const value = toHm((7 + index) * 60);
  return { id: value, name: value };
});

/**
 * «Добавить в лист ожидания» / «Изменить»: the patient (search, or a new one
 * by name and phone), the deal, the doctor (or any), the service or a
 * direction, the branch, the desired period, days of the week and parts of
 * the day (pills) or an hour range, the length, the priority, a comment.
 */
export const WaitingEntryDialog = ({
  open,
  onClose,
  draft = {},
  entry,
}: {
  open: boolean;
  onClose: () => void;
  draft?: WaitingDraft;
  entry?: WaitingEntry;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider();
  const refreshWaiting = useRefreshWaiting();
  const timeZone = useClinicTimeZone();
  const [saving, setSaving] = useState(false);

  const record: FormValues = useMemo(
    () => ({
      patient_id: entry?.patient_id ?? draft.patient_id ?? null,
      deal_id: entry?.deal_id ?? draft.deal_id ?? NO_DEAL,
      doctor_id: entry?.doctor_id ?? draft.doctor_id ?? null,
      service_id: entry?.service_id ?? draft.service_id ?? null,
      direction: entry?.direction ?? "",
      branch_id: entry?.branch_id ?? draft.branch_id ?? null,
      date_from: entry?.date_from?.slice(0, 10) ?? todayKey(timeZone),
      date_to: entry?.date_to?.slice(0, 10) ?? "",
      weekdays: entry?.weekdays ?? [],
      day_parts: entry?.day_parts ?? [],
      time_from: entry?.time_from?.slice(0, 5) ?? null,
      time_to: entry?.time_to?.slice(0, 5) ?? null,
      duration_minutes: entry?.duration_minutes ?? null,
      priority: entry?.priority ?? "normal",
      comment: entry?.comment ?? "",
    }),
    // The draft of an open dialog does not change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  );

  const save = async (values: Partial<FormValues>) => {
    if (!values.patient_id) return;
    const from = values.time_from || null;
    const to = values.time_to || null;
    if ((from == null) !== (to == null) || (from && to && to <= from)) {
      notify("waiting_list.fields.hours", { type: "warning" });
      return;
    }
    setSaving(true);
    const data = {
      patient_id: values.patient_id,
      deal_id:
        values.deal_id === NO_DEAL || values.deal_id == null
          ? null
          : values.deal_id,
      doctor_id: values.doctor_id ?? null,
      service_id: values.service_id ?? null,
      direction: values.direction?.trim() || null,
      branch_id: values.branch_id ?? null,
      date_from: values.date_from || todayKey(timeZone),
      date_to: values.date_to || null,
      weekdays: [...(values.weekdays ?? [])].sort(),
      day_parts: values.day_parts ?? [],
      time_from: from,
      time_to: to,
      duration_minutes: values.duration_minutes
        ? Number(values.duration_minutes)
        : null,
      priority: values.priority ?? "normal",
      comment: values.comment?.trim() || null,
    };
    try {
      if (entry) {
        await dataProvider.update<WaitingEntry>("waiting_list", {
          id: entry.id,
          data,
          previousData: entry,
        });
        notify("waiting_list.notify.saved", { type: "info" });
      } else {
        await dataProvider.create<WaitingEntry>("waiting_list", {
          data: data as Partial<WaitingEntry>,
        });
        notify("waiting_list.notify.added", { type: "info" });
      }
      refreshWaiting();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto rounded-[28px] lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[22px] font-normal tracking-[-0.02em]">
            {translate(
              entry ? "waiting_list.edit_title" : "waiting_list.new_title",
            )}
          </DialogTitle>
          <DialogDescription>
            {translate("waiting_list.subtitle")}
          </DialogDescription>
        </DialogHeader>
        <Form
          record={record}
          onSubmit={save}
          className="flex flex-col gap-4"
          resource="waiting_list"
        >
          <EntryFields />
          <DialogFooter className="w-full justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {translate("ra.action.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={saving}
              data-testid="waiting-entry-save"
            >
              {translate(
                entry ? "waiting_list.form.save" : "waiting_list.form.add",
              )}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

const EntryFields = () => {
  const translate = useTranslate();
  const { data: doctors } = useDoctors();
  const { data: services } = useServices();
  const { branches, enabled: branchesOn } = useBranches();
  const [patientId, dealId, doctorId, serviceId, branchId] = useWatch<
    FormValues,
    ["patient_id", "deal_id", "doctor_id", "service_id", "branch_id"]
  >({
    name: ["patient_id", "deal_id", "doctor_id", "service_id", "branch_id"],
  });
  const { data: deals = [] } = useGetList<Deal>(
    "deals",
    {
      pagination: { page: 1, perPage: 50 },
      sort: { field: "updated_at", order: "DESC" },
      filter: { patient_id: patientId, "archived_at@is": null },
    },
    { enabled: patientId != null },
  );
  const dealChoices = deals
    .filter(
      (deal) =>
        deal.stage_kind === "open" || String(deal.id) === String(dealId),
    )
    .map((deal) => ({ id: deal.id, name: deal.name || `#${deal.id}` }));

  return (
    <div className="flex flex-col gap-4">
      <PatientInput source="patient_id" label="waiting_list.fields.patient" />
      <SelectInput
        source="deal_id"
        label="waiting_list.fields.deal"
        choices={[
          ...dealChoices,
          { id: NO_DEAL, name: translate("waiting_list.form.no_deal") },
        ]}
        validate={required()}
        helperText={false}
        disabled={patientId == null}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SelectInput
          source="doctor_id"
          label="waiting_list.fields.doctor"
          choices={toDoctorChoices(doctors, doctorId)}
          emptyText="waiting_list.form.no_doctor"
          helperText={false}
        />
        <SelectInput
          source="service_id"
          label="waiting_list.fields.service"
          choices={toChoices(services, serviceId)}
          emptyText="waiting_list.form.no_service"
          helperText={false}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextInput
          source="direction"
          label="waiting_list.fields.direction"
          helperText={false}
        />
        {branchesOn ? (
          <SelectInput
            source="branch_id"
            label="waiting_list.fields.branch"
            choices={branchChoices(branches, branchId)}
            emptyText="waiting_list.form.no_branch"
            helperText={false}
          />
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <TextInput
          source="date_from"
          type="date"
          label="waiting_list.fields.date_from"
          validate={required()}
          helperText={false}
        />
        <TextInput
          source="date_to"
          type="date"
          label="waiting_list.fields.date_to"
          helperText={false}
        />
      </div>
      <PillsField
        source="weekdays"
        label={translate("waiting_list.fields.weekdays")}
        hint={translate("waiting_list.form.weekdays_hint")}
        options={ISO_WEEKDAYS.map((day) => ({
          value: day,
          label: translate(`waiting_list.weekdays_short.${day}`),
        }))}
      />
      <PillsField
        source="day_parts"
        label={translate("waiting_list.fields.day_parts")}
        hint={translate("waiting_list.form.day_parts_hint")}
        options={DAY_PARTS.map((part) => ({
          value: part,
          label: `${translate(`waiting_list.day_parts.${part}`)} · ${translate(`waiting_list.day_parts_hint.${part}`)}`,
        }))}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SelectInput
          source="time_from"
          label={`${translate("waiting_list.fields.hours")}: ${translate("waiting_list.fields.time_from")}`}
          choices={HOUR_CHOICES}
          emptyText="waiting_list.any"
          helperText="waiting_list.form.hours_hint"
        />
        <SelectInput
          source="time_to"
          label="waiting_list.fields.time_to"
          choices={HOUR_CHOICES}
          emptyText="waiting_list.any"
          helperText={false}
        />
        <SelectInput
          source="duration_minutes"
          label="waiting_list.fields.duration"
          choices={DURATION_CHOICES.map((minutes) => ({
            id: minutes,
            name: translate("waiting_list.card.minutes", { count: minutes }),
          }))}
          emptyText="waiting_list.form.duration_default"
          helperText={false}
        />
      </div>
      <PillsField
        source="priority"
        single
        label={translate("waiting_list.fields.priority")}
        options={PRIORITIES.map((priority) => ({
          value: priority,
          label: translate(`waiting_list.priorities.${priority}`),
        }))}
      />
      <TextInput
        source="comment"
        label="waiting_list.fields.comment"
        multiline
        helperText={false}
      />
    </div>
  );
};

/**
 * Pills of a form field: several values (a list) or one (`single`). Black
 * marks the chosen ones.
 */
const PillsField = <T extends string | number>({
  source,
  label,
  hint,
  options,
  single = false,
}: {
  source: keyof FormValues;
  label: string;
  hint?: string;
  options: { value: T; label: string }[];
  single?: boolean;
}) => {
  const { field } = useController<FormValues>({ name: source });
  const value = field.value as unknown;
  const chosen = (option: T) =>
    single ? value === option : ((value as T[]) ?? []).includes(option);
  const toggle = (option: T) => {
    if (single) {
      field.onChange(option);
      return;
    }
    const list = (value as T[]) ?? [];
    field.onChange(
      list.includes(option)
        ? list.filter((item) => item !== option)
        : [...list, option],
    );
  };
  return (
    <div className="flex flex-col gap-2" data-testid={`waiting-${source}`}>
      <span className="text-xs text-muted-foreground">
        {label}
        {hint ? <span className="ml-2 opacity-70">{hint}</span> : null}
      </span>
      <div
        role={single ? "radiogroup" : "group"}
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role={single ? "radio" : "checkbox"}
            aria-checked={chosen(option.value)}
            onClick={() => toggle(option.value)}
            className={cn(
              "rounded-full px-4 py-2 text-sm transition-colors",
              chosen(option.value)
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground hover:bg-pill",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
};
