import type { Deal, Service } from "../../../types";
import { lineTotal, planTotals } from "../../../treatment/planMath";
import type {
  PlanStatus,
  TreatmentPlan,
  TreatmentPlanItem,
} from "../../../treatment/types";
import type { Db } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** The price list of the demo clinic: [code, name, category, price] */
export const DEMO_PRICE_LIST: [string, string, string, number][] = [
  ["D-01", "Консультация стоматолога", "Диагностика", 5000],
  ["D-02", "Консультация хирурга-имплантолога", "Диагностика", 7000],
  ["D-03", "Прицельный снимок", "Диагностика", 2500],
  ["D-04", "Ортопантомограмма (ОПТГ)", "Диагностика", 6000],
  ["D-05", "КТ одной челюсти", "Диагностика", 15000],
  ["D-06", "КТ обеих челюстей", "Диагностика", 22000],
  ["G-01", "Профессиональная гигиена (Air Flow + ультразвук)", "Гигиена", 25000],
  ["G-02", "Фторирование", "Гигиена", 5000],
  ["G-03", "Отбеливание ZOOM 4", "Гигиена", 90000],
  ["T-01", "Лечение кариеса (поверхностный)", "Терапия", 25000],
  ["T-02", "Лечение кариеса (средний)", "Терапия", 32000],
  ["T-03", "Лечение кариеса (глубокий)", "Терапия", 40000],
  ["T-04", "Лечение пульпита, одноканальный зуб", "Терапия", 45000],
  ["T-05", "Лечение пульпита, трёхканальный зуб", "Терапия", 75000],
  ["T-06", "Перелечивание канала", "Терапия", 30000],
  ["T-07", "Художественная реставрация", "Терапия", 45000],
  ["T-08", "Анестезия", "Терапия", 3000],
  ["S-01", "Удаление зуба простое", "Хирургия", 12000],
  ["S-02", "Удаление зуба сложное", "Хирургия", 25000],
  ["S-03", "Удаление зуба мудрости", "Хирургия", 35000],
  ["S-04", "Синус-лифтинг открытый", "Хирургия", 150000],
  ["S-05", "Костная пластика", "Хирургия", 120000],
  ["S-06", "Резекция верхушки корня", "Хирургия", 40000],
  ["I-01", "Имплант Osstem (Корея)", "Имплантация", 180000],
  ["I-02", "Имплант Straumann (Швейцария)", "Имплантация", 350000],
  ["I-03", "Формирователь десны", "Имплантация", 15000],
  ["I-04", "Абатмент индивидуальный", "Имплантация", 60000],
  ["I-05", "Хирургический шаблон", "Имплантация", 45000],
  ["O-01", "Коронка металлокерамическая", "Ортопедия", 60000],
  ["O-02", "Коронка циркониевая", "Ортопедия", 120000],
  ["O-03", "Коронка на имплант (цирконий)", "Ортопедия", 140000],
  ["O-04", "Винир керамический E.max", "Ортопедия", 150000],
  ["O-05", "Вкладка культевая", "Ортопедия", 25000],
  ["O-06", "Съёмный протез", "Ортопедия", 180000],
  ["O-07", "Временная коронка", "Ортопедия", 12000],
  ["R-01", "Брекет-система металлическая (одна челюсть)", "Ортодонтия", 350000],
  ["R-02", "Брекет-система керамическая (одна челюсть)", "Ортодонтия", 450000],
  ["R-03", "Элайнеры (курс)", "Ортодонтия", 1200000],
  ["R-04", "Коррекция брекет-системы", "Ортодонтия", 15000],
  ["R-05", "Ретейнер", "Ортодонтия", 35000],
  ["K-01", "Лечение молочного зуба", "Детская", 18000],
  ["K-02", "Герметизация фиссур", "Детская", 8000],
  ["K-03", "Удаление молочного зуба", "Детская", 8000],
];

/** The directions of the deals, with their category */
const DIRECTION_CATEGORIES: Record<string, string> = {
  Имплантация: "Имплантация",
  Ортодонтия: "Ортодонтия",
  Терапия: "Терапия",
  Гигиена: "Гигиена",
  Протезирование: "Ортопедия",
  Хирургия: "Хирургия",
  "Детская стоматология": "Детская",
};

/** [stage, code, tooth, quantity, discount %] */
type Line = [number, string, string | null, number, number?];

/** Plans by the direction of the deal: economy, then premium */
const TEMPLATES: Record<string, { economy: Line[]; premium: Line[] }> = {
  Имплантация: {
    economy: [
      [1, "D-05", null, 1],
      [1, "S-02", "36", 1],
      [2, "I-01", "36", 1],
      [3, "I-03", "36", 1],
      [3, "O-01", "36", 1],
    ],
    premium: [
      [1, "D-05", null, 1],
      [1, "S-02", "36", 1],
      [1, "I-05", null, 1],
      [2, "I-02", "36", 1],
      [3, "I-03", "36", 1],
      [3, "I-04", "36", 1],
      [3, "O-03", "36", 1],
    ],
  },
  Терапия: {
    economy: [
      [1, "G-01", null, 1],
      [2, "T-02", "16", 1],
      [2, "T-01", "25, 26", 2],
      [3, "T-04", "46", 1],
    ],
    premium: [
      [1, "G-01", null, 1],
      [2, "T-03", "16", 1],
      [2, "T-07", "25, 26", 2],
      [3, "T-05", "46", 1],
      [3, "O-02", "46", 1],
    ],
  },
  Протезирование: {
    economy: [
      [1, "D-04", null, 1],
      [1, "O-05", "11-13", 3],
      [2, "O-01", "11-13", 3],
    ],
    premium: [
      [1, "D-04", null, 1],
      [1, "O-07", "11-13", 3],
      [2, "O-02", "11-13", 3],
    ],
  },
  Хирургия: {
    economy: [
      [1, "D-04", null, 1],
      [1, "S-03", "38", 1],
      [1, "S-03", "48", 1],
    ],
    premium: [
      [1, "D-06", null, 1],
      [1, "S-05", "36", 1],
      [2, "S-04", "26", 1],
    ],
  },
  Гигиена: {
    economy: [
      [1, "G-01", null, 1],
      [1, "G-02", null, 1],
    ],
    premium: [
      [1, "G-01", null, 1],
      [2, "G-03", null, 1],
    ],
  },
  Ортодонтия: {
    economy: [
      [1, "D-04", null, 1],
      [2, "R-01", "верхняя челюсть", 1],
      [2, "R-01", "нижняя челюсть", 1],
      [3, "R-05", null, 2],
    ],
    premium: [
      [1, "D-06", null, 1],
      [2, "R-03", null, 1, 5],
      [3, "R-05", null, 2],
    ],
  },
  "Детская стоматология": {
    economy: [
      [1, "K-01", "54", 1],
      [1, "K-01", "65", 1],
      [2, "K-02", "36, 46", 2],
    ],
    premium: [
      [1, "K-01", "54", 1],
      [1, "K-01", "65", 1],
      [1, "K-01", "74", 1],
      [2, "K-02", "36, 46", 2],
      [2, "G-02", null, 1],
    ],
  },
};

const MEDICAL = [
  { allergies: "Лидокаин (сыпь)", chronic_diseases: null },
  { allergies: "Пенициллин", chronic_diseases: "Сахарный диабет 2 типа" },
  { allergies: null, chronic_diseases: "Гипертония, принимает эналаприл" },
  { allergies: "Латекс", chronic_diseases: null },
];

/**
 * The price list and treatment plans of the demo clinic (stage 29): about
 * forty priced services, and plans on the deals that reached a consultation
 * — presented variants, agreed plans (the deal amount is the plan total),
 * treatments in progress and finished ones. One deal has two variants.
 */
export const generateTreatmentPlans = (db: Db) => {
  // The directions of the deals get their category; the price list follows
  for (const service of db.services) {
    service.category = DIRECTION_CATEGORIES[service.name] ?? null;
    service.code = null;
  }
  const base = db.services.length;
  DEMO_PRICE_LIST.forEach(([code, name, category, price], index) => {
    db.services.push({
      id: base + index + 1,
      name,
      code,
      category,
      price,
      position: base + index,
      is_archived: false,
    });
  });
  const byCode = new Map(db.services.map((s) => [s.code ?? "", s]));
  for (const settings of db.organization_settings) {
    settings.max_discount_percent = 10;
  }

  db.treatment_plans = [];
  db.treatment_plan_items = [];
  const stageName = (deal: Deal) =>
    db.stages.find((s) => s.id === deal.stage_id)?.name;
  const serviceName = (deal: Deal) =>
    db.services.find((s) => s.id === deal.service_id)?.name ?? "Терапия";

  const addPlan = (
    deal: Deal,
    name: string,
    status: PlanStatus,
    lines: Line[],
    {
      isMain = false,
      discountPercent = 0,
      doneStages = 0,
    }: { isMain?: boolean; discountPercent?: number; doneStages?: number } = {},
  ) => {
    const created = new Date(new Date(deal.created_at).getTime() + DAY);
    const plan: TreatmentPlan = {
      id: db.treatment_plans.length + 1,
      deal_id: deal.id,
      patient_id: deal.patient_id,
      name,
      status,
      is_main: isMain,
      discount_percent: discountPercent,
      discount_amount: 0,
      note: null,
      doctor_id: deal.doctor_id ?? null,
      created_by: deal.sales_id ?? null,
      agreed_at: ["agreed", "in_progress", "completed"].includes(status)
        ? new Date(created.getTime() + DAY).toISOString()
        : null,
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
    };
    db.treatment_plans.push(plan);
    const positions = new Map<number, number>();
    const items = lines.flatMap(([stage, code, tooth, quantity, discount]) => {
      const service = byCode.get(code) as Service | undefined;
      if (!service) return [];
      const position = positions.get(stage) ?? 0;
      positions.set(stage, position + 1);
      const unit_price = service.price ?? 0;
      const item: TreatmentPlanItem = {
        id: db.treatment_plan_items.length + 1,
        plan_id: plan.id,
        stage_no: stage,
        service_id: service.id,
        name: service.name,
        tooth,
        quantity,
        unit_price,
        discount_percent: discount ?? 0,
        done: stage <= doneStages,
        done_at:
          stage <= doneStages
            ? new Date(created.getTime() + stage * 7 * DAY).toISOString()
            : null,
        position,
        line_total: lineTotal(quantity, unit_price, discount ?? 0),
        created_at: plan.created_at,
      };
      db.treatment_plan_items.push(item);
      return [item];
    });
    return { plan, total: planTotals(plan, items).total };
  };

  const candidates = db.deals
    .filter((deal) => deal.pipeline_id === 1 && !deal.archived_at)
    .sort((a, b) => Number(a.id) - Number(b.id));
  const pick = (stage: string, count: number) =>
    candidates.filter((deal) => stageName(deal) === stage).slice(0, count);

  const setAmount = (deal: Deal, total: number) => {
    // Payments were made against the old amount: never below them
    deal.plan_amount = Math.max(total, deal.paid_amount);
  };

  // Consultations: two variants shown to the patient on the first deal,
  // a draft on the next one
  pick("Пришёл на консультацию", 2).forEach((deal, index) => {
    const template = TEMPLATES[serviceName(deal)] ?? TEMPLATES.Терапия;
    if (index === 0) {
      addPlan(deal, "Вариант эконом", "presented", template.economy);
      addPlan(deal, "Вариант премиум", "presented", template.premium);
    } else {
      addPlan(deal, "План лечения", "draft", template.economy);
    }
  });
  // Agreed: the first deal chose the premium variant over the economy one
  pick("План согласован", 3).forEach((deal, index) => {
    const template = TEMPLATES[serviceName(deal)] ?? TEMPLATES.Терапия;
    if (index === 0) {
      addPlan(deal, "Вариант эконом", "declined", template.economy);
      const { total } = addPlan(deal, "Вариант премиум", "agreed", template.premium, {
        isMain: true,
        discountPercent: 5,
      });
      setAmount(deal, total);
    } else {
      const { total } = addPlan(deal, "План лечения", "agreed", template.economy, {
        isMain: true,
      });
      setAmount(deal, total);
    }
  });
  // In treatment: the first stage is done
  pick("В лечении", 3).forEach((deal) => {
    const template = TEMPLATES[serviceName(deal)] ?? TEMPLATES.Терапия;
    const { total } = addPlan(deal, "План лечения", "in_progress", template.economy, {
      isMain: true,
      doneStages: 1,
    });
    setAmount(deal, total);
  });
  // Finished treatments
  candidates
    .filter((deal) => stageName(deal) === "Лечение завершено")
    .slice(0, 2)
    .forEach((deal) => {
      const template = TEMPLATES[serviceName(deal)] ?? TEMPLATES.Терапия;
      const { total } = addPlan(deal, "План лечения", "completed", template.economy, {
        isMain: true,
        doneStages: 9,
      });
      setAmount(deal, total);
    });

  // The light patient card: a few patients with medical notes and a doctor
  const withPlans = new Set(db.treatment_plans.map((plan) => plan.patient_id));
  db.patients
    .filter((patient) => withPlans.has(patient.id))
    .slice(0, MEDICAL.length)
    .forEach((patient, index) => {
      Object.assign(patient, MEDICAL[index], {
        contraindications:
          index === 1 ? "НПВС противопоказаны (язва желудка)" : null,
        preferred_doctor_id: db.doctors[index % db.doctors.length]?.id ?? null,
      });
    });
};
