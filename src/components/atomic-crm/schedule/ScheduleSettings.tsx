import { useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  getPipelineStages,
  useDoctors,
  usePipelines,
  useStages,
} from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import {
  moveItem,
  useDictionaryMutations,
} from "../settings/useDictionaryMutations";
import { todayKey } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Doctor } from "../types";
import { DOCTOR_COLORS, doctorColor } from "./doctorColors";
import { DURATION_CHOICES, parseHm } from "./scheduleLayout";
import {
  VISIT_STATUSES,
  WEEK_DAYS,
  type Chair,
  type DayHours,
  type ScheduleStatusMap,
  type VisitStatus,
  type WeekDay,
  type WeeklyHours,
} from "./types";
import {
  useChairs,
  useDoctorExceptions,
  useSaveScheduleSettings,
  useScheduleSettings,
} from "./useSchedule";

const Block = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
    <div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
    {children}
  </section>
);

const TimeInput = ({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) => (
  <Input
    type="time"
    step={900}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    aria-label={label}
    className={cn("h-8 w-[6.5rem] px-2 tabular-nums", className)}
  />
);

/**
 * Settings → «Расписание» (owner, head, integrator): clinic hours of the
 * grid, chairs, doctors' hours and day exceptions, what each status does to
 * the deal, and the words of the confirmation replies.
 */
export const ScheduleSettings = () => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-6">
      <ClinicHoursEditor />
      <Block
        title={translate("schedule.settings.chairs")}
        hint={translate("schedule.settings.chairs_hint")}
      >
        <ChairsEditor />
      </Block>
      <DoctorHoursEditor />
      <StatusMapEditor />
      <KeywordsEditor />
    </div>
  );
};

const ClinicHoursEditor = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const { data } = useScheduleSettings();
  const save = useSaveScheduleSettings();
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("21:00");
  useEffect(() => {
    if (data) {
      setStart(data.hours_start);
      setEnd(data.hours_end);
    }
  }, [data]);
  return (
    <Block
      title={translate("schedule.settings.clinic_hours")}
      hint={translate("schedule.settings.clinic_hours_hint")}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <TimeInput
          value={start}
          onChange={setStart}
          label={translate("schedule.settings.from")}
        />
        <span>—</span>
        <TimeInput
          value={end}
          onChange={setEnd}
          label={translate("schedule.settings.to")}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { hours_start: start, hours_end: end },
              {
                onSuccess: () => notify("schedule.settings.saved"),
                onError: (error) => notify(error.message, { type: "error" }),
              },
            )
          }
        >
          {translate("ra.action.save")}
        </Button>
      </div>
    </Block>
  );
};

/** Dictionary «Кресла»: name, order, active switch */
export const ChairsEditor = () => {
  const translate = useTranslate();
  const { data: chairs } = useChairs();
  const { create, update, remove } = useDictionaryMutations("chairs", {
    inUseMessage: "schedule.settings.chair_in_use",
  });
  const [name, setName] = useState("");
  const sorted = [...chairs].sort(
    (a, b) => a.position - b.position || Number(a.id) - Number(b.id),
  );
  const add = () => {
    if (!name.trim()) return;
    create({
      name: name.trim(),
      is_active: true,
      position: (sorted.at(-1)?.position ?? -1) + 1,
    });
    setName("");
  };
  const move = (chair: Chair, direction: -1 | 1) =>
    moveItem(sorted, chair.id, direction).forEach(([record, position]) =>
      update(record, { position }),
    );
  return (
    <div className="flex flex-col gap-2" data-testid="chairs-editor">
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("schedule.settings.no_chairs")}
        </p>
      ) : null}
      {sorted.map((chair, index) => (
        <div key={chair.id} className="flex items-center gap-2">
          <div className="flex">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-7 px-0"
              disabled={index === 0}
              onClick={() => move(chair, -1)}
              aria-label={translate("crm.settings.move_up")}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-7 px-0"
              disabled={index === sorted.length - 1}
              onClick={() => move(chair, 1)}
              aria-label={translate("crm.settings.move_down")}
            >
              ↓
            </Button>
          </div>
          <Input
            defaultValue={chair.name}
            key={`${chair.id}-${chair.name}`}
            aria-label={translate("schedule.settings.chair_name")}
            className={cn(
              "h-8 max-w-72",
              !chair.is_active && "text-muted-foreground",
            )}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== chair.name) update(chair, { name: value });
            }}
          />
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={chair.is_active}
              onCheckedChange={(checked) =>
                update(chair, { is_active: checked })
              }
              aria-label={translate("schedule.settings.active")}
            />
            {translate("schedule.settings.active")}
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground"
            onClick={() => remove(chair)}
            aria-label={translate("ra.action.delete")}
          >
            ×
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          placeholder={translate("schedule.settings.new_chair")}
          aria-label={translate("schedule.settings.new_chair")}
          className="h-8 max-w-72"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={add}
          disabled={!name.trim()}
        >
          {translate("schedule.settings.add_chair")}
        </Button>
      </div>
    </div>
  );
};

const DEFAULT_DAY: DayHours = { start: "09:00", end: "18:00", breaks: [] };

/** Weekly grid of every doctor, the default duration, the days off */
const DoctorHoursEditor = () => {
  const translate = useTranslate();
  const { data: doctors } = useDoctors();
  const active = [...doctors]
    .filter((doctor) => doctor.is_active)
    .sort((a, b) => a.position - b.position);
  return (
    <Block
      title={translate("schedule.settings.doctor_hours")}
      hint={translate("schedule.settings.doctor_hours_hint")}
    >
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("schedule.settings.no_doctors")}{" "}
          <Link
            to="/settings?section=doctors"
            className="text-brand-link hover:underline"
          >
            {translate("schedule.settings.add_doctors")}
          </Link>
        </p>
      ) : null}
      {active.map((doctor) => (
        <DoctorHoursRow
          key={doctor.id}
          doctor={doctor}
          color={doctorColor(doctor, doctors)}
        />
      ))}
    </Block>
  );
};

const DoctorHoursRow = ({
  doctor,
  color,
}: {
  doctor: Doctor;
  color: string;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [hours, setHours] = useState<WeeklyHours>(doctor.working_hours ?? {});
  const [minutes, setMinutes] = useState(doctor.visit_minutes ?? 30);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setHours(doctor.working_hours ?? {});
    setMinutes(doctor.visit_minutes ?? 30);
  }, [doctor.working_hours, doctor.visit_minutes]);
  const setDay = (day: WeekDay, value: DayHours | undefined) =>
    setHours((current) => {
      const next = { ...current };
      if (value) next[day] = value;
      else delete next[day];
      return next;
    });
  const save = async () => {
    setSaving(true);
    try {
      await dataProvider.saveDoctorHours(doctor.id, hours, minutes);
      queryClient.invalidateQueries({ queryKey: ["doctors"] });
      notify("schedule.settings.saved");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };
  const templateEmpty = Object.keys(hours).length === 0;
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="doctor-hours"
      data-doctor-id={doctor.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DoctorColorPicker doctor={doctor} color={color} />
        <span className="font-semibold">{doctor.name}</span>
        {doctor.specialty ? (
          <span className="text-sm text-muted-foreground">
            {doctor.specialty}
          </span>
        ) : null}
        <label className="ml-auto flex items-center gap-2 text-sm">
          {translate("schedule.settings.visit_minutes")}
          <select
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
            className="field h-8 rounded-md border border-input px-2 text-sm"
          >
            {Array.from(new Set([...DURATION_CHOICES, minutes]))
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {translate("schedule.minutes", { count: value })}
                </option>
              ))}
          </select>
        </label>
        <Button size="sm" onClick={save} disabled={saving}>
          {translate("ra.action.save")}
        </Button>
      </div>
      {templateEmpty ? (
        <p className="text-xs text-muted-foreground">
          {translate("schedule.settings.clinic_hours_apply")}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-1 text-sm">
        {WEEK_DAYS.map((day) => {
          const value = hours[day];
          const pause = value?.breaks?.[0];
          return (
            <div
              key={day}
              className="flex flex-wrap items-center gap-2"
              data-weekday={day}
            >
              <label className="flex w-16 items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(event) =>
                    setDay(day, event.target.checked ? DEFAULT_DAY : undefined)
                  }
                  aria-label={translate(`schedule.weekdays.${day}`)}
                />
                {translate(`schedule.weekdays.${day}`)}
              </label>
              {value ? (
                <>
                  <TimeInput
                    value={value.start}
                    onChange={(start) => setDay(day, { ...value, start })}
                    label={translate("schedule.settings.from")}
                  />
                  <span>—</span>
                  <TimeInput
                    value={value.end}
                    onChange={(end) => setDay(day, { ...value, end })}
                    label={translate("schedule.settings.to")}
                  />
                  <span className="ml-2 text-xs text-muted-foreground">
                    {translate("schedule.settings.break")}
                  </span>
                  <TimeInput
                    value={pause?.start ?? ""}
                    onChange={(start) =>
                      setDay(day, {
                        ...value,
                        breaks: start
                          ? [{ start, end: pause?.end ?? start }]
                          : [],
                      })
                    }
                    label={translate("schedule.settings.break_from")}
                  />
                  <span>—</span>
                  <TimeInput
                    value={pause?.end ?? ""}
                    onChange={(end) =>
                      setDay(day, {
                        ...value,
                        breaks:
                          pause?.start && end
                            ? [{ start: pause.start, end }]
                            : [],
                      })
                    }
                    label={translate("schedule.settings.break_to")}
                  />
                  {(parseHm(value.end) ?? 0) <= (parseHm(value.start) ?? 0) ? (
                    <span className="text-xs text-destructive">
                      {translate("schedule.settings.bad_hours")}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {translate("schedule.grid.day_off")}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <DoctorExceptions doctorId={doctor.id} />
    </div>
  );
};

/** The color of the doctor's column in the schedule, saved when picked */
const DoctorColorPicker = ({
  doctor,
  color,
}: {
  doctor: Doctor;
  color: string;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [open, setOpen] = useState(false);
  const pick = async (value: string | null) => {
    setOpen(false);
    try {
      await dataProvider.update<Doctor>("doctors", {
        id: doctor.id,
        data: { color: value },
        previousData: doctor,
      });
      queryClient.invalidateQueries({ queryKey: ["doctors"] });
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="size-6 rounded-md border border-border"
          style={{ backgroundColor: color }}
          aria-label={`${translate("schedule.settings.color")}: ${doctor.name}`}
          title={translate("schedule.settings.color")}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {translate("schedule.settings.color")}
        </p>
        <div className="grid grid-cols-5 gap-2">
          {DOCTOR_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => pick(value)}
              className={cn(
                "size-8 rounded-md border-2",
                doctor.color?.toUpperCase() === value
                  ? "border-foreground"
                  : "border-transparent",
              )}
              style={{ backgroundColor: value }}
              aria-label={value}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => pick(null)}
          className="mt-3 text-xs font-medium text-brand-link hover:underline"
        >
          {translate("schedule.settings.color_auto")}
        </button>
      </PopoverContent>
    </Popover>
  );
};

/** Days off and custom hours of a doctor, from today */
const DoctorExceptions = ({ doctorId }: { doctorId: Identifier }) => {
  const translate = useTranslate();
  const timeZone = useClinicTimeZone();
  const today = todayKey(timeZone);
  const { data } = useDoctorExceptions(today);
  const { create, remove } = useDictionaryMutations("doctor_exceptions");
  const [day, setDay] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const own = data.filter(
    (item) => String(item.doctor_id) === String(doctorId),
  );
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    create({
      doctor_id: doctorId,
      day,
      start_time: start && end ? start : null,
      end_time: start && end ? end : null,
    });
    setDay("");
    setStart("");
    setEnd("");
  };
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">
        {translate("schedule.settings.exceptions")}
      </span>
      {own.map((item) => (
        <div key={item.id} className="flex items-center gap-2 text-xs">
          <span className="tabular-nums">{item.day.slice(0, 10)}</span>
          <span>
            {item.start_time && item.end_time
              ? `${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}`
              : translate("schedule.grid.day_off")}
          </span>
          <button
            type="button"
            onClick={() => remove(item)}
            className="text-muted-foreground hover:text-destructive"
            aria-label={translate("ra.action.delete")}
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={day}
          min={today}
          onChange={(event) => setDay(event.target.value)}
          aria-label={translate("schedule.settings.exception_day")}
          className="h-8 w-40 px-2"
        />
        <TimeInput
          value={start}
          onChange={setStart}
          label={translate("schedule.settings.from")}
        />
        <span>—</span>
        <TimeInput
          value={end}
          onChange={setEnd}
          label={translate("schedule.settings.to")}
        />
        <Button size="sm" variant="outline" onClick={add} disabled={!day}>
          {translate(
            start && end
              ? "schedule.settings.add_custom_hours"
              : "schedule.settings.add_day_off",
          )}
        </Button>
      </div>
    </div>
  );
};

/** What each status of a visit does to the deal */
const StatusMapEditor = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const { data } = useScheduleSettings();
  const save = useSaveScheduleSettings();
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const [map, setMap] = useState<ScheduleStatusMap>({});
  useEffect(() => {
    if (data) setMap(data.status_map ?? {});
  }, [data]);
  const setEntry = (
    status: VisitStatus,
    patch: Partial<NonNullable<ScheduleStatusMap[VisitStatus]>>,
  ) =>
    setMap((current) => ({
      ...current,
      [status]: { ...(current[status] ?? {}), ...patch },
    }));
  const stageChoices = pipelines.flatMap((pipeline) =>
    getPipelineStages(stages, pipeline.id)
      .filter((stage) => stage.kind !== "lost")
      .map((stage) => ({
        id: String(stage.id),
        name:
          pipelines.length > 1
            ? `${pipeline.name} · ${stage.name}`
            : stage.name,
      })),
  );
  return (
    <Block
      title={translate("schedule.settings.mapping")}
      hint={translate("schedule.settings.mapping_hint")}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">
                {translate("schedule.settings.status")}
              </th>
              <th className="py-1 pr-2 font-medium">
                {translate("schedule.settings.stage")}
              </th>
              <th className="py-1 pr-2 font-medium">
                {translate("schedule.settings.tag")}
              </th>
              <th className="py-1 font-medium">
                {translate("schedule.settings.task")}
              </th>
            </tr>
          </thead>
          <tbody>
            {VISIT_STATUSES.map((status) => {
              const entry = map[status] ?? {};
              return (
                <tr key={status} data-status={status}>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {translate(`schedule.statuses.${status}`)}
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      value={
                        entry.stage_id != null ? String(entry.stage_id) : ""
                      }
                      onChange={(event) =>
                        setEntry(status, {
                          stage_id: event.target.value || null,
                        })
                      }
                      aria-label={translate("schedule.settings.stage")}
                      className="field h-8 w-full min-w-40 rounded-md border border-input px-2 text-sm"
                    >
                      <option value="">
                        {translate("schedule.settings.no_stage")}
                      </option>
                      {stageChoices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      value={entry.tag ?? ""}
                      onChange={(event) =>
                        setEntry(status, {
                          tag: event.target.value,
                          tag_id: null,
                        })
                      }
                      placeholder="—"
                      aria-label={translate("schedule.settings.tag")}
                      className="h-8 min-w-28"
                    />
                  </td>
                  <td className="py-1">
                    <Input
                      value={entry.task ?? ""}
                      onChange={(event) =>
                        setEntry(status, { task: event.target.value })
                      }
                      placeholder="—"
                      aria-label={translate("schedule.settings.task")}
                      className="h-8 min-w-48"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {translate("schedule.settings.mapping_rules")}
      </p>
      <Button
        size="sm"
        className="w-fit"
        disabled={save.isPending}
        onClick={() =>
          save.mutate(
            { status_map: map },
            {
              onSuccess: () => notify("schedule.settings.saved"),
              onError: (error) => notify(error.message, { type: "error" }),
            },
          )
        }
      >
        {translate("ra.action.save")}
      </Button>
    </Block>
  );
};

const splitWords = (value: string) =>
  value
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);

/** Words of the confirmation replies, and where the message is */
const KeywordsEditor = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const { data } = useScheduleSettings();
  const save = useSaveScheduleSettings();
  const [confirm, setConfirm] = useState("");
  const [reschedule, setReschedule] = useState("");
  useEffect(() => {
    if (data) {
      setConfirm(data.confirm_keywords.join(", "));
      setReschedule(data.reschedule_keywords.join(", "));
    }
  }, [data]);
  return (
    <Block
      title={translate("schedule.settings.confirmation")}
      hint={translate("schedule.settings.confirmation_hint")}
    >
      <label className="flex flex-col gap-1 text-sm">
        {translate("schedule.settings.confirm_words")}
        <Input
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className="h-8 max-w-md"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {translate("schedule.settings.reschedule_words")}
        <Input
          value={reschedule}
          onChange={(event) => setReschedule(event.target.value)}
          className="h-8 max-w-md"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {translate("schedule.settings.confirmation_rules")}{" "}
        <Link
          to="/settings?section=automessages"
          className="text-brand-link hover:underline"
        >
          {translate("schedule.settings.open_automessages")}
        </Link>
      </p>
      <Button
        size="sm"
        className="w-fit"
        disabled={save.isPending}
        onClick={() =>
          save.mutate(
            {
              confirm_keywords: splitWords(confirm),
              reschedule_keywords: splitWords(reschedule),
            },
            {
              onSuccess: () => notify("schedule.settings.saved"),
              onError: (error) => notify(error.message, { type: "error" }),
            },
          )
        }
      >
        {translate("ra.action.save")}
      </Button>
    </Block>
  );
};
