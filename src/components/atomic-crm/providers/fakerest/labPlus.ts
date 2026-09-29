import type {
  DataProvider,
  GetListResult,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import { localDay } from "../../lab/labMath";
import {
  allocationError,
  inWarranty,
  labPriceOn,
  labQuality,
  labReconciliation,
  orderBalances,
  remakeCosts,
  remakeIsPaid,
  warrantyUntil,
} from "../../lab/labPlusMath";
import type {
  Lab,
  LabFault,
  LabOrder,
  LabOrderCost,
  LabOrderEvent,
  LabOrderItem,
  LabOrderItemPrice,
  LabOrderRemake,
  LabPayment,
  LabPaymentAllocation,
  LabQualityReport,
  LabReconciliation,
  LabRemakeReason,
  LabTechnician,
  LabWorkType,
  LabWorkTypePrice,
} from "../../lab/types";
import type { Visit } from "../../schedule/types";
import type { AuditLogEntry, Deal, Doctor, Patient, Sale } from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const fail = (message: string, code = "22023") =>
  Object.assign(new Error(message), { code });

const REMAKE_AUDITED = [
  "reason_id",
  "reason",
  "fault",
  "is_warranty",
  "is_paid",
  "comment",
] as const;

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

/**
 * The lab module of stage 43 in the demo, the same rules as
 * supabase/schemas/43_lab_plus.sql: the price of the order's lab on the day
 * of the order, repriced with another lab; the history of an order; a
 * remake written with the status «Переделка» (under the warranty of a
 * delivered order), filled with its reason and fault (paid or free), back
 * ready with the order; the invitation of the patient when the work is
 * ready (a task on the deal, else a notification); the fitting visit; the
 * allocations of the lab payments; the reports «Качество» and «Акт
 * сверки»; rights (money for the owner and the head, never the integrator).
 */
export const createLabPlusDemo = ({
  baseDataProvider,
  getDataProvider,
  all,
  currentSalesId,
  logAudit,
  myRole,
  visiblePatientIds,
}: {
  baseDataProvider: DataProvider;
  /** The demo provider with the lifecycle callbacks */
  getDataProvider: () => DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
  myRole: () => Promise<string>;
  visiblePatientIds: () => Promise<Set<string>>;
}) => {
  const today = () => localDay();
  const seesMoney = async () => ["owner", "head"].includes(await myRole());
  const canWrite = async () =>
    ["owner", "head", "manager"].includes(await myRole());

  /** The orders the employee sees (their patients; never the integrator) */
  const visibleOrderIds = async () => {
    if ((await myRole()) === "integrator") return new Set<string>();
    const patients = await visiblePatientIds();
    return new Set(
      (await all<LabOrder>("lab_orders"))
        .filter((order) => patients.has(String(order.patient_id)))
        .map((order) => String(order.id)),
    );
  };

  /** Σ qty × price of the lines of an order (null: no line priced) */
  const lineCostOf = async () => {
    const [items, prices] = await Promise.all([
      all<LabOrderItem>("lab_order_items"),
      all<LabOrderItemPrice>("lab_order_item_prices"),
    ]);
    return (orderId: Identifier): number | null => {
      let sum: number | null = null;
      for (const item of items.filter((i) => same(i.order_id, orderId))) {
        const price = prices.find((p) => same(p.item_id, item.id));
        if (!price) continue;
        sum = (sum ?? 0) + item.qty * price.price;
      }
      return sum;
    };
  };

  /** The price of a line: the order's lab on the day of the order */
  const priceOfLine = async (order: LabOrder, workTypeId: Identifier | null) =>
    labPriceOn(
      await all<LabWorkTypePrice>("lab_work_type_prices"),
      workTypeId,
      order.lab_id,
      localDay(new Date(order.created_at)),
    );

  const warrantyMonths = async (orderId: Identifier) => {
    const [items, types] = await Promise.all([
      all<LabOrderItem>("lab_order_items"),
      all<LabWorkType>("lab_work_types"),
    ]);
    return Math.max(
      0,
      ...items
        .filter((i) => same(i.order_id, orderId))
        .map(
          (i) =>
            types.find((t) => same(t.id, i.work_type_id))?.warranty_months ?? 0,
        ),
    );
  };

  const addEvent = async (event: Omit<LabOrderEvent, "id" | "created_at">) =>
    baseDataProvider.create("lab_order_events", {
      data: {
        ...event,
        sales_id: event.sales_id ?? (await currentSalesId()) ?? null,
        created_at: new Date().toISOString(),
      },
    });

  /** The fitting visit: a visit of the same patient; its day as fitting 1 */
  const checkFittingVisit = async (
    before: LabOrder | null,
    data: Partial<LabOrder>,
  ): Promise<Partial<LabOrder>> => {
    const visitId = data.fitting_visit_id;
    if (visitId == null || same(visitId, before?.fitting_visit_id)) return {};
    const patientId = data.patient_id ?? before?.patient_id;
    const visit = (await all<Visit>("visits")).find((v) => same(v.id, visitId));
    if (!visit || !same(visit.patient_id, patientId)) {
      throw fail("Запись другого пациента");
    }
    const fitting = data.fitting1_at ?? before?.fitting1_at ?? null;
    return fitting ? {} : { fitting1_at: localDay(new Date(visit.starts_at)) };
  };

  /**
   * After an order is written (private.handle_lab_order_after_write): the
   * history, the remake, the day a remake came back, the invitation; and
   * the prices of another lab (private.handle_lab_order_lab_changed)
   */
  const afterOrderWrite = async (before: LabOrder | null, after: LabOrder) => {
    const me = (await currentSalesId()) ?? null;
    const day = today();
    if (!before) {
      await addEvent({
        order_id: after.id,
        kind: "created",
        to_status: after.status,
        sales_id: me,
      });
    } else if (before.status !== after.status) {
      await addEvent({
        order_id: after.id,
        kind: after.status === "remake" ? "remake" : "status",
        from_status: before.status,
        to_status: after.status,
        sales_id: me,
      });
    }
    if (
      after.fitting_visit_id != null &&
      !same(after.fitting_visit_id, before?.fitting_visit_id)
    ) {
      const visit = (await all<Visit>("visits")).find((v) =>
        same(v.id, after.fitting_visit_id),
      );
      const at = visit ? new Date(visit.starts_at) : null;
      await addEvent({
        order_id: after.id,
        kind: "fitting_visit",
        note: at
          ? `${at.toLocaleDateString("ru-RU")} ${at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
          : null,
        sales_id: me,
      });
    }
    // A remake: under the warranty when delivered within it
    if (after.status === "remake" && before?.status !== "remake") {
      const months = await warrantyMonths(after.id);
      const isWarranty = inWarranty(after.first_delivered_at, months, day);
      await baseDataProvider.create("lab_order_remakes", {
        data: {
          order_id: after.id,
          reason_id: null,
          reason: null,
          fault: null,
          is_warranty: isWarranty,
          is_paid: remakeIsPaid(null, isWarranty),
          comment: null,
          from_status: before?.status ?? null,
          occurred_on: day,
          ready_at: null,
          created_by: me,
          created_at: new Date().toISOString(),
        } satisfies Omit<LabOrderRemake, "id">,
      });
    }
    // The day a remade work came back follows the ready day of the order
    const remakes = (await all<LabOrderRemake>("lab_order_remakes")).filter(
      (r) => same(r.order_id, after.id),
    );
    for (const remake of remakes) {
      let readyAt = remake.ready_at ?? null;
      if (
        before?.ready_at &&
        after.ready_at !== before.ready_at &&
        after.status !== "remake" &&
        readyAt === before.ready_at
      ) {
        readyAt = after.ready_at ?? null;
      }
      if (after.ready_at && readyAt == null) readyAt = after.ready_at;
      if (readyAt !== (remake.ready_at ?? null)) {
        await baseDataProvider.update("lab_order_remakes", {
          id: remake.id,
          data: { ready_at: readyAt },
          previousData: remake,
        });
      }
    }
    // Another lab: the lines take its price
    if (before && !same(before.lab_id, after.lab_id)) {
      const items = (await all<LabOrderItem>("lab_order_items")).filter((i) =>
        same(i.order_id, after.id),
      );
      const prices = await all<LabOrderItemPrice>("lab_order_item_prices");
      for (const item of items) {
        if (item.work_type_id == null) continue;
        const price = prices.find((p) => same(p.item_id, item.id));
        if (!price) continue;
        await baseDataProvider.update("lab_order_item_prices", {
          id: price.id,
          data: {
            price: await priceOfLine(after, item.work_type_id),
            updated_at: new Date().toISOString(),
          },
          previousData: price,
        });
      }
    }
    // «Готово»: invite the patient once per ready cycle
    if (
      after.status === "ready" &&
      before?.status !== "ready" &&
      before?.status !== "delivered"
    ) {
      const events = (await all<LabOrderEvent>("lab_order_events")).filter(
        (e) => same(e.order_id, after.id),
      );
      const lastRemake = Math.max(
        0,
        ...events.filter((e) => e.kind === "remake").map((e) => Number(e.id)),
      );
      if (
        !events.some((e) => e.kind === "invite" && Number(e.id) > lastRemake)
      ) {
        await invite(after, me);
      }
    }
  };

  const invite = async (order: LabOrder, me: Identifier | null) => {
    await addEvent({
      order_id: order.id,
      kind: "invite",
      to_status: order.status,
      sales_id: me,
    });
    const [sales, labs, patients, deals] = await Promise.all([
      all<Sale>("sales"),
      all<Lab>("labs"),
      all<Patient>("patients"),
      all<Deal>("deals"),
    ]);
    const lab = labs.find((l) => same(l.id, order.lab_id));
    const responsible = sales.find(
      (s) => same(s.id, order.responsible_id) && !s.disabled,
    );
    const now = new Date().toISOString();
    const deal = deals.find((d) => same(d.id, order.deal_id));
    if (deal) {
      await baseDataProvider.create("tasks", {
        data: {
          deal_id: deal.id,
          type: "call",
          text: `Пригласить пациента на примерку/сдачу: наряд №${order.number}${lab ? ` · ${lab.name}` : ""}`,
          due_date: now,
          sales_id: responsible?.id ?? deal.sales_id ?? null,
          created_at: now,
          branch_id: deal.branch_id ?? null,
        },
      });
      return;
    }
    const patient = patients.find((p) => same(p.id, order.patient_id));
    const recipients = responsible
      ? [responsible.id]
      : sales
          .filter((s) => ["owner", "head"].includes(s.role) && !s.disabled)
          .map((s) => s.id);
    for (const recipient of recipients) {
      await baseDataProvider.create("notifications", {
        data: {
          sales_id: recipient,
          kind: "lab_order",
          title: "Работа готова: пригласите пациента на примерку/сдачу",
          body: `Наряд №${order.number} · ${[patient?.last_name, patient?.first_name].filter(Boolean).join(" ") || "Пациент"}${lab ? ` · ${lab.name}` : ""}`,
          deal_id: null,
          patient_id: order.patient_id,
          message_count: 1,
          created_at: now,
          updated_at: now,
          read_at: null,
        },
      });
    }
  };

  const previous = new Map<string, any>();

  /** The remake: reason name, default paid, money flags for the seniors */
  const fillRemake = async (
    before: LabOrderRemake,
    data: Partial<LabOrderRemake>,
  ): Promise<Partial<LabOrderRemake>> => {
    const next = { ...before, ...data };
    const out: Partial<LabOrderRemake> = {};
    for (const key of [
      "reason_id",
      "reason",
      "fault",
      "comment",
      "is_paid",
      "is_warranty",
    ] as const) {
      if (key in data) (out as any)[key] = data[key];
    }
    if (
      next.fault != null &&
      !["lab", "clinic", "patient"].includes(next.fault)
    ) {
      throw fail("Неизвестная сторона", "23514");
    }
    out.reason =
      typeof next.reason === "string" ? next.reason.trim() || null : null;
    out.comment =
      typeof next.comment === "string" ? next.comment.trim() || null : null;
    if (next.reason_id != null && !same(next.reason_id, before.reason_id)) {
      out.reason =
        (await all<LabRemakeReason>("lab_remake_reasons")).find((r) =>
          same(r.id, next.reason_id),
        )?.name ?? out.reason;
    }
    const paidChanged =
      "is_paid" in data && !!data.is_paid !== !!before.is_paid;
    const warrantyChanged =
      "is_warranty" in data && !!data.is_warranty !== !!before.is_warranty;
    if ((paidChanged || warrantyChanged) && !(await seesMoney())) {
      throw fail(
        "Оплату переделки и гарантию меняют владелец и руководитель",
        "42501",
      );
    }
    const isWarranty = !!(next.is_warranty ?? before.is_warranty);
    if (
      !paidChanged &&
      ((next.fault ?? null) !== (before.fault ?? null) || warrantyChanged)
    ) {
      out.is_paid = remakeIsPaid(next.fault ?? null, isWarranty);
    }
    return out;
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "lab_order_remakes",
      afterGetList: async (result: GetListResult) => {
        const visible = await visibleOrderIds();
        const data = result.data.filter((row) =>
          visible.has(String(row.order_id)),
        );
        return { ...result, data, total: data.length };
      },
      beforeCreate: async () => {
        throw fail("Переделку записывает наряд", "42501");
      },
      beforeDelete: async () => {
        throw fail("Переделки не удаляются", "42501");
      },
      beforeUpdate: async (params: any) => {
        const before = (await all<LabOrderRemake>("lab_order_remakes")).find(
          (r) => same(r.id, params.id),
        );
        if (!before) throw fail("Переделка не найдена", "P0002");
        if (
          !(await canWrite()) ||
          !(await visibleOrderIds()).has(String(before.order_id))
        ) {
          throw fail("Нет права менять заказ-наряды", "42501");
        }
        previous.set(`lab_order_remakes:${params.id}`, before);
        return { ...params, data: await fillRemake(before, params.data) };
      },
      afterUpdate: async (result: any) => {
        const before = previous.get(`lab_order_remakes:${result.data.id}`);
        previous.delete(`lab_order_remakes:${result.data.id}`);
        const changes = diff(before, result.data, REMAKE_AUDITED);
        if (Object.keys(changes).length) {
          const order = (await all<LabOrder>("lab_orders")).find((o) =>
            same(o.id, result.data.order_id),
          );
          await logAudit({
            entity: "lab_order_remake",
            entity_id: result.data.id,
            action: "update",
            changes: changes as AuditLogEntry["changes"],
            patient_id: order?.patient_id ?? null,
            deal_id: order?.deal_id ?? null,
          });
        }
        return result;
      },
    },
    {
      resource: "lab_order_events",
      afterGetList: async (result: GetListResult) => {
        const visible = await visibleOrderIds();
        const data = result.data.filter((row) =>
          visible.has(String(row.order_id)),
        );
        return { ...result, data, total: data.length };
      },
      beforeCreate: async () => {
        throw fail("Историю пишет наряд", "42501");
      },
      beforeUpdate: async () => {
        throw fail("Историю пишет наряд", "42501");
      },
      beforeDelete: async () => {
        throw fail("Историю пишет наряд", "42501");
      },
    },
    {
      resource: "lab_payment_allocations",
      afterGetList: async (result: GetListResult) =>
        (await seesMoney()) ? result : { ...result, data: [], total: 0 },
      beforeCreate: async (params: any) => {
        await checkAllocation(null, params.data);
        return {
          ...params,
          data: {
            payment_id: params.data.payment_id,
            order_id: params.data.order_id,
            amount: Math.round(Number(params.data.amount)),
            created_at: new Date().toISOString(),
          },
        };
      },
      afterCreate: async (result: any) => {
        await logAudit({
          entity: "lab_payment_allocation",
          entity_id: result.data.id,
          action: "create",
          changes: diff(null, result.data, [
            "payment_id",
            "order_id",
            "amount",
          ]) as AuditLogEntry["changes"],
        });
        return result;
      },
      beforeUpdate: async (params: any) => {
        const before = (
          await all<LabPaymentAllocation>("lab_payment_allocations")
        ).find((a) => same(a.id, params.id));
        if (!before) throw fail("Не найдено", "P0002");
        await checkAllocation(before, params.data);
        return {
          ...params,
          data: { amount: Math.round(Number(params.data.amount)) },
        };
      },
      beforeDelete: async (params: any) => {
        if (!(await seesMoney())) {
          throw fail(
            "Оплаты лабораторий распределяют владелец и руководитель",
            "42501",
          );
        }
        return params;
      },
    },
  ];

  const checkAllocation = async (
    before: LabPaymentAllocation | null,
    data: Partial<LabPaymentAllocation>,
  ) => {
    if (!(await seesMoney())) {
      throw fail(
        "Оплаты лабораторий распределяют владелец и руководитель",
        "42501",
      );
    }
    const paymentId = before?.payment_id ?? data.payment_id;
    const orderId = before?.order_id ?? data.order_id;
    const [payments, orders, allocations, costs] = await Promise.all([
      all<LabPayment>("lab_payments"),
      all<LabOrder>("lab_orders"),
      all<LabPaymentAllocation>("lab_payment_allocations"),
      costRows(),
    ]);
    const payment = payments.find((p) => same(p.id, paymentId));
    const order = orders.find((o) => same(o.id, orderId));
    const others = allocations.filter((a) => !same(a.id, before?.id));
    const error = allocationError({
      paymentLabId: payment?.lab_id,
      paymentAmount: payment?.amount ?? 0,
      orderLabId: order?.lab_id,
      amount: Math.round(Number(data.amount)),
      allocatedOfPayment: others
        .filter((a) => same(a.payment_id, paymentId))
        .reduce((sum, a) => sum + a.amount, 0),
      allocatedOfOrder: others
        .filter((a) => same(a.order_id, orderId))
        .reduce((sum, a) => sum + a.amount, 0),
      orderCost: costs
        .filter((c) => same(c.order_id, orderId))
        .reduce((sum, c) => sum + c.amount, 0),
    });
    const messages: Record<string, string> = {
      lab_allocation_lab: "Наряд другой лаборатории",
      lab_allocation_amount: "Сумма должна быть больше нуля",
      lab_allocation_over_payment:
        "По нарядам распределено больше суммы оплаты",
      lab_allocation_over_order: "Оплата наряда больше его стоимости",
    };
    if (error) throw fail(messages[error]);
  };

  /**
   * The work rows of lab_order_costs (every line with its price) and the
   * paid remakes — whatever the role: the callers check the money right
   */
  const costRows = async (): Promise<LabOrderCost[]> => {
    const [orders, items, prices, remakes] = await Promise.all([
      all<LabOrder>("lab_orders"),
      all<LabOrderItem>("lab_order_items"),
      all<LabOrderItemPrice>("lab_order_item_prices"),
      all<LabOrderRemake>("lab_order_remakes"),
    ]);
    const work = items.flatMap((item): LabOrderCost[] => {
      const order = orders.find((o) => same(o.id, item.order_id));
      const price = prices.find((p) => same(p.item_id, item.id));
      if (!order || !price) return [];
      const billed = order.first_ready_at ?? null;
      return [
        {
          id: item.id,
          order_id: order.id,
          order_number: order.number,
          patient_id: order.patient_id,
          doctor_id: order.doctor_id ?? null,
          lab_id: order.lab_id ?? null,
          technician_id: order.technician_id ?? null,
          branch_id: order.branch_id ?? null,
          plan_id: order.plan_id ?? null,
          plan_item_id: item.plan_item_id ?? null,
          work_type_id: item.work_type_id ?? null,
          name: item.name,
          qty: item.qty,
          price: price.price,
          amount: item.qty * price.price,
          status: order.status,
          ready_at: order.ready_at ?? null,
          month: billed ? `${billed.slice(0, 7)}-01` : null,
          kind: "work",
          remake_id: null,
          billed_on: billed,
        },
      ];
    });
    const lineCost = (orderId: Identifier) => {
      let sum: number | null = null;
      for (const row of work.filter((w) => same(w.order_id, orderId))) {
        sum = (sum ?? 0) + row.amount;
      }
      return sum;
    };
    return [...work, ...remakeCosts(remakes, orders, lineCost)];
  };

  /** The extra columns of lab_orders_summary (stage 43) */
  const summaryExtras = async () => {
    const [remakes, allocations, items, types, visits] = await Promise.all([
      all<LabOrderRemake>("lab_order_remakes"),
      all<LabPaymentAllocation>("lab_payment_allocations"),
      all<LabOrderItem>("lab_order_items"),
      all<LabWorkType>("lab_work_types"),
      all<Visit>("visits"),
    ]);
    return (order: LabOrder, labCost: number | null) => {
      const own = remakes
        .filter((r) => same(r.order_id, order.id))
        .sort((a, b) => Number(a.id) - Number(b.id));
      const last = own[own.length - 1];
      const paid = own.filter((r) => r.is_paid).length;
      const months = Math.max(
        0,
        ...items
          .filter((i) => same(i.order_id, order.id))
          .map(
            (i) =>
              types.find((t) => same(t.id, i.work_type_id))?.warranty_months ??
              0,
          ),
      );
      const allocated = allocations
        .filter((a) => same(a.order_id, order.id))
        .reduce((sum, a) => sum + a.amount, 0);
      return {
        fitting_visit_at:
          visits.find((v) => same(v.id, order.fitting_visit_id))?.starts_at ??
          null,
        warranty_months: months,
        warranty_until: warrantyUntil(order.first_delivered_at, months),
        last_remake_reason: last?.reason ?? null,
        last_remake_fault: last?.fault ?? null,
        last_remake_warranty: last ? last.is_warranty : null,
        remakes_cost: labCost == null ? null : labCost * paid,
        due_amount: labCost == null ? null : labCost * (1 + paid) - allocated,
      };
    };
  };

  /** public.lab_order_balances (owner, head) */
  const balancesView = async () => {
    if (!(await seesMoney())) return [];
    const [orders, patients, allocations, costs] = await Promise.all([
      all<LabOrder>("lab_orders"),
      all<Patient>("patients"),
      all<LabPaymentAllocation>("lab_payment_allocations"),
      costRows(),
    ]);
    const balances = orderBalances(costs, allocations);
    return orders.flatMap((order) => {
      const balance = balances.get(String(order.id));
      if (!balance) return [];
      const patient = patients.find((p) => same(p.id, order.patient_id));
      return [
        {
          id: order.id,
          number: order.number,
          lab_id: order.lab_id ?? null,
          patient_id: order.patient_id,
          status: order.status,
          billed_on: order.first_ready_at ?? null,
          patient_name:
            [patient?.last_name, patient?.first_name, patient?.middle_name]
              .filter(Boolean)
              .join(" ") || null,
          ...balance,
        },
      ];
    });
  };

  const methods = {
    /** «Переделка» with its reason and fault (public.lab_order_remake) */
    async labOrderRemake(input: {
      order_id: Identifier;
      reason_id?: Identifier | null;
      reason?: string | null;
      fault?: LabFault | null;
      comment?: string | null;
    }): Promise<Identifier> {
      if (!(await canWrite())) {
        throw fail("Нет права менять заказ-наряды", "42501");
      }
      if (!(await visibleOrderIds()).has(String(input.order_id))) {
        throw fail("Наряд не найден", "P0002");
      }
      const order = (await all<LabOrder>("lab_orders")).find((o) =>
        same(o.id, input.order_id),
      );
      if (order && order.status !== "remake") {
        // Through the lifecycle of lab_orders (the demo provider)
        await getDataProvider().update("lab_orders", {
          id: order.id,
          data: { status: "remake" },
          previousData: order,
        });
      }
      const remake = (await all<LabOrderRemake>("lab_order_remakes"))
        .filter((r) => same(r.order_id, input.order_id))
        .sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!remake) throw fail("Наряд не найден", "P0002");
      await getDataProvider().update("lab_order_remakes", {
        id: remake.id,
        data: {
          reason_id: input.reason_id ?? null,
          reason:
            input.reason_id == null ? (input.reason ?? null) : remake.reason,
          fault: input.fault ?? null,
          comment: input.comment ?? null,
        },
        previousData: remake,
      });
      return remake.id;
    },
    /** «Качество» (public.report_lab_quality) */
    async getLabQualityReport(filters: {
      from: string;
      to: string;
      branch_id?: Identifier | null;
    }): Promise<LabQualityReport> {
      if (!(await seesMoney())) {
        throw fail(
          "Качество лабораторий видят владелец и руководитель",
          "42501",
        );
      }
      const [orders, remakes, labs, techs, doctors, costs] = await Promise.all([
        all<LabOrder>("lab_orders"),
        all<LabOrderRemake>("lab_order_remakes"),
        all<Lab>("labs"),
        all<LabTechnician>("lab_technicians"),
        all<Doctor>("doctors"),
        costRows(),
      ]);
      return labQuality({
        orders: orders.map((order) => ({
          ...order,
          created_on: localDay(new Date(order.created_at)),
        })),
        remakes,
        costs,
        from: filters.from,
        to: filters.to,
        today: today(),
        branchId: filters.branch_id ?? null,
        names: { labs, technicians: techs, doctors },
      });
    },
    /** «Акт сверки» (public.report_lab_reconciliation) */
    async getLabReconciliation(input: {
      lab_id: Identifier;
      from: string;
      to: string;
    }): Promise<LabReconciliation> {
      if (!(await seesMoney())) {
        throw fail("Акт сверки видят владелец и руководитель", "42501");
      }
      const [labs, orders, patients, payments, allocations, costs] =
        await Promise.all([
          all<Lab>("labs"),
          all<LabOrder>("lab_orders"),
          all<Patient>("patients"),
          all<LabPayment>("lab_payments"),
          all<LabPaymentAllocation>("lab_payment_allocations"),
          costRows(),
        ]);
      const lab = labs.find((l) => same(l.id, input.lab_id));
      if (!lab) throw fail("Лаборатория не найдена", "P0002");
      return labReconciliation({
        lab,
        costs,
        payments,
        allocations,
        orderNumbers: (id) =>
          orders.find((o) => same(o.id, id))?.number ?? null,
        patientNames: (id) => {
          const patient = patients.find((p) => same(p.id, id));
          return (
            [patient?.last_name, patient?.first_name]
              .filter(Boolean)
              .join(" ") || null
          );
        },
        from: input.from,
        to: input.to,
        paidDay: (paidAt) => localDay(new Date(paidAt)),
      });
    },
  };

  return {
    callbacks,
    methods,
    views: { lab_order_balances: balancesView } as Record<
      string,
      () => Promise<any[]>
    >,
    afterOrderWrite,
    checkFittingVisit,
    priceOfLine,
    costRows,
    lineCostOf,
    summaryExtras,
  };
};

export type LabPlusDemo = ReturnType<typeof createLabPlusDemo>;
