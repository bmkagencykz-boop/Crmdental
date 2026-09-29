import type { Identifier } from "ra-core";

import { DEFAULT_TIME_ZONE } from "../../commons/automessages";
import {
  addDays,
  dueReminders,
  localDay,
  VITA_SHADES,
} from "../../../lab/labMath";
import { labPriceOn, remakeIsPaid } from "../../../lab/labPlusMath";
import type {
  Lab,
  LabFault,
  LabOrder,
  LabOrderEvent,
  LabOrderItem,
  LabOrderItemPrice,
  LabOrderRemake,
  LabStatus,
  LabTechnician,
  LabWorkType,
  LabWorkTypePrice,
} from "../../../lab/types";
import { zonedMoment } from "../../../tasks/calendarLayout";
import type { Db } from "./types";

/** The work types of a new clinic and their lab prices (seed_lab_work_types) */
export const LAB_WORK_TYPES: Array<[string, number]> = [
  ["Коронка металлокерамическая", 18000],
  ["Коронка из диоксида циркония", 35000],
  ["Коронка E.max", 40000],
  ["Коронка на имплант", 45000],
  ["Временная коронка", 5000],
  ["Винир керамический", 38000],
  ["Культевая вкладка", 8000],
  ["Бюгельный протез", 60000],
  ["Частичный съёмный протез", 45000],
  ["Полный съёмный протез", 55000],
  ["Каппа (сплинт)", 15000],
  ["Индивидуальная ложка", 4000],
  ["Хирургический шаблон", 25000],
];

/**
 * Standard terms (working days to the fitting, to the ready work) and the
 * warranty in months of the seeded work types (seed_lab_work_types)
 */
export const LAB_WORK_TYPE_TERMS: Record<
  string,
  [number | null, number, number]
> = {
  "Коронка металлокерамическая": [3, 7, 12],
  "Коронка из диоксида циркония": [4, 8, 24],
  "Коронка E.max": [4, 8, 24],
  "Коронка на имплант": [5, 10, 24],
  "Временная коронка": [null, 2, 0],
  "Винир керамический": [5, 10, 24],
  "Культевая вкладка": [null, 3, 12],
  "Бюгельный протез": [5, 14, 12],
  "Частичный съёмный протез": [5, 10, 12],
  "Полный съёмный протез": [5, 12, 12],
  "Каппа (сплинт)": [null, 5, 6],
  "Индивидуальная ложка": [null, 2, 0],
  "Хирургический шаблон": [null, 4, 0],
};

/** The reasons of a remake of a new clinic (seed_lab_remake_reasons) */
export const LAB_REMAKE_REASONS = [
  "Не подошёл цвет",
  "Не сел",
  "Скол",
  "Ошибка оттиска",
];

/** The demo user (the owner) */
const DEMO_SALES_ID = 0;

/** A remake of a demo order: days relative to today */
type RemakeSpec = {
  reason: string;
  fault: LabFault | null;
  on: number;
  from: LabStatus;
  /** Came back ready */
  ready?: number;
  warranty?: boolean;
  comment?: string;
};

type Spec = {
  status: LabStatus;
  created: number;
  sent?: number;
  f1?: number;
  f2?: number;
  due?: number;
  ready?: number;
  delivered?: number;
  works: Array<[string, number]>;
  tech: number;
  remakes?: number;
  teeth?: number[];
  /** Linked to a crown-like item of a treatment plan */
  plan?: boolean;
  comment?: string;
  /** Stage 43: the first ready and delivered days (a remake after them) */
  firstReady?: number;
  firstDelivered?: number;
  remakeLog?: RemakeSpec[];
};

/**
 * ~15 orders in every state, days relative to today: in the clinic (one
 * waiting for the courier), with the courier, in the lab (a fitting
 * tomorrow, one today, two overdue: «2 дня» and a remake), at a fitting,
 * ready, given this month and last month. Two labs (an external one with
 * two technicians, the clinic's own), prices of the lines, reminders of
 * today in the owner's bell, a scan and a shade photo on an order.
 */
const SPECS: Spec[] = [
  {
    status: "clinic",
    created: -1,
    due: 12,
    works: [["Коронка из диоксида циркония", 1]],
    tech: 1,
    plan: true,
  },
  {
    status: "clinic",
    created: 0,
    due: 10,
    works: [["Временная коронка", 2]],
    tech: 2,
    teeth: [11, 21],
  },
  {
    status: "courier",
    created: -2,
    sent: -1,
    f1: 4,
    due: 8,
    works: [
      ["Культевая вкладка", 1],
      ["Коронка металлокерамическая", 1],
    ],
    tech: 1,
    plan: true,
  },
  {
    status: "lab",
    created: -6,
    sent: -5,
    f1: 1,
    due: 6,
    works: [["Коронка металлокерамическая", 3]],
    tech: 1,
    plan: true,
    comment: "Контакт с соседними зубами плотный",
  },
  {
    status: "lab",
    created: -9,
    sent: -8,
    f1: -3,
    f2: 0,
    due: 3,
    works: [["Коронка на имплант", 2]],
    tech: 2,
    plan: true,
  },
  {
    status: "lab",
    created: -20,
    sent: -19,
    f1: -12,
    due: -2,
    works: [["Временная коронка", 4]],
    tech: 2,
    teeth: [12, 11, 21, 22],
    comment: "Временные коронки на период приживления",
  },
  {
    status: "fitting",
    created: -10,
    sent: -9,
    f1: 0,
    due: 5,
    works: [["Винир керамический", 6]],
    tech: 1,
    teeth: [13, 12, 11, 21, 22, 23],
  },
  {
    status: "remake",
    created: -25,
    sent: -24,
    f1: -15,
    due: -4,
    works: [["Коронка E.max", 1]],
    tech: 1,
    remakes: 1,
    teeth: [21],
    comment: "Переделка: не совпал цвет с соседним зубом",
    remakeLog: [
      {
        reason: "Не подошёл цвет",
        fault: "lab",
        on: -5,
        from: "fitting",
        comment: "Светлее соседнего 11 на полтона",
      },
    ],
  },
  // A crown remade under the warranty: delivered months ago, chipped now
  {
    status: "lab",
    created: -130,
    sent: -129,
    f1: -124,
    due: 4,
    works: [["Коронка из диоксида циркония", 1]],
    tech: 2,
    remakes: 1,
    teeth: [46],
    firstReady: -120,
    firstDelivered: -118,
    remakeLog: [
      {
        reason: "Скол",
        fault: null,
        on: -3,
        from: "delivered",
        warranty: true,
        comment: "Скол режущего края, гарантия 24 мес.",
      },
    ],
  },
  // The clinic's impression was wrong: a paid remake, delivered since
  {
    status: "delivered",
    created: -26,
    sent: -25,
    f1: -19,
    due: -12,
    ready: -9,
    delivered: -7,
    works: [["Коронка металлокерамическая", 2]],
    tech: 1,
    remakes: 1,
    teeth: [35, 36],
    remakeLog: [
      {
        reason: "Ошибка оттиска",
        fault: "clinic",
        on: -18,
        from: "fitting",
        ready: -9,
        comment: "Оттиск с порами, сняли повторно",
      },
    ],
  },
  {
    status: "lab",
    created: -4,
    sent: -4,
    due: 2,
    works: [["Каппа (сплинт)", 1]],
    tech: 3,
    teeth: [],
  },
  {
    status: "lab",
    created: -3,
    sent: -2,
    f1: 3,
    due: 9,
    works: [["Коронка из диоксида циркония", 2]],
    tech: 2,
    plan: true,
  },
  {
    status: "ready",
    created: -14,
    sent: -13,
    f1: -6,
    due: -1,
    ready: -1,
    works: [["Бюгельный протез", 1]],
    tech: 1,
  },
  {
    status: "ready",
    created: -12,
    sent: -11,
    due: 0,
    ready: 0,
    works: [["Индивидуальная ложка", 2]],
    tech: 3,
  },
  {
    status: "delivered",
    created: -30,
    sent: -29,
    f1: -20,
    f2: -15,
    due: -9,
    ready: -10,
    delivered: -8,
    works: [["Коронка на имплант", 2]],
    tech: 1,
    plan: true,
  },
  {
    status: "delivered",
    created: -18,
    sent: -17,
    f1: -9,
    due: -5,
    ready: -5,
    delivered: -3,
    works: [["Коронка металлокерамическая", 2]],
    tech: 2,
  },
  {
    status: "delivered",
    created: -50,
    sent: -49,
    f1: -40,
    due: -35,
    ready: -35,
    delivered: -33,
    works: [["Полный съёмный протез", 1]],
    tech: 3,
    teeth: [],
  },
  {
    status: "delivered",
    created: -45,
    sent: -44,
    due: -38,
    ready: -38,
    delivered: -36,
    works: [["Хирургический шаблон", 1]],
    tech: 1,
  },
];

/**
 * The history of the last three months for «Качество»: delivered orders of
 * both labs, most on time, some late, a few remade
 */
const HISTORY: Spec[] = Array.from({ length: 14 }, (_, index): Spec => {
  const created = -92 + index * 6;
  const term = [7, 8, 6, 10, 7, 9, 8, 12, 7, 6, 11, 8, 7, 9][index];
  const late = [0, 0, 1, 0, 0, 2, 0, 3, 0, 0, 0, 1, 0, 0][index];
  const works: Array<Array<[string, number]>> = [
    [["Коронка металлокерамическая", 1]],
    [["Коронка из диоксида циркония", 2]],
    [["Временная коронка", 3]],
    [["Коронка E.max", 1]],
    [
      ["Культевая вкладка", 1],
      ["Коронка металлокерамическая", 1],
    ],
    [["Бюгельный протез", 1]],
  ];
  const remade = index === 3 || index === 10;
  return {
    status: "delivered",
    created,
    sent: created + 1,
    f1: created + 4,
    due: created + 1 + term,
    ready: created + 1 + term + late,
    delivered: created + 3 + term + late,
    works: works[index % works.length],
    tech: [1, 2, 3, 1, 2, 1, 3, 2, 1, 2, 1, 3, 2, 1][index],
    remakes: remade ? 1 : 0,
    remakeLog: remade
      ? [
          {
            reason: index === 3 ? "Не сел" : "Не подошёл цвет",
            fault: index === 3 ? "lab" : "patient",
            on: created + 5,
            from: "fitting",
            ready: created + 1 + term + late,
          },
        ]
      : undefined,
  };
});

const MATERIALS: Record<string, string> = {
  "Коронка металлокерамическая": "Металлокерамика, КХС",
  "Коронка из диоксида циркония": "Диоксид циркония",
  "Коронка E.max": "Дисиликат лития E.max",
  "Коронка на имплант": "Цирконий на титановом основании",
  "Временная коронка": "PMMA",
  "Винир керамический": "E.max Press",
  "Бюгельный протез": "КХС, пластмасса",
};

export const generateLabOrders = (db: Db) => {
  const today = localDay();
  db.labs = [
    {
      id: 1,
      name: "Дентал-Арт",
      is_own: false,
      contact_person: "Ержан Касымов",
      phone: "+77017770011",
      email: "orders@dental-art.kz",
      address: "Алматы, ул. Жандосова, 58",
      is_active: true,
      position: 0,
      work_weekdays: [1, 2, 3, 4, 5, 6],
    },
    {
      id: 2,
      name: "Лаборатория клиники",
      is_own: true,
      contact_person: null,
      phone: null,
      address: "2 этаж, кабинет 12",
      is_active: true,
      position: 1,
      work_weekdays: [1, 2, 3, 4, 5],
    },
  ] satisfies Lab[];
  db.lab_technicians = [
    {
      id: 1,
      lab_id: 1,
      name: "Серик Абенов",
      phone: "+77015550101",
      is_active: true,
      position: 0,
    },
    {
      id: 2,
      lab_id: 1,
      name: "Марина Ли",
      phone: "+77015550102",
      is_active: true,
      position: 1,
    },
    {
      id: 3,
      lab_id: 2,
      name: "Олег Ким",
      phone: null,
      is_active: true,
      position: 2,
    },
  ] satisfies LabTechnician[];
  db.lab_work_types = LAB_WORK_TYPES.map(
    ([name], index): LabWorkType => ({
      id: index + 1,
      name,
      is_active: true,
      position: index,
      fitting_days: LAB_WORK_TYPE_TERMS[name]?.[0] ?? null,
      ready_days: LAB_WORK_TYPE_TERMS[name]?.[1] ?? null,
      warranty_months: LAB_WORK_TYPE_TERMS[name]?.[2] ?? 0,
    }),
  );
  // Prices (stage 43): the default ones — the crowns went up 40 days ago
  // (older orders keep the old price) — and the clinic's own lab, 20%
  // cheaper, from the start
  const raised = addDays(today, -40);
  db.lab_work_type_prices = [];
  const pricePush = (row: Omit<LabWorkTypePrice, "id">) =>
    db.lab_work_type_prices.push({
      id: db.lab_work_type_prices.length + 1,
      ...row,
    });
  LAB_WORK_TYPES.forEach(([name, price], index) => {
    const crown = /^Коронка/.test(name);
    pricePush({
      work_type_id: index + 1,
      lab_id: null,
      effective_from: "2000-01-01",
      price: crown ? Math.round((price * 0.9) / 500) * 500 : price,
    });
    if (crown) {
      pricePush({
        work_type_id: index + 1,
        lab_id: null,
        effective_from: raised,
        price,
      });
    }
    pricePush({
      work_type_id: index + 1,
      lab_id: 2,
      effective_from: "2000-01-01",
      price: Math.round((price * 0.8) / 100) * 100,
    });
  });
  // The own lab makes a temporary crown in a day and a metal-ceramic crown
  // in five
  db.lab_work_type_terms = [
    { id: 1, lab_id: 2, work_type_id: 5, fitting_days: null, ready_days: 1 },
    { id: 2, lab_id: 2, work_type_id: 1, fitting_days: 2, ready_days: 5 },
  ];
  db.lab_remake_reasons = [...LAB_REMAKE_REASONS, "Трещина"].map(
    (name, index) => ({
      id: index + 1,
      name,
      is_active: true,
      position: index,
    }),
  );
  db.lab_order_remakes = [];
  db.lab_order_events = [];
  db.lab_payment_allocations = [];

  // The doctors' administrators: the managers of the demo
  const managers = db.sales.filter((sale) => sale.role === "manager");
  db.doctors.forEach((doctor, index) => {
    doctor.admin_sales_id = managers.length
      ? managers[index % managers.length].id
      : null;
  });

  // Crown-like items of the treatment plans, one per plan
  const planItems = db.treatment_plan_items.filter((item) =>
    /коронк|винир|протез/i.test(item.name),
  );
  const seenPlans = new Set<string>();
  const linked = planItems.filter((item) => {
    const key = String(item.plan_id);
    if (seenPlans.has(key)) return false;
    seenPlans.add(key);
    return true;
  });
  const usedPatients = new Set<string>();
  const otherPatients = db.patients.filter((patient) =>
    db.deals.some((deal) => deal.patient_id === patient.id),
  );
  let nextPatient = 0;
  const freePatient = () => {
    while (nextPatient < otherPatients.length) {
      const patient = otherPatients[nextPatient++];
      if (!usedPatients.has(String(patient.id))) return patient.id;
    }
    return db.patients[0].id;
  };
  const orthopedist =
    db.doctors.find((d) => d.specialty === "ортопед") ?? db.doctors[0];

  /** The history of a demo order from its dates (lab_order_events) */
  const historyOf = (order: LabOrder, remakes: RemakeSpec[]) => {
    const who = order.responsible_id ?? DEMO_SALES_ID;
    const steps: Array<
      [string, LabOrderEvent["kind"], LabStatus | null, LabStatus]
    > = [];
    const created = localDay(new Date(order.created_at));
    steps.push([created, "created", null, "clinic"]);
    let status: LabStatus = "clinic";
    const move = (day: string | null | undefined, to: LabStatus) => {
      if (!day || status === to) return;
      steps.push([day, to === "remake" ? "remake" : "status", status, to]);
      status = to;
    };
    const firstReady = order.first_ready_at;
    move(order.sent_at, "lab");
    if (order.fitting1_at && order.fitting1_at <= today) {
      move(order.fitting1_at, "fitting");
    }
    const timeline = [
      ...remakes.map((r) => ({
        day: addDays(today, r.on),
        kind: "remake" as const,
        r,
      })),
      ...(firstReady ? [{ day: firstReady, kind: "ready" as const }] : []),
      ...(order.first_delivered_at
        ? [{ day: order.first_delivered_at, kind: "delivered" as const }]
        : []),
    ].sort((a, b) => a.day.localeCompare(b.day));
    for (const step of timeline) {
      if (step.kind === "remake") {
        move(step.day, "remake");
        move(step.day, "lab");
        if (step.r.ready) move(addDays(today, step.r.ready), "ready");
      } else if (step.kind === "ready") {
        move(step.day, "ready");
      } else {
        move(step.day, "delivered");
      }
    }
    if (order.ready_at) move(order.ready_at, "ready");
    if (order.delivered_at) move(order.delivered_at, "delivered");
    if (status !== order.status) move(today, order.status);
    steps.forEach(([day, kind, from, to], index) => {
      const at = new Date(`${day}T10:00:00`);
      at.setMinutes(index * 11);
      db.lab_order_events.push({
        id: db.lab_order_events.length + 1,
        order_id: order.id,
        kind,
        from_status: from,
        to_status: to,
        note: null,
        sales_id: who,
        created_at: at.toISOString(),
      });
      if (to === "ready") {
        db.lab_order_events.push({
          id: db.lab_order_events.length + 1,
          order_id: order.id,
          kind: "invite",
          from_status: null,
          to_status: "ready",
          note: null,
          sales_id: who,
          created_at: new Date(at.getTime() + 60_000).toISOString(),
        });
      }
    });
  };

  db.lab_orders = [];
  db.lab_order_items = [];
  db.lab_order_item_prices = [];
  let itemId = 1;
  [...SPECS, ...HISTORY].forEach((spec, index) => {
    const item = spec.plan ? linked.shift() : undefined;
    const plan = item
      ? db.treatment_plans.find((p) => p.id === item.plan_id)
      : undefined;
    const patientId: Identifier = plan?.patient_id ?? freePatient();
    usedPatients.add(String(patientId));
    const doctor =
      db.doctors.find((d) => d.id === plan?.doctor_id) ?? orthopedist;
    const teeth =
      spec.teeth ??
      (item?.tooth ? (item.tooth.match(/\d{2}/g) ?? []).map(Number) : [36]);
    const tech = db.lab_technicians.find((t) => t.id === spec.tech)!;
    const at = (offset?: number) =>
      offset == null ? null : addDays(today, offset);
    const created = new Date(`${addDays(today, spec.created)}T10:00:00`);
    created.setMinutes(index * 7);
    const order: LabOrder = {
      id: index + 1,
      number: index + 1,
      patient_id: patientId,
      deal_id: plan?.deal_id ?? null,
      plan_id: plan?.id ?? null,
      stage_id: item?.stage_id ?? null,
      doctor_id: doctor.id,
      lab_id: tech.lab_id,
      technician_id: tech.id,
      responsible_id: doctor.admin_sales_id ?? DEMO_SALES_ID,
      branch_id: null,
      teeth: [...teeth].sort((a, b) => a - b),
      shade: spec.works.some(([name]) => /коронк|винир/i.test(name))
        ? VITA_SHADES[(index * 3) % 8]
        : null,
      material: MATERIALS[spec.works[0][0]] ?? null,
      comment: spec.comment ?? null,
      status: spec.status,
      sent_at: at(spec.sent),
      fitting1_at: at(spec.f1),
      fitting2_at: at(spec.f2),
      due_at: at(spec.due),
      ready_at: at(spec.ready),
      delivered_at: at(spec.delivered),
      first_ready_at: at(spec.firstReady ?? spec.ready),
      first_delivered_at: at(spec.firstDelivered ?? spec.delivered),
      fitting_visit_id: null,
      remake_count: spec.remakes ?? 0,
      created_by: doctor.admin_sales_id ?? DEMO_SALES_ID,
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
    };
    db.lab_orders.push(order);
    spec.works.forEach(([name, qty], position) => {
      const typeIndex = LAB_WORK_TYPES.findIndex(([n]) => n === name);
      const line: LabOrderItem = {
        id: itemId,
        order_id: order.id,
        work_type_id: typeIndex + 1,
        name,
        qty,
        plan_item_id: position === 0 && item ? item.id : null,
        position,
        created_at: order.created_at,
      };
      db.lab_order_items.push(line);
      db.lab_order_item_prices.push({
        id: itemId,
        item_id: itemId,
        // The price of the order's lab on the day of the order
        price: labPriceOn(
          db.lab_work_type_prices,
          typeIndex + 1,
          tech.lab_id,
          localDay(created),
        ),
      } satisfies LabOrderItemPrice);
      itemId++;
    });
    // Stage 43: the remakes and the history of the order
    for (const remake of spec.remakeLog ?? []) {
      db.lab_order_remakes.push({
        id: db.lab_order_remakes.length + 1,
        order_id: order.id,
        reason_id:
          db.lab_remake_reasons.find((r) => r.name === remake.reason)?.id ??
          null,
        reason: remake.reason,
        fault: remake.fault,
        is_warranty: !!remake.warranty,
        is_paid: remakeIsPaid(remake.fault, !!remake.warranty),
        comment: remake.comment ?? null,
        from_status: remake.from,
        occurred_on: addDays(today, remake.on),
        ready_at: at(remake.ready),
        created_by: order.responsible_id ?? DEMO_SALES_ID,
        created_at: new Date(
          `${addDays(today, remake.on)}T15:20:00`,
        ).toISOString(),
      } satisfies LabOrderRemake);
    }
    historyOf(order, spec.remakeLog ?? []);
  });

  // A scan and a shade photo of the veneers (patient files of stage 37)
  const veneers = db.lab_orders.find((o) => o.status === "fitting");
  // Stage 43: the veneers' fitting is booked in the schedule today
  if (veneers) {
    const timeZone = db.organizations?.[0]?.timezone || DEFAULT_TIME_ZONE;
    const busy = (start: Date, end: Date) =>
      db.visits.some(
        (visit) =>
          String(visit.doctor_id) === String(veneers.doctor_id) &&
          visit.status !== "cancelled" &&
          new Date(visit.starts_at) < end &&
          new Date(visit.ends_at) > start,
      );
    for (let minute = 11 * 60; minute <= 18 * 60; minute += 30) {
      const start = zonedMoment(today, minute, timeZone);
      const end = new Date(start.getTime() + 30 * 60_000);
      if (busy(start, end)) continue;
      const visitId =
        Math.max(0, ...db.visits.map((v) => Number(v.id) || 0)) + 1;
      db.visits.push({
        id: visitId,
        patient_id: veneers.patient_id,
        deal_id: veneers.deal_id ?? null,
        doctor_id: veneers.doctor_id ?? null,
        chair_id: null,
        service_id: null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: "confirmed",
        note: `Примерка: наряд №${veneers.number}`,
        source: "crm",
        created_by: veneers.responsible_id ?? DEMO_SALES_ID,
        created_at: veneers.created_at,
        branch_id: null,
      });
      veneers.fitting_visit_id = visitId;
      db.lab_order_events.push({
        id: db.lab_order_events.length + 1,
        order_id: veneers.id,
        kind: "fitting_visit",
        note: `${start.toLocaleDateString("ru-RU")} ${start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`,
        sales_id: veneers.responsible_id ?? DEMO_SALES_ID,
        created_at: veneers.created_at,
      });
      break;
    }
  }
  if (veneers) {
    let fileId = Math.max(0, ...db.patient_files.map((f) => Number(f.id))) + 1;
    const svg = (label: string, color: string) =>
      `data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#f2f2f3"/><g fill="${color}">${[
          0, 1, 2, 3, 4, 5,
        ]
          .map(
            (i) =>
              `<rect x="${40 + i * 68}" y="90" width="56" height="120" rx="22"/>`,
          )
          .join(
            "",
          )}</g><text x="240" y="270" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#121214">${label}</text></svg>`,
      )}`;
    for (const [name, label, color] of [
      ["Фото цвета A2.svg", "Цвет A2 · VITA", "#efe3c8"],
      ["Скан 13-23.svg", "Интраоральный скан 13–23", "#d6d6db"],
    ] as const) {
      db.patient_files.push({
        id: fileId++,
        patient_id: veneers.patient_id,
        path: svg(label, color),
        name,
        size: 2400,
        mime: "image/svg+xml",
        kind: "photo",
        taken_at: veneers.sent_at ?? null,
        note: null,
        sales_id: veneers.created_by ?? null,
        created_at: veneers.created_at,
        lab_order_id: veneers.id,
      });
    }
  }

  // Today's reminders in the owner's bell (private.lab_orders_tick)
  let notificationId =
    Math.max(0, ...db.notifications.map((n) => Number(n.id))) + 1;
  const title = {
    fitting1: "Примерка 1",
    fitting2: "Примерка 2",
    due: "Сдача работы из лаборатории",
    overdue: "Наряд просрочен",
  };
  // At most four: the bell stays readable
  const reminders = db.lab_orders
    .flatMap((order) =>
      dueReminders(order, today).map((reminder) => ({ order, reminder })),
    )
    .slice(0, 4);
  for (const { order, reminder } of reminders) {
    const patient = db.patients.find((p) => p.id === order.patient_id);
    const lab = db.labs.find((l) => l.id === order.lab_id);
    const when =
      reminder.kind === "overdue"
        ? ""
        : reminder.day === today
          ? " сегодня"
          : " завтра";
    const at = new Date(Date.now() - (order.number % 5) * 60_000 * 37);
    db.notifications.push({
      id: notificationId++,
      sales_id: DEMO_SALES_ID,
      kind: "lab_order",
      title: `${title[reminder.kind]}${when}`,
      body: `Наряд №${order.number} · ${[patient?.last_name, patient?.first_name].filter(Boolean).join(" ")}${lab ? ` · ${lab.name}` : ""}`,
      deal_id: order.deal_id ?? null,
      patient_id: order.patient_id,
      message_count: 1,
      created_at: at.toISOString(),
      updated_at: at.toISOString(),
      read_at: null,
    });
  }
};
