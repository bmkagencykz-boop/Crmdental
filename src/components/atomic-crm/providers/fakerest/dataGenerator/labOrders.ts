import type { Identifier } from "ra-core";

import {
  addDays,
  dueReminders,
  localDay,
  VITA_SHADES,
} from "../../../lab/labMath";
import type {
  Lab,
  LabOrder,
  LabOrderItem,
  LabOrderItemPrice,
  LabStatus,
  LabTechnician,
  LabWorkType,
  LabWorkTypePrice,
} from "../../../lab/types";
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

/** The demo user (the owner) */
const DEMO_SALES_ID = 0;

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
    }),
  );
  db.lab_work_type_prices = LAB_WORK_TYPES.map(
    ([, price], index): LabWorkTypePrice => ({
      id: index + 1,
      work_type_id: index + 1,
      price,
    }),
  );

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

  db.lab_orders = [];
  db.lab_order_items = [];
  db.lab_order_item_prices = [];
  let itemId = 1;
  SPECS.forEach((spec, index) => {
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
        // The own lab works at cost: 20% cheaper
        price:
          Math.round(
            (LAB_WORK_TYPES[typeIndex][1] * (tech.lab_id === 2 ? 0.8 : 1)) /
              100,
          ) * 100,
      } satisfies LabOrderItemPrice);
      itemId++;
    });
  });

  // A scan and a shade photo of the veneers (patient files of stage 37)
  const veneers = db.lab_orders.find((o) => o.status === "fitting");
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
