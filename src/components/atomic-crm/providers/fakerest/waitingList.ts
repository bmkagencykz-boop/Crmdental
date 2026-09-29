import type {
  DataProvider,
  GetListResult,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import type { Visit } from "../../schedule/types";
import type {
  AuditLogEntry,
  CrmNotification,
  Deal,
  Doctor,
  Patient,
  Sale,
} from "../../types";
import { ISO_WEEKDAYS, type WaitingEntry } from "../../waiting-list/types";
import {
  entriesForFreedSlot,
  freedSlotOfChange,
  isActiveEntry,
  statusPatch,
} from "../../waiting-list/waitingMatch";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const fail = (message: string, code = "22023") =>
  Object.assign(new Error(message), { code });

/** Fields of an entry in the audit log (as the trigger audit_waiting_list) */
const AUDITED = [
  "patient_id",
  "deal_id",
  "doctor_id",
  "service_id",
  "direction",
  "branch_id",
  "date_from",
  "date_to",
  "weekdays",
  "day_parts",
  "time_from",
  "time_to",
  "priority",
  "status",
  "visit_id",
  "offered_starts_at",
  "sales_id",
  "comment",
] as const;

const diff = (
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) => {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const field of AUDITED) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = [a, b];
  }
  return changes;
};

const blankToNull = (value: string | null | undefined) =>
  value == null ? value : value.trim() || null;

/**
 * The waiting list of the demo (stage 38): the same rules as
 * supabase/schemas/38_waiting_list.sql — defaults of a new entry (author,
 * responsible of the deal, branch of the deal or the doctor), the deal and
 * the visit of the patient, a linked visit books the entry, status dates
 * and the offer, a freed slot of the schedule (cancelled, «не пришёл»,
 * deleted, moved) highlights the fitting entries and notifies their
 * responsible, a cancelled or deleted booked visit puts the entry back;
 * rights (follows the patient and the deal; the owner, the head or the
 * author deletes; nothing for the integrator) and the audit log.
 */
export const createWaitingListDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  logAudit,
  patientVisible,
  dealVisible,
  timeZone,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
  patientVisible: (patientId: Identifier) => Promise<boolean>;
  dealVisible: (dealId: Identifier) => Promise<boolean>;
  timeZone: () => string;
}) => {
  const me = async () => {
    const id = await currentSalesId();
    return (await all<Sale>("sales")).find((sale) => same(sale.id, id));
  };
  // The demo's default user (no staff row) is the owner
  const myRole = async () => (await me())?.role ?? "owner";
  const visible = async (entry: Pick<WaitingEntry, "patient_id" | "deal_id">) =>
    (await patientVisible(entry.patient_id)) &&
    (entry.deal_id == null || (await dealVisible(entry.deal_id)));
  const requireWriter = async (
    entry: Pick<WaitingEntry, "patient_id" | "deal_id">,
  ) => {
    if (!["owner", "head", "manager"].includes(await myRole())) {
      throw fail("Нет права менять лист ожидания", "42501");
    }
    if (!(await visible(entry))) throw fail("Пациент недоступен", "42501");
  };

  const audit = async (
    before: WaitingEntry | null,
    after: WaitingEntry | null,
  ) => {
    const changes = diff(
      before as Record<string, unknown> | null,
      after as Record<string, unknown> | null,
    );
    if (before && after && !Object.keys(changes).length) return;
    const row = (after ?? before)!;
    await logAudit({
      entity: "waiting_list",
      entity_id: row.id,
      action: !before ? "create" : !after ? "delete" : "update",
      changes: changes as AuditLogEntry["changes"],
      patient_id: row.patient_id,
      deal_id: row.deal_id ?? null,
    });
  };

  /**
   * private.handle_waiting_list_before_write: checks, cleaning, defaults,
   * status dates
   */
  const prepare = async (
    data: Partial<WaitingEntry>,
    previous: WaitingEntry | null,
  ): Promise<Partial<WaitingEntry>> => {
    const next = { ...(previous ?? {}), ...data } as WaitingEntry;
    let deal: Deal | undefined;
    if (next.deal_id != null) {
      deal = (await all<Deal>("deals")).find((row) =>
        same(row.id, next.deal_id),
      );
      if (
        (!previous || !same(previous.deal_id, next.deal_id)) &&
        deal &&
        !same(deal.patient_id, next.patient_id)
      ) {
        throw fail("Сделка другого пациента");
      }
    }
    if (
      next.visit_id != null &&
      (!previous || !same(previous.visit_id, next.visit_id))
    ) {
      const visit = (await all<Visit>("visits")).find((row) =>
        same(row.id, next.visit_id),
      );
      if (!visit || !same(visit.patient_id, next.patient_id)) {
        throw fail("Запись другого пациента");
      }
      if (isActiveEntry(next)) next.status = "booked";
    }
    const weekdays = Array.from(
      new Set((next.weekdays ?? []).map(Number)),
    ).sort((a, b) => a - b);
    if (
      weekdays.some((day) => !(ISO_WEEKDAYS as readonly number[]).includes(day))
    ) {
      throw fail("День недели — от 1 до 7", "23514");
    }
    if ((next.time_from == null) !== (next.time_to == null)) {
      throw fail("Укажите оба конца часов", "23514");
    }
    if (next.date_to && next.date_to < next.date_from) {
      throw fail("Период заканчивается раньше, чем начинается", "23514");
    }
    const now = new Date().toISOString();
    const salesId = (await currentSalesId()) ?? null;
    const result: Partial<WaitingEntry> = {
      ...data,
      status: next.status,
      weekdays,
      day_parts: Array.from(new Set(next.day_parts ?? [])).sort(),
      comment: blankToNull(next.comment) ?? null,
      direction: blankToNull(next.direction) ?? null,
      updated_at: now,
    };
    if (!previous) {
      const doctor = (await all<Doctor>("doctors")).find((row) =>
        same(row.id, next.doctor_id),
      );
      Object.assign(result, {
        status: next.status ?? "waiting",
        priority: next.priority ?? "normal",
        date_from: next.date_from ?? now.slice(0, 10),
        date_to: next.date_to ?? null,
        created_by: next.created_by ?? salesId,
        sales_id: next.sales_id ?? deal?.sales_id ?? salesId,
        branch_id:
          next.branch_id ?? deal?.branch_id ?? doctor?.branch_id ?? null,
        created_at: now,
        status_changed_at: now,
      });
    } else {
      // The booked visit was deleted or unlinked: back to the list
      if (
        previous.visit_id != null &&
        next.visit_id == null &&
        result.status === "booked"
      ) {
        result.status = "waiting";
      }
      if (result.status !== previous.status) result.status_changed_at = now;
      delete result.created_by;
      delete result.created_at;
    }
    if (
      result.status === "offered" &&
      (!previous ||
        previous.status !== "offered" ||
        next.offered_starts_at !== previous.offered_starts_at)
    ) {
      result.offered_at = now;
      result.offered_by = salesId ?? next.offered_by ?? null;
    }
    if (result.status) Object.assign(result, statusPatch(result.status));
    return result;
  };

  const previousEntries = new Map<string, WaitingEntry>();
  const previousVisits = new Map<string, Visit>();

  const updateEntry = async (
    entry: WaitingEntry,
    data: Partial<WaitingEntry>,
  ) => {
    const prepared = await prepare(data, entry);
    const { data: saved } = await baseDataProvider.update<WaitingEntry>(
      "waiting_list",
      { id: entry.id, data: prepared, previousData: entry },
    );
    await audit(entry, saved);
    return saved;
  };

  /** private.waiting_list_slot_freed */
  const slotFreed = async (before: Visit, after: Visit | null) => {
    const slot = freedSlotOfChange(before, after);
    if (!slot) return;
    const entries = entriesForFreedSlot(
      await all<WaitingEntry>("waiting_list"),
      slot,
      timeZone(),
    );
    if (!entries.length) return;
    const doctor = (await all<Doctor>("doctors")).find((row) =>
      same(row.id, slot.doctor_id),
    );
    const patients = await all<Patient>("patients");
    const staff = await all<Sale>("sales");
    const label = timeLabel(slot.starts_at);
    for (const entry of entries) {
      await baseDataProvider.update<WaitingEntry>("waiting_list", {
        id: entry.id,
        data: {
          slot_starts_at: slot.starts_at,
          slot_ends_at: slot.ends_at,
          slot_doctor_id: slot.doctor_id,
          slot_found_at: new Date().toISOString(),
        },
        previousData: entry,
      });
      const patient = patients.find((row) => same(row.id, entry.patient_id));
      const name =
        [patient?.last_name, patient?.first_name].filter(Boolean).join(" ") ||
        patient?.phones?.[0] ||
        "Пациент";
      const responsible = entry.sales_id ?? entry.created_by;
      const recipients =
        responsible != null
          ? [responsible]
          : staff
              .filter(
                (sale) =>
                  ["owner", "head"].includes(sale.role ?? "") && !sale.disabled,
              )
              .map((sale) => sale.id);
      for (const recipient of recipients) {
        if (!staff.some((sale) => same(sale.id, recipient) && !sale.disabled)) {
          continue;
        }
        const at = new Date().toISOString();
        await baseDataProvider.create("notifications", {
          data: {
            sales_id: recipient,
            kind: "waiting_list_slot",
            title: "Освободилось время для листа ожидания",
            body: [name, label, doctor?.name].filter(Boolean).join(" · "),
            deal_id: entry.deal_id ?? null,
            patient_id: entry.patient_id,
            task_id: null,
            message_count: 1,
            created_at: at,
            updated_at: at,
            read_at: null,
          } satisfies Omit<CrmNotification, "id">,
        });
      }
    }
  };

  const timeLabel = (value: string) => {
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone: timeZone(),
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

  /** A booked visit cancelled or deleted: its entries go back to the list */
  const releaseEntries = async (visitId: Identifier) => {
    const booked = (await all<WaitingEntry>("waiting_list")).filter(
      (entry) => same(entry.visit_id, visitId) && entry.status === "booked",
    );
    for (const entry of booked) {
      await updateEntry(entry, { visit_id: null, status: "waiting" });
    }
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "waiting_list",
      afterGetList: async (result: GetListResult) => {
        if ((await myRole()) === "integrator") {
          return { ...result, data: [], total: 0 };
        }
        const data = [];
        for (const row of result.data) {
          if (await visible(row)) data.push(row);
        }
        return { ...result, data, total: data.length };
      },
      beforeCreate: async (params) => {
        if (params.data.patient_id == null) throw fail("Выберите пациента");
        await requireWriter(params.data as WaitingEntry);
        return { ...params, data: await prepare(params.data, null) };
      },
      afterCreate: async (result) => {
        await audit(null, result.data as WaitingEntry);
        return result;
      },
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<WaitingEntry>(
          "waiting_list",
          {
            id: params.id,
          },
        );
        await requireWriter(previous);
        previousEntries.set(String(params.id), previous);
        return { ...params, data: await prepare(params.data, previous) };
      },
      afterUpdate: async (result) => {
        const before = previousEntries.get(String(result.data.id)) ?? null;
        previousEntries.delete(String(result.data.id));
        await audit(before, result.data as WaitingEntry);
        return result;
      },
      beforeDelete: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<WaitingEntry>(
          "waiting_list",
          {
            id: params.id,
          },
        );
        const role = await myRole();
        if (
          !(await visible(previous)) ||
          !(
            role === "owner" ||
            role === "head" ||
            (role === "manager" &&
              same(previous.created_by, await currentSalesId()))
          )
        ) {
          throw fail("Удалить может владелец, руководитель или автор", "42501");
        }
        previousEntries.set(`delete:${params.id}`, previous);
        return params;
      },
      afterDelete: async (result) => {
        const key = `delete:${result.data.id}`;
        const before = previousEntries.get(key) ?? null;
        previousEntries.delete(key);
        if (before) await audit(before, null);
        return result;
      },
    } as ResourceCallbacks<WaitingEntry>,
    // The schedule frees slots (private.handle_visit_waiting_list)
    {
      resource: "visits",
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<Visit>(
          "visits",
          { id: params.id },
        );
        previousVisits.set(String(params.id), previous);
        return params;
      },
      afterUpdate: async (result) => {
        const visit = result.data as Visit;
        const before = previousVisits.get(String(visit.id));
        previousVisits.delete(String(visit.id));
        if (!before) return result;
        if (visit.status === "cancelled" && before.status !== "cancelled") {
          await releaseEntries(visit.id);
        }
        await slotFreed(before, visit);
        return result;
      },
      beforeDelete: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<Visit>(
          "visits",
          { id: params.id },
        );
        previousVisits.set(`delete:${params.id}`, previous);
        return params;
      },
      afterDelete: async (result) => {
        const key = `delete:${result.data.id}`;
        const before = previousVisits.get(key);
        previousVisits.delete(key);
        if (!before) return result;
        await releaseEntries(before.id);
        await slotFreed(before, null);
        return result;
      },
    } as ResourceCallbacks<Visit>,
  ];

  return { callbacks };
};
