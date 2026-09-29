import type {
  DataProvider,
  GetListResult,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import { applyLabStatus, localDay, overdueDays } from "../../lab/labMath";
import type {
  Lab,
  LabOrder,
  LabOrderCost,
  LabOrderItem,
  LabOrderItemPrice,
  LabOrderSummary,
  LabTechnician,
  LabWorkType,
  LabWorkTypePrice,
} from "../../lab/types";
import type { TreatmentPlan, TreatmentPlanItem } from "../../treatment/types";
import type { TreatmentStage } from "../../treatment/types";
import type { AuditLogEntry, Deal, Doctor, Patient, Sale } from "../../types";
import { createLabPlusDemo } from "./labPlus";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const fail = (message: string, code = "22023") =>
  Object.assign(new Error(message), { code });

const ORDER_AUDITED = [
  "number",
  "status",
  "lab_id",
  "technician_id",
  "doctor_id",
  "responsible_id",
  "plan_id",
  "teeth",
  "shade",
  "material",
  "comment",
  "sent_at",
  "fitting1_at",
  "fitting2_at",
  "due_at",
  "ready_at",
  "delivered_at",
  "fitting_visit_id",
] as const;
const ITEM_AUDITED = ["name", "qty", "work_type_id", "plan_item_id"] as const;

const diff = (
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fields: readonly string[],
) => {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const field of fields) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = [a, b];
  }
  return changes;
};

const trimOrNull = (value: unknown) =>
  typeof value === "string" ? value.trim() || null : (value ?? null);

/**
 * The lab work orders of the demo (stage 40): the same rules as
 * supabase/schemas/40_lab_orders.sql — «№» per clinic, the plan, stage,
 * deal and technician checked against the patient and the lab, the
 * doctor's administrator as the responsible, the dates of the statuses
 * (applyLabStatus), the names and the lab prices of the lines, the views
 * lab_orders_summary and lab_order_costs, rights (orders follow their
 * patient, never the integrator; prices for the owner and the head;
 * dictionaries for whoever configures the clinic) and the audit log.
 */
export const createLabOrdersDemo = ({
  baseDataProvider,
  getDataProvider,
  all,
  currentSalesId,
  logAudit,
  filterPatients,
}: {
  baseDataProvider: DataProvider;
  /** The demo provider with the lifecycle callbacks (stage 43 methods) */
  getDataProvider: () => DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
  /** The patients the employee sees (access rights, stage 30) */
  filterPatients: (patients: Patient[]) => Promise<Patient[]>;
}) => {
  const myRole = async () => {
    const id = await currentSalesId();
    return (
      (await all<Sale>("sales")).find((sale) => same(sale.id, id))?.role ??
      "owner"
    );
  };
  const seesMoney = async () => ["owner", "head"].includes(await myRole());
  const canWrite = async () =>
    ["owner", "head", "manager"].includes(await myRole());
  const canConfigure = async () =>
    ["owner", "head", "integrator"].includes(await myRole());
  const visiblePatientIds = async () =>
    new Set(
      (await filterPatients(await all<Patient>("patients"))).map((p) =>
        String(p.id),
      ),
    );
  const requireWriter = async (patientId: Identifier) => {
    if (!(await canWrite())) {
      throw fail("Нет права менять заказ-наряды", "42501");
    }
    if (!(await visiblePatientIds()).has(String(patientId))) {
      throw fail("Пациент недоступен", "42501");
    }
  };
  const today = () => localDay();

  // Stage 43: prices per lab, history, remakes, allocations, reports
  const plus = createLabPlusDemo({
    baseDataProvider,
    getDataProvider,
    all,
    currentSalesId,
    logAudit,
    myRole,
    visiblePatientIds,
  });

  const findOrder = async (id: Identifier) =>
    (await all<LabOrder>("lab_orders")).find((o) => same(o.id, id));

  const auditOrder = async (
    before: LabOrder | null,
    after: LabOrder | null,
  ) => {
    const changes = diff(
      before as Record<string, unknown> | null,
      after as Record<string, unknown> | null,
      ORDER_AUDITED,
    );
    if (before && after && !Object.keys(changes).length) return;
    const row = (after ?? before)!;
    await logAudit({
      entity: "lab_order",
      entity_id: row.id,
      action: !before ? "create" : !after ? "delete" : "update",
      changes: changes as AuditLogEntry["changes"],
      patient_id: row.patient_id,
      deal_id: row.deal_id ?? null,
    });
  };
  const auditLine = async (
    entity: "lab_order_item" | "lab_order_price",
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    fields: readonly string[],
    orderId: Identifier,
  ) => {
    const changes = diff(before, after, fields);
    if (before && after && !Object.keys(changes).length) return;
    const order = await findOrder(orderId);
    const row = (after ?? before)!;
    await logAudit({
      entity,
      entity_id: row.id as Identifier,
      action: !before ? "create" : !after ? "delete" : "update",
      changes: changes as AuditLogEntry["changes"],
      patient_id: order?.patient_id ?? null,
      deal_id: order?.deal_id ?? null,
    });
  };

  /** The links of an order, as handle_lab_order_before_write checks them */
  const resolveLinks = async (
    before: LabOrder | null,
    data: Partial<LabOrder>,
  ): Promise<Partial<LabOrder>> => {
    const next = { ...before, ...data } as Partial<LabOrder>;
    const out: Partial<LabOrder> = { ...data };
    if (
      next.stage_id != null &&
      (!before || !same(before.stage_id, next.stage_id))
    ) {
      const stage = (await all<TreatmentStage>("treatment_stages")).find((s) =>
        same(s.id, next.stage_id),
      );
      if (next.plan_id == null) {
        out.plan_id = stage?.plan_id ?? null;
        next.plan_id = out.plan_id;
      } else if (!same(next.plan_id, stage?.plan_id)) {
        throw fail("Этап из другого плана лечения");
      }
    }
    if (next.plan_id == null) {
      out.stage_id = null;
    } else if (!before || !same(before.plan_id, next.plan_id)) {
      const plan = (await all<TreatmentPlan>("treatment_plans")).find((p) =>
        same(p.id, next.plan_id),
      );
      if (!plan || !same(plan.patient_id, next.patient_id)) {
        throw fail("План лечения другого пациента");
      }
      out.deal_id = plan.deal_id;
      out.doctor_id = next.doctor_id ?? plan.doctor_id ?? null;
    }
    if (
      next.plan_id == null &&
      next.deal_id != null &&
      (!before || !same(before.deal_id, next.deal_id))
    ) {
      const deal = (await all<Deal>("deals")).find((d) =>
        same(d.id, next.deal_id),
      );
      if (!deal || !same(deal.patient_id, next.patient_id)) {
        throw fail("Сделка другого пациента");
      }
    }
    if (
      next.technician_id != null &&
      (!before ||
        !same(before.technician_id, next.technician_id) ||
        !same(before.lab_id, next.lab_id))
    ) {
      const tech = (await all<LabTechnician>("lab_technicians")).find((t) =>
        same(t.id, next.technician_id),
      );
      if (next.lab_id == null) {
        out.lab_id = tech?.lab_id ?? null;
      } else if (!same(next.lab_id, tech?.lab_id)) {
        throw fail("Техник работает в другой лаборатории");
      }
    }
    if (data.teeth !== undefined) {
      out.teeth = [...new Set((data.teeth ?? []).map(Number))].sort(
        (a, b) => a - b,
      );
    }
    for (const key of ["shade", "material", "comment"] as const) {
      if (data[key] !== undefined) out[key] = trimOrNull(data[key]) as never;
    }
    return out;
  };

  /** The name of a line (its work type) and its plan item, like the trigger */
  const checkLine = async (
    order: LabOrder,
    data: Partial<LabOrderItem>,
    before: LabOrderItem | null,
  ) => {
    const out: Partial<LabOrderItem> = { ...data };
    const workTypeId =
      data.work_type_id !== undefined
        ? data.work_type_id
        : before?.work_type_id;
    let name = (data.name ?? before?.name ?? "").trim();
    if (
      workTypeId != null &&
      (!name ||
        (before &&
          !same(before.work_type_id, workTypeId) &&
          name === before.name))
    ) {
      name =
        (await all<LabWorkType>("lab_work_types")).find((w) =>
          same(w.id, workTypeId),
        )?.name ?? name;
    }
    if (!name) throw fail("Укажите вид работы");
    out.name = name;
    if (data.qty !== undefined) {
      const qty = Math.round(Number(data.qty));
      if (!(qty >= 1 && qty <= 100))
        throw fail("Количество от 1 до 100", "23514");
      out.qty = qty;
    }
    const planItemId = data.plan_item_id;
    if (
      planItemId != null &&
      (!before || !same(before.plan_item_id, planItemId))
    ) {
      const item = (await all<TreatmentPlanItem>("treatment_plan_items")).find(
        (i) => same(i.id, planItemId),
      );
      const plan = (await all<TreatmentPlan>("treatment_plans")).find((p) =>
        same(p.id, item?.plan_id),
      );
      if (
        !item ||
        !plan ||
        !same(plan.patient_id, order.patient_id) ||
        (order.plan_id != null && !same(plan.id, order.plan_id))
      ) {
        throw fail("Позиция другого плана лечения");
      }
    }
    return out;
  };

  const writePrice = async (item: LabOrderItem) => {
    const order = await findOrder(item.order_id);
    const price = order
      ? await plus.priceOfLine(order, item.work_type_id ?? null)
      : 0;
    const existing = (
      await all<LabOrderItemPrice>("lab_order_item_prices")
    ).find((p) => same(p.item_id, item.id));
    if (existing) {
      await baseDataProvider.update("lab_order_item_prices", {
        id: existing.id,
        data: { price, updated_at: new Date().toISOString() },
        previousData: existing,
      });
    } else {
      await baseDataProvider.create("lab_order_item_prices", {
        data: { item_id: item.id, price, updated_at: new Date().toISOString() },
      });
    }
  };

  const previous = new Map<string, any>();
  const remember = (resource: string) => async (params: any) => {
    const { data } = await baseDataProvider.getOne(resource, { id: params.id });
    previous.set(`${resource}:${params.id}`, data);
    return params;
  };
  const recall = (resource: string, id: Identifier) => {
    const key = `${resource}:${id}`;
    const row = previous.get(key) ?? null;
    previous.delete(key);
    return row;
  };

  /** Dictionaries: every employee reads them, the configurators write */
  const dictionary = (
    resource: string,
    entity: string,
    fields: string[],
  ): ResourceCallbacks => {
    const guard = async (params: any) => {
      if (!(await canConfigure())) {
        throw fail(
          "Справочники лаборатории меняют владелец и руководитель",
          "42501",
        );
      }
      return params;
    };
    return {
      resource,
      beforeCreate: guard,
      beforeUpdate: async (params: any) =>
        remember(resource)(await guard(params)),
      beforeDelete: async (params: any) => {
        await guard(params);
        if (
          resource === "labs" &&
          (await all<LabOrder>("lab_orders")).some((o) =>
            same(o.lab_id, params.id),
          )
        ) {
          throw fail(
            "Лаборатория есть в нарядах: отправьте её в архив",
            "23503",
          );
        }
        return remember(resource)(params);
      },
      afterCreate: async (result: any) => {
        await logAudit({
          entity,
          entity_id: result.data.id,
          action: "create",
          changes: diff(null, result.data, fields) as AuditLogEntry["changes"],
        });
        return result;
      },
      afterUpdate: async (result: any) => {
        const before = recall(resource, result.data.id);
        const changes = diff(before, result.data, fields);
        if (Object.keys(changes).length) {
          await logAudit({
            entity,
            entity_id: result.data.id,
            action: "update",
            changes: changes as AuditLogEntry["changes"],
          });
        }
        return result;
      },
      afterDelete: async (result: any) => {
        const before = recall(resource, result.data.id);
        if (resource === "labs") {
          for (const tech of (
            await all<LabTechnician>("lab_technicians")
          ).filter((t) => same(t.lab_id, result.data.id))) {
            await baseDataProvider.delete("lab_technicians", {
              id: tech.id,
              previousData: tech,
            });
          }
        }
        await logAudit({
          entity,
          entity_id: result.data.id,
          action: "delete",
          changes: diff(before, null, fields) as AuditLogEntry["changes"],
        });
        return result;
      },
    };
  };

  /** Money: the owner and the head only */
  const money = (resource: string, entity: string): ResourceCallbacks => {
    const guard = async (params: any) => {
      if (!(await seesMoney())) {
        throw fail("Цены лаборатории меняют владелец и руководитель", "42501");
      }
      return params;
    };
    return {
      resource,
      afterGetList: async (result: GetListResult) =>
        (await seesMoney()) ? result : { ...result, data: [], total: 0 },
      beforeCreate: async (params: any) => {
        await guard(params);
        if (resource === "lab_order_item_prices") {
          throw fail("Цену строки пишет наряд", "42501");
        }
        // Stage 43: a price of a lab (or the default) from a day on
        const data = {
          lab_id: null,
          effective_from: "2000-01-01",
          ...params.data,
        } as LabWorkTypePrice;
        const price = Math.round(Number(data.price ?? 0));
        if (!(price >= 0 && price <= 100_000_000)) {
          throw fail("Цена от 0 до 100 000 000 ₸", "23514");
        }
        if (
          (await all<LabWorkTypePrice>("lab_work_type_prices")).some(
            (p) =>
              same(p.work_type_id, data.work_type_id) &&
              String(p.lab_id ?? "") === String(data.lab_id ?? "") &&
              (p.effective_from ?? "2000-01-01") === data.effective_from,
          )
        ) {
          throw fail("Цена на этот день уже есть", "23505");
        }
        return {
          ...params,
          data: { ...data, price, updated_at: new Date().toISOString() },
        };
      },
      beforeUpdate: async (params: any) => {
        await guard(params);
        const { data } = await baseDataProvider.getOne(resource, {
          id: params.id,
        });
        previous.set(`${resource}:${params.id}`, data);
        const price = Math.round(Number(params.data.price));
        if (!(price >= 0 && price <= 100_000_000)) {
          throw fail("Цена от 0 до 100 000 000 ₸", "23514");
        }
        return {
          ...params,
          data: { price, updated_at: new Date().toISOString() },
        };
      },
      beforeDelete: async (params: any) => {
        await guard(params);
        if (resource === "lab_order_item_prices") {
          throw fail("Цену строки пишет наряд", "42501");
        }
        return params;
      },
      afterUpdate: async (result: any) => {
        const before = recall(resource, result.data.id);
        if (before?.price === result.data.price) return result;
        if (resource === "lab_order_item_prices") {
          const item = (await all<LabOrderItem>("lab_order_items")).find((i) =>
            same(i.id, result.data.item_id),
          );
          if (item) {
            await auditLine(
              "lab_order_price",
              before,
              result.data,
              ["price"],
              item.order_id,
            );
          }
        } else {
          await logAudit({
            entity,
            entity_id: result.data.id,
            action: "update",
            changes: diff(before, result.data, [
              "work_type_id",
              "price",
            ]) as AuditLogEntry["changes"],
          });
        }
        return result;
      },
      afterCreate: async (result: any) => {
        await logAudit({
          entity,
          entity_id: result.data.id,
          action: "create",
          changes: diff(null, result.data, [
            "work_type_id",
            "lab_id",
            "effective_from",
            "price",
          ]) as AuditLogEntry["changes"],
        });
        return result;
      },
    };
  };

  const callbacks: ResourceCallbacks[] = [
    dictionary("labs", "lab", [
      "name",
      "is_own",
      "contact_person",
      "phone",
      "email",
      "address",
      "is_active",
      "work_weekdays",
    ]),
    dictionary("lab_technicians", "lab_technician", [
      "name",
      "lab_id",
      "phone",
      "is_active",
    ]),
    dictionary("lab_work_types", "lab_work_type", [
      "name",
      "is_active",
      "fitting_days",
      "ready_days",
      "warranty_months",
    ]),
    dictionary("lab_work_type_terms", "lab_work_type_term", [
      "lab_id",
      "work_type_id",
      "fitting_days",
      "ready_days",
    ]),
    dictionary("lab_remake_reasons", "lab_remake_reason", [
      "name",
      "is_active",
    ]),
    money("lab_work_type_prices", "lab_work_type_price"),
    money("lab_order_item_prices", "lab_order_price"),
    {
      resource: "lab_orders",
      afterGetList: async (result: GetListResult) => {
        if ((await myRole()) === "integrator") {
          return { ...result, data: [], total: 0 };
        }
        const visible = await visiblePatientIds();
        const data = result.data.filter((row) =>
          visible.has(String(row.patient_id)),
        );
        return { ...result, data, total: data.length };
      },
      beforeCreate: async (params: any) => {
        const data = params.data as Partial<LabOrder>;
        if (data.patient_id == null) throw fail("Выберите пациента");
        await requireWriter(data.patient_id);
        const orders = await all<LabOrder>("lab_orders");
        const me = (await currentSalesId()) ?? null;
        const linked = {
          ...(await resolveLinks(null, data)),
          ...(await plus.checkFittingVisit(null, data)),
        };
        const doctorId = linked.doctor_id ?? data.doctor_id ?? null;
        const doctor = (await all<Doctor>("doctors")).find((d) =>
          same(d.id, doctorId),
        );
        let branchId = data.branch_id ?? doctor?.branch_id ?? null;
        const dealId = linked.deal_id ?? data.deal_id ?? null;
        if (branchId == null && dealId != null) {
          branchId =
            (await all<Deal>("deals")).find((d) => same(d.id, dealId))
              ?.branch_id ?? null;
        }
        const now = new Date().toISOString();
        return {
          ...params,
          data: applyLabStatus(
            null,
            {
              teeth: [],
              shade: null,
              material: null,
              comment: null,
              deal_id: null,
              plan_id: null,
              stage_id: null,
              lab_id: null,
              technician_id: null,
              fitting1_at: null,
              fitting2_at: null,
              due_at: null,
              fitting_visit_id: null,
              ...data,
              ...linked,
              number: Math.max(0, ...orders.map((o) => o.number)) + 1,
              doctor_id: doctorId,
              branch_id: branchId,
              responsible_id:
                data.responsible_id ?? doctor?.admin_sales_id ?? me,
              created_by: me,
              created_at: now,
              updated_at: now,
            },
            today(),
          ),
        };
      },
      afterCreate: async (result: any) => {
        await auditOrder(null, result.data);
        await plus.afterOrderWrite(null, result.data);
        return result;
      },
      beforeUpdate: async (params: any) => {
        const before = await findOrder(params.id);
        if (!before) throw fail("Наряд не найден", "P0002");
        await requireWriter(before.patient_id);
        previous.set(`lab_orders:${params.id}`, before);
        const {
          number: _number,
          created_by: _createdBy,
          created_at: _createdAt,
          remake_count: _remakes,
          first_ready_at: _firstReady,
          first_delivered_at: _firstDelivered,
          ...data
        } = params.data as Partial<LabOrder>;
        const linked = {
          ...(await resolveLinks(before, data)),
          ...(await plus.checkFittingVisit(before, data)),
        };
        return {
          ...params,
          data: {
            ...applyLabStatus(before, { ...data, ...linked }, today()),
            updated_at: new Date().toISOString(),
          },
        };
      },
      afterUpdate: async (result: any) => {
        const before = recall("lab_orders", result.data.id) as LabOrder | null;
        await auditOrder(before, result.data);
        await plus.afterOrderWrite(before, result.data);
        return result;
      },
      beforeDelete: async (params: any) => {
        const order = await findOrder(params.id);
        if (!order) throw fail("Наряд не найден", "P0002");
        const role = await myRole();
        const me = await currentSalesId();
        const allowed =
          role === "owner" ||
          role === "head" ||
          (role === "manager" &&
            same(order.created_by, me) &&
            order.status === "clinic");
        if (
          !allowed ||
          !(await visiblePatientIds()).has(String(order.patient_id))
        ) {
          throw fail(
            "Удалить наряд может владелец, руководитель или автор, пока наряд в клинике",
            "42501",
          );
        }
        previous.set(`lab_orders:${params.id}`, order);
        return params;
      },
      afterDelete: async (result: any) => {
        const order = recall("lab_orders", result.data.id) as LabOrder | null;
        const items = (await all<LabOrderItem>("lab_order_items")).filter((i) =>
          same(i.order_id, result.data.id),
        );
        const prices = await all<LabOrderItemPrice>("lab_order_item_prices");
        for (const item of items) {
          for (const price of prices.filter((p) => same(p.item_id, item.id))) {
            await baseDataProvider.delete("lab_order_item_prices", {
              id: price.id,
              previousData: price,
            });
          }
          await baseDataProvider.delete("lab_order_items", {
            id: item.id,
            previousData: item,
          });
        }
        // The remakes, the history and the allocations go with the order
        for (const resource of [
          "lab_order_remakes",
          "lab_order_events",
          "lab_payment_allocations",
        ]) {
          for (const row of (
            await all<{ id: Identifier; order_id: Identifier }>(resource)
          ).filter((r) => same(r.order_id, result.data.id))) {
            await baseDataProvider.delete(resource, {
              id: row.id,
              previousData: row,
            });
          }
        }
        if (order) await auditOrder(order, null);
        return result;
      },
    },
    {
      resource: "lab_order_items",
      afterGetList: async (result: GetListResult) => {
        if ((await myRole()) === "integrator") {
          return { ...result, data: [], total: 0 };
        }
        return result;
      },
      beforeCreate: async (params: any) => {
        const order = await findOrder(params.data.order_id);
        if (!order) throw fail("Наряд не найден", "42501");
        await requireWriter(order.patient_id);
        return {
          ...params,
          data: {
            qty: 1,
            position: 0,
            plan_item_id: null,
            work_type_id: null,
            ...params.data,
            ...(await checkLine(order, params.data, null)),
            created_at: new Date().toISOString(),
          },
        };
      },
      afterCreate: async (result: any) => {
        await writePrice(result.data);
        await auditLine(
          "lab_order_item",
          null,
          result.data,
          ITEM_AUDITED,
          result.data.order_id,
        );
        return result;
      },
      beforeUpdate: async (params: any) => {
        const { data: before } = await baseDataProvider.getOne<LabOrderItem>(
          "lab_order_items",
          { id: params.id },
        );
        if (
          params.data.order_id !== undefined &&
          !same(params.data.order_id, before.order_id)
        ) {
          throw fail("Строку нельзя перенести в другой наряд");
        }
        const order = await findOrder(before.order_id);
        if (!order) throw fail("Наряд не найден", "42501");
        await requireWriter(order.patient_id);
        previous.set(`lab_order_items:${params.id}`, before);
        return {
          ...params,
          data: {
            ...params.data,
            order_id: before.order_id,
            ...(await checkLine(order, params.data, before)),
          },
        };
      },
      afterUpdate: async (result: any) => {
        const before = recall("lab_order_items", result.data.id);
        if (before && !same(before.work_type_id, result.data.work_type_id)) {
          await writePrice(result.data);
        }
        await auditLine(
          "lab_order_item",
          before,
          result.data,
          ITEM_AUDITED,
          result.data.order_id,
        );
        return result;
      },
      beforeDelete: async (params: any) => {
        const { data: before } = await baseDataProvider.getOne<LabOrderItem>(
          "lab_order_items",
          { id: params.id },
        );
        const order = await findOrder(before.order_id);
        if (order) await requireWriter(order.patient_id);
        previous.set(`lab_order_items:${params.id}`, before);
        return params;
      },
      afterDelete: async (result: any) => {
        const before = recall("lab_order_items", result.data.id);
        for (const price of (
          await all<LabOrderItemPrice>("lab_order_item_prices")
        ).filter((p) => same(p.item_id, result.data.id))) {
          await baseDataProvider.delete("lab_order_item_prices", {
            id: price.id,
            previousData: price,
          });
        }
        if (before) {
          await auditLine(
            "lab_order_item",
            before,
            null,
            ITEM_AUDITED,
            before.order_id,
          );
        }
        return result;
      },
    },
    ...plus.callbacks,
  ];

  // --- views ------------------------------------------------------------

  /** public.lab_orders_summary: names, works, overdue days, lab cost */
  const ordersSummary = async (): Promise<LabOrderSummary[]> => {
    if ((await myRole()) === "integrator") return [];
    const [orders, items, prices, patients, doctors, labs, techs, sales] =
      await Promise.all([
        all<LabOrder>("lab_orders"),
        all<LabOrderItem>("lab_order_items"),
        all<LabOrderItemPrice>("lab_order_item_prices"),
        all<Patient>("patients"),
        all<Doctor>("doctors"),
        all<Lab>("labs"),
        all<LabTechnician>("lab_technicians"),
        all<Sale>("sales"),
      ]);
    const visible = await visiblePatientIds();
    const money = await seesMoney();
    const day = today();
    const extras = await plus.summaryExtras();
    return orders
      .filter((order) => visible.has(String(order.patient_id)))
      .map((order) => {
        const patient = patients.find((p) => same(p.id, order.patient_id));
        const lines = items
          .filter((i) => same(i.order_id, order.id))
          .sort(
            (a, b) => a.position - b.position || Number(a.id) - Number(b.id),
          );
        const responsible = sales.find((s) => same(s.id, order.responsible_id));
        const cost = lines.reduce(
          (sum, line) =>
            sum +
            line.qty *
              (prices.find((p) => same(p.item_id, line.id))?.price ?? 0),
          0,
        );
        return {
          ...order,
          patient_name:
            [patient?.last_name, patient?.first_name, patient?.middle_name]
              .filter(Boolean)
              .join(" ") || null,
          patient_phone: patient?.phones?.[0] ?? null,
          doctor_name:
            doctors.find((d) => same(d.id, order.doctor_id))?.name ?? null,
          lab_name: labs.find((l) => same(l.id, order.lab_id))?.name ?? null,
          technician_name:
            techs.find((t) => same(t.id, order.technician_id))?.name ?? null,
          responsible_name: responsible
            ? [responsible.first_name, responsible.last_name]
                .filter(Boolean)
                .join(" ")
            : null,
          items_count: lines.length,
          units: lines.reduce((sum, line) => sum + line.qty, 0),
          works: lines.length
            ? lines
                .map((line) =>
                  line.qty > 1 ? `${line.name} × ${line.qty}` : line.name,
                )
                .join(", ")
            : null,
          overdue_days: overdueDays(order.status, order.due_at, day),
          lab_cost: money && lines.length ? cost : null,
          ...extras(order, money && lines.length ? cost : null),
        };
      });
  };

  /**
   * public.lab_order_costs (owner, head): the lines with their prices,
   * billed on the first ready day, and the paid remakes (stage 43)
   */
  const orderCosts = async (): Promise<LabOrderCost[]> =>
    (await seesMoney()) ? plus.costRows() : [];

  // «lab_orders_summary» reaches the demo as «lab_orders» (the adapter drops
  // the suffix): the raw rows are read through the view too
  const views = {
    lab_orders: ordersSummary,
    lab_order_costs: orderCosts,
    ...plus.views,
  };

  return { callbacks, views, methods: plus.methods };
};
