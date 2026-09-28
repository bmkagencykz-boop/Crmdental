import type {
  DataProvider,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import { DEFAULT_TIME_ZONE } from "../commons/automessages";
import {
  findConflict,
  isActiveStatus,
  parseHm,
} from "../../schedule/scheduleLayout";
import { parseVisitReply } from "../../schedule/visitReply";
import type {
  BusySlot,
  ScheduleSettings,
  ScheduleSettingsPatch,
  ScheduleStatusMap,
  StatusMapEntry,
  Visit,
  VisitStatus,
  WeeklyHours,
} from "../../schedule/types";
import type {
  CrmNotification,
  Deal,
  Doctor,
  Message,
  Organization,
  Patient,
  Sale,
  Stage,
  Tag,
  Task,
} from "../../types";
import type { MisConnection } from "../../mis/types";
import type { StageTriggerRun } from "../../pipeline-automation/types";
import type { SalesbotSession } from "../../salesbot/types";

type StoredSettings = Omit<ScheduleSettings, "mis_kind"> & { id: Identifier };

const same = (a: unknown, b: unknown) =>
  a != null && b != null && String(a) === String(b);
const nowIso = () => new Date().toISOString();
const error = (message: string, code: string) =>
  Object.assign(new Error(message), { code });
const HOUR = 60 * 60 * 1000;

const STATUSES: VisitStatus[] = [
  "scheduled",
  "confirmed",
  "arrived",
  "no_show",
  "cancelled",
  "completed",
];

/**
 * The schedule of the demo (stage 28): the same rules as
 * supabase/schemas/28_schedule.sql, as lifecycle callbacks of the resource
 * «visits» and methods of the data provider. A visit moves its deal through
 * the full data provider, so the deal rules (checklist, feed, automations)
 * apply as in the database.
 */
export const createScheduleDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  getDataProvider: () => DataProvider;
}) => {
  const me = async () => {
    const salesId = await currentSalesId();
    return (await all<Sale>("sales")).find((sale) => same(sale.id, salesId));
  };
  // The demo user is the owner of the clinic
  const canConfigure = async () => {
    const sale = await me();
    return !sale || ["owner", "head", "integrator"].includes(sale.role ?? "");
  };
  const timeZone = async () =>
    (await all<Organization>("organizations"))[0]?.timezone ||
    DEFAULT_TIME_ZONE;
  const timeLabel = async (value: string) => {
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone: await timeZone(),
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value));
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("day")}.${get("month")} ${get("hour")}:${get("minute")}`;
  };

  const stored = async () => (await all<StoredSettings>("schedule_settings"))[0];
  const misKind = async () =>
    (await all<MisConnection>("mis_connections")).find(
      (connection) =>
        ["connected", "error"].includes(connection.status) &&
        connection.sync_appointments,
    )?.kind ?? null;

  const getScheduleSettings = async (): Promise<ScheduleSettings> => {
    const row = await stored();
    return {
      hours_start: row?.hours_start ?? "09:00",
      hours_end: row?.hours_end ?? "21:00",
      status_map: row?.status_map ?? {},
      confirm_keywords: row?.confirm_keywords ?? ["1", "да", "подтверждаю"],
      reschedule_keywords: row?.reschedule_keywords ?? ["2", "перенести"],
      mis_kind: await misKind(),
    };
  };

  /** Same checks as private.schedule_clean_status_map */
  const cleanStatusMap = async (map: ScheduleStatusMap) => {
    const stages = await all<Stage>("stages");
    const tags = await all<Tag>("tags");
    const result: ScheduleStatusMap = {};
    for (const [status, entry] of Object.entries(map ?? {})) {
      if (!STATUSES.includes(status as VisitStatus)) {
        throw error(`Неизвестный статус записи: ${status}`, "22023");
      }
      if (!entry || typeof entry !== "object") continue;
      const clean: StatusMapEntry = {};
      if (entry.stage_id != null && entry.stage_id !== "") {
        const stage = stages.find((s) => same(s.id, entry.stage_id));
        if (!stage || stage.kind === "lost") {
          throw error(
            `Этап для статуса «${status}» не найден или это этап отказа`,
            "22023",
          );
        }
        clean.stage_id = stage.id;
      }
      if (entry.tag_id != null && entry.tag_id !== "") {
        if (!tags.some((tag) => same(tag.id, entry.tag_id))) {
          throw error(`Тег для статуса «${status}» не найден`, "22023");
        }
        clean.tag_id = entry.tag_id;
      } else if (entry.tag?.trim()) {
        clean.tag = entry.tag.trim().slice(0, 50);
      }
      if (entry.task?.trim()) clean.task = entry.task.trim().slice(0, 500);
      result[status as VisitStatus] = clean;
    }
    return result;
  };

  const saveScheduleSettings = async (
    patch: ScheduleSettingsPatch,
  ): Promise<ScheduleSettings> => {
    if (!(await canConfigure())) {
      throw error(
        "Only the owner, the head or the integrator configure the schedule",
        "42501",
      );
    }
    const row = await stored();
    const next = { ...row, ...(await getScheduleSettings()) } as StoredSettings;
    if (patch.hours_start !== undefined) next.hours_start = patch.hours_start;
    if (patch.hours_end !== undefined) next.hours_end = patch.hours_end;
    const start = parseHm(next.hours_start);
    const end = parseHm(next.hours_end);
    if (start == null || end == null || end <= start) {
      throw error("Конец рабочего дня раньше начала", "22023");
    }
    if (patch.status_map !== undefined) {
      next.status_map = await cleanStatusMap(patch.status_map);
    }
    const words = (list: string[]) =>
      Array.from(
        new Set(list.map((w) => w.trim().slice(0, 50)).filter(Boolean)),
      );
    if (patch.confirm_keywords) {
      next.confirm_keywords = words(patch.confirm_keywords);
    }
    if (patch.reschedule_keywords) {
      next.reschedule_keywords = words(patch.reschedule_keywords);
    }
    const { mis_kind: _mis, ...data } = next as StoredSettings & {
      mis_kind?: string | null;
    };
    if (row) {
      await baseDataProvider.update("schedule_settings", {
        id: row.id,
        data,
        previousData: row,
      });
    } else {
      await baseDataProvider.create("schedule_settings", { data });
    }
    return getScheduleSettings();
  };

  /** Same checks as private.schedule_clean_hours */
  const cleanHours = (hours: WeeklyHours) => {
    const result: WeeklyHours = {};
    for (const [day, range] of Object.entries(hours ?? {})) {
      if (!["1", "2", "3", "4", "5", "6", "7"].includes(day)) {
        throw error(`День недели от 1 до 7: ${day}`, "22023");
      }
      if (!range) continue;
      const start = parseHm(range.start);
      const end = parseHm(range.end);
      if (start == null || end == null) {
        throw error("Время в формате ЧЧ:ММ", "22023");
      }
      if (end <= start) {
        throw error("Конец рабочего дня раньше начала", "22023");
      }
      const breaks = (range.breaks ?? []).map((pause) => {
        const from = parseHm(pause.start);
        const to = parseHm(pause.end);
        if (from == null || to == null || to <= from || from < start || to > end) {
          throw error("Перерыв вне рабочего дня", "22023");
        }
        return { start: pause.start, end: pause.end };
      });
      result[day as keyof WeeklyHours] = {
        start: range.start,
        end: range.end,
        breaks,
      };
    }
    return result;
  };

  const saveDoctorHours = async (
    doctorId: Identifier,
    hours: WeeklyHours | null,
    minutes?: number | null,
  ): Promise<Doctor> => {
    if (!(await canConfigure())) {
      throw error(
        "Only the owner, the head or the integrator configure the schedule",
        "42501",
      );
    }
    if (minutes != null && (minutes < 5 || minutes > 480)) {
      throw error("Длительность визита от 5 до 480 минут", "22023");
    }
    const { data: doctor } = await baseDataProvider.getOne<Doctor>("doctors", {
      id: doctorId,
    });
    const { data } = await baseDataProvider.update<Doctor>("doctors", {
      id: doctorId,
      data: {
        working_hours: hours == null ? doctor.working_hours : cleanHours(hours),
        visit_minutes: minutes ?? doctor.visit_minutes ?? 30,
      },
      previousData: doctor,
    });
    return data;
  };

  //
  // The deal of a visit (private.handle_visit_after_write)
  //

  const getDeal = async (id: Identifier | null | undefined) =>
    id == null
      ? undefined
      : (await all<Deal>("deals")).find((deal) => same(deal.id, id));

  const updateDeal = (deal: Deal, data: Partial<Deal>) =>
    getDataProvider().update<Deal>("deals", {
      id: deal.id,
      data,
      previousData: deal,
    });

  /** Same as private.sync_deal_appointment */
  const syncAppointment = async (
    dealId: Identifier | null | undefined,
    freedAt?: string | null,
  ) => {
    const deal = await getDeal(dealId);
    if (!deal) return;
    const visits = (await all<Visit>("visits")).filter(
      (visit) =>
        same(visit.deal_id, deal.id) &&
        visit.source === "crm" &&
        ["scheduled", "confirmed"].includes(visit.status),
    );
    const now = Date.now();
    const upcoming = visits
      .filter((visit) => new Date(visit.ends_at).getTime() > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    const latest = [...visits].sort((a, b) =>
      b.starts_at.localeCompare(a.starts_at),
    )[0];
    let next: string | null = (upcoming ?? latest)?.starts_at ?? null;
    const current = deal.appointment_at ?? null;
    if (next == null) {
      const known =
        current != null &&
        ((freedAt != null &&
          new Date(freedAt).getTime() === new Date(current).getTime()) ||
          (await all<Visit>("visits")).some(
            (visit) =>
              same(visit.deal_id, deal.id) &&
              new Date(visit.starts_at).getTime() ===
                new Date(current).getTime(),
          ));
      if (!known) return;
      next = null;
    }
    if (
      (current == null) !== (next == null) ||
      (current != null &&
        next != null &&
        new Date(current).getTime() !== new Date(next).getTime())
    ) {
      await updateDeal(deal, { appointment_at: next });
    }
  };

  const logRun = (
    deal: Deal,
    visit: Visit,
    status: VisitStatus,
    run: Pick<StageTriggerRun, "action" | "status" | "details" | "error">,
  ) =>
    baseDataProvider.create<StageTriggerRun>("stage_trigger_runs", {
      data: {
        deal_id: deal.id,
        trigger_id: null,
        trigger_name: "Расписание",
        event: "visit" as StageTriggerRun["event"],
        event_key: `visit:${visit.id}:${status}`,
        created_at: nowIso(),
        ...run,
      },
    });

  const findTag = async (name: string) => {
    const clean = name.trim();
    const tags = await all<Tag>("tags");
    const found = tags.find(
      (tag) => tag.name.trim().toLowerCase() === clean.toLowerCase(),
    );
    if (found) return found.id;
    const { data } = await baseDataProvider.create<Tag>("tags", {
      data: { name: clean, color: "#f8b4c6" },
    });
    return data.id;
  };

  /** Same as private.visit_apply_status */
  const applyStatus = async (visit: Visit, status: VisitStatus) => {
    const settings = await getScheduleSettings();
    const entry = settings.status_map[status];
    let deal = await getDeal(visit.deal_id);
    if (!entry || !deal || deal.archived_at || deal.unsorted_at) return;
    const stages = await all<Stage>("stages");
    const current = stages.find((s) => same(s.id, deal!.stage_id));

    if (entry.stage_id != null) {
      let target = stages.find((s) => same(s.id, entry.stage_id));
      if (target && !same(target.pipeline_id, deal.pipeline_id)) {
        target = stages
          .filter(
            (s) =>
              same(s.pipeline_id, deal!.pipeline_id) &&
              s.name === target!.name &&
              s.kind !== "lost",
          )
          .sort((a, b) => a.position - b.position)[0];
      }
      const backwards = status === "cancelled" || status === "no_show";
      if (
        target &&
        current &&
        !same(target.id, deal.stage_id) &&
        (backwards || target.position > current.position)
      ) {
        let reason: string | null = null;
        if (current.kind !== "open") reason = "Сделка закрыта";
        else if (target.kind === "lost")
          reason = "Перевод в отказ требует причины";
        else {
          try {
            await updateDeal(deal, { stage_id: target.id });
          } catch (e) {
            reason = e instanceof Error ? e.message : String(e);
          }
        }
        await logRun(deal, visit, status, {
          action: "move_stage",
          status: reason ? "skipped" : "done",
          details: {
            from_stage_id: current.id,
            to_stage_id: target.id,
          },
          error: reason,
        });
      }
    }

    const tagId =
      entry.tag_id ?? (entry.tag?.trim() ? await findTag(entry.tag) : null);
    deal = await getDeal(visit.deal_id);
    if (tagId != null && deal && !deal.tags.some((id) => same(id, tagId))) {
      await updateDeal(deal, { tags: [...deal.tags, Number(tagId)] });
      await logRun(deal, visit, status, {
        action: "add_tag",
        status: "done",
        details: { tag_id: tagId },
        error: null,
      });
    }

    const text = entry.task?.trim();
    if (text && deal) {
      const open = (await all<Task>("tasks")).some(
        (task) => same(task.deal_id, deal!.id) && !task.done_date && task.text === text,
      );
      if (!open) {
        await getDataProvider().create("tasks", {
          data: {
            deal_id: deal.id,
            type: "call",
            text,
            due_date: nowIso(),
            done_date: null,
            sales_id: deal.sales_id ?? null,
          },
        });
      }
    }
  };

  const afterWrite = async (visit: Visit, previous?: Visit) => {
    if (visit.source !== "crm") return;
    if (previous && !same(previous.deal_id, visit.deal_id)) {
      await syncAppointment(previous.deal_id, previous.starts_at);
    }
    if (visit.deal_id == null) return;
    await syncAppointment(visit.deal_id, previous?.starts_at);
    let deal = await getDeal(visit.deal_id);
    if (
      deal &&
      ((deal.doctor_id == null && visit.doctor_id != null) ||
        (deal.service_id == null && visit.service_id != null))
    ) {
      await updateDeal(deal, {
        doctor_id: deal.doctor_id ?? visit.doctor_id,
        service_id: deal.service_id ?? visit.service_id,
      });
    }
    const statusChanged = !previous || previous.status !== visit.status;
    deal = await getDeal(visit.deal_id);
    if (
      deal &&
      statusChanged &&
      (visit.status === "arrived" || visit.status === "completed") &&
      (!deal.visit_at ||
        (visit.status === "arrived" &&
          new Date(deal.visit_at) < new Date(visit.starts_at)))
    ) {
      await updateDeal(deal, { visit_at: visit.starts_at });
    }
    if (statusChanged) await applyStatus(visit, visit.status);
  };

  //
  // Checks (private.handle_visit_before_write)
  //

  const check = async (visit: Visit) => {
    if (visit.deal_id != null) {
      const deal = await getDeal(visit.deal_id);
      if (!deal || !same(deal.patient_id, visit.patient_id)) {
        throw error("Сделка другого пациента", "23514");
      }
    }
    if (new Date(visit.ends_at) <= new Date(visit.starts_at)) {
      throw error("Конец визита раньше начала", "23514");
    }
    if (visit.source !== "crm" || !isActiveStatus(visit.status)) return;
    const conflict = findConflict(visit, await all<Visit>("visits"));
    if (conflict) {
      const from = await timeLabel(conflict.visit.starts_at);
      const to = (await timeLabel(conflict.visit.ends_at)).slice(-5);
      throw error(
        conflict.resource === "doctor"
          ? `Врач уже занят: ${from}–${to}`
          : `Кресло уже занято: ${from}–${to}`,
        "23P01",
      );
    }
  };

  const previousVisits = new Map<string, Visit>();

  const callbacks: ResourceCallbacks<Visit>[] = [
    {
      resource: "visits",
      beforeCreate: async (params) => {
        if (await misKind()) {
          throw error("Запись ведётся в МИС", "42501");
        }
        const now = nowIso();
        const data = {
          status: "scheduled" as VisitStatus,
          deal_id: null,
          doctor_id: null,
          chair_id: null,
          service_id: null,
          note: null,
          ...params.data,
          source: "crm" as const,
          external_id: null,
          created_by: params.data.created_by ?? (await currentSalesId()) ?? null,
          created_at: now,
          updated_at: now,
          status_changed_at: now,
        } as Visit;
        await check({ ...data, id: -1 });
        return { ...params, data };
      },
      afterCreate: async (result) => {
        await afterWrite(result.data as Visit);
        return result;
      },
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<Visit>(
          "visits",
          { id: params.id },
        );
        if (previous.source === "mis") {
          throw error("Запись ведётся в МИС", "42501");
        }
        const {
          source: _source,
          external_id: _external,
          created_by: _author,
          created_at: _created,
          ...changes
        } = params.data as Partial<Visit>;
        const next = { ...previous, ...changes } as Visit;
        await check(next);
        previousVisits.set(String(params.id), previous);
        const now = nowIso();
        return {
          ...params,
          data: {
            ...changes,
            updated_at: now,
            ...(next.status !== previous.status
              ? { status_changed_at: now }
              : {}),
          },
        };
      },
      afterUpdate: async (result) => {
        const visit = result.data as Visit;
        const previous = previousVisits.get(String(visit.id));
        previousVisits.delete(String(visit.id));
        await afterWrite(visit, previous);
        return result;
      },
      beforeDelete: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<Visit>(
          "visits",
          { id: params.id },
        );
        if (previous.source === "mis") {
          throw error("Запись ведётся в МИС", "42501");
        }
        const sale = await me();
        if (sale && !["owner", "head"].includes(sale.role ?? "")) {
          throw error("Only the owner and the head delete visits", "42501");
        }
        previousVisits.set(`delete:${params.id}`, previous);
        return params;
      },
      afterDelete: async (result) => {
        const id = (result.data as Visit | undefined)?.id;
        const previous = previousVisits.get(`delete:${id}`);
        previousVisits.delete(`delete:${id}`);
        if (previous?.source === "crm") {
          await syncAppointment(previous.deal_id, previous.starts_at);
        }
        return result;
      },
    },
  ];

  /**
   * An inbound message answering the confirmation (same as
   * private.handle_message_visit_reply): a salesbot waiting on the deal
   * handles it; «1» confirms the patient's visit of the next 48 hours, «2»
   * gives a task «Перенести запись» and a notification.
   */
  const onMessage = async (message: Message) => {
    if (message.direction !== "in" || !message.text?.trim()) return null;
    if (
      message.deal_id != null &&
      (await all<SalesbotSession>("salesbot_sessions")).some(
        (session) =>
          same(session.deal_id, message.deal_id) &&
          ["running", "waiting"].includes(session.status),
      )
    ) {
      return null;
    }
    const settings = await getScheduleSettings();
    const kind = parseVisitReply(
      message.text,
      settings.confirm_keywords,
      settings.reschedule_keywords,
    );
    if (!kind) return null;
    const now = Date.now();
    const visit = (await all<Visit>("visits"))
      .filter(
        (v) =>
          same(v.patient_id, message.patient_id) &&
          v.source === "crm" &&
          ["scheduled", "confirmed"].includes(v.status) &&
          new Date(v.starts_at).getTime() > now &&
          new Date(v.starts_at).getTime() <= now + 48 * HOUR,
      )
      .sort(
        (a, b) =>
          Number(same(b.deal_id, message.deal_id)) -
            Number(same(a.deal_id, message.deal_id)) ||
          a.starts_at.localeCompare(b.starts_at),
      )[0];
    if (!visit) return null;
    if (kind === "confirm") {
      if (visit.status === "scheduled") {
        await getDataProvider().update("visits", {
          id: visit.id,
          data: { status: "confirmed" },
          previousData: visit,
        });
      }
      return kind;
    }
    const deal = await getDeal(visit.deal_id ?? message.deal_id);
    if (!deal) return null;
    const text = `Перенести запись ${await timeLabel(visit.starts_at)}`;
    const tasks = await all<Task>("tasks");
    if (tasks.some((t) => same(t.deal_id, deal.id) && !t.done_date && t.text === text)) {
      return kind;
    }
    const { data: task } = await baseDataProvider.create<Task>("tasks", {
      data: {
        deal_id: deal.id,
        type: "call",
        text,
        due_date: nowIso(),
        done_date: null,
        sales_id: deal.sales_id ?? undefined,
      },
    });
    const staff = await all<Sale>("sales");
    const recipients =
      deal.sales_id != null
        ? [deal.sales_id]
        : staff
            .filter((s) => ["owner", "head"].includes(s.role ?? "") && !s.disabled)
            .map((s) => s.id);
    const patient = (await all<Patient>("patients")).find((p) =>
      same(p.id, deal.patient_id),
    );
    const label = [
      [patient?.last_name, patient?.first_name].filter(Boolean).join(" ") ||
        "Пациент",
      deal.name,
    ]
      .filter(Boolean)
      .join(" · ");
    for (const recipient of recipients) {
      const at = nowIso();
      await baseDataProvider.create("notifications", {
        data: {
          sales_id: recipient,
          kind: "visit_reschedule",
          title: "Пациент просит перенести запись",
          body: `${label} · ${await timeLabel(visit.starts_at)}`,
          deal_id: deal.id,
          patient_id: deal.patient_id,
          task_id: task.id,
          message_count: 1,
          created_at: at,
          updated_at: at,
          read_at: null,
        } satisfies Omit<CrmNotification, "id">,
      });
    }
    return kind;
  };

  return {
    callbacks,
    onMessage,
    methods: {
      getScheduleSettings,
      saveScheduleSettings,
      saveDoctorHours,
      /** The demo user sees every deal: nothing is hidden */
      getScheduleBusy: async (): Promise<BusySlot[]> => [],
    },
  };
};
