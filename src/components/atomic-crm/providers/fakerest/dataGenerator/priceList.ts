import type {
  PriceHistoryRow,
  ServiceCategory,
} from "../../../price-list/types";
import type { ServiceUnit } from "../../../treatment/priceList";
import type { Db } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** [section, [subsection, code prefixes…][]]: the tree of the demo */
const TREE: [string, [string, string[]][]][] = [
  [
    "Диагностика",
    [
      ["Консультации", ["D-01", "D-02"]],
      ["Рентген и КТ", ["D-03", "D-04", "D-05", "D-06"]],
    ],
  ],
  [
    "Гигиена",
    [
      ["Профилактика", ["G-01", "G-02"]],
      ["Отбеливание", ["G-03"]],
    ],
  ],
  [
    "Терапия",
    [
      ["Лечение кариеса", ["T-01", "T-02", "T-03"]],
      ["Эндодонтия", ["T-04", "T-05", "T-06"]],
      ["Реставрация", ["T-07"]],
    ],
  ],
  [
    "Хирургия",
    [
      ["Удаление", ["S-01", "S-02", "S-03"]],
      ["Костная пластика", ["S-04", "S-05"]],
    ],
  ],
  [
    "Имплантация",
    [
      ["Импланты", ["I-01", "I-02"]],
      ["Компоненты", ["I-03", "I-04", "I-05"]],
    ],
  ],
  [
    "Ортопедия",
    [
      ["Коронки", ["O-01", "O-02", "O-03", "O-07"]],
      ["Виниры и вкладки", ["O-04", "O-05"]],
      ["Протезы", ["O-06"]],
    ],
  ],
  [
    "Ортодонтия",
    [
      ["Брекеты", ["R-01", "R-02", "R-04"]],
      ["Элайнеры", ["R-03"]],
      ["Ретенция", ["R-05"]],
    ],
  ],
  ["Детская", []],
];

/** code → unit, minutes, specialty */
const DETAILS: Record<string, [ServiceUnit, number | null, string]> = {
  "D-01": ["visit", 30, "Терапевт"],
  "D-02": ["visit", 30, "Имплантолог"],
  "D-03": ["tooth", 10, "Терапевт"],
  "D-04": ["service", 15, "Терапевт"],
  "D-05": ["jaw", 20, "Имплантолог"],
  "D-06": ["service", 20, "Имплантолог"],
  "G-01": ["visit", 60, "Гигиенист"],
  "G-02": ["visit", 15, "Гигиенист"],
  "G-03": ["visit", 90, "Гигиенист"],
  "T-01": ["tooth", 45, "Терапевт"],
  "T-02": ["tooth", 60, "Терапевт"],
  "T-03": ["tooth", 60, "Терапевт"],
  "T-04": ["tooth", 90, "Терапевт"],
  "T-05": ["tooth", 120, "Терапевт"],
  "T-06": ["tooth", 60, "Терапевт"],
  "T-07": ["tooth", 90, "Терапевт"],
  "T-08": ["service", 5, "Терапевт"],
  "S-01": ["tooth", 30, "Хирург"],
  "S-02": ["tooth", 45, "Хирург"],
  "S-03": ["tooth", 60, "Хирург"],
  "S-04": ["service", 120, "Имплантолог"],
  "S-05": ["service", 90, "Имплантолог"],
  "S-06": ["tooth", 60, "Хирург"],
  "I-01": ["tooth", 60, "Имплантолог"],
  "I-02": ["tooth", 60, "Имплантолог"],
  "I-03": ["tooth", 20, "Имплантолог"],
  "I-04": ["tooth", 30, "Ортопед"],
  "I-05": ["service", null, "Имплантолог"],
  "O-01": ["tooth", 60, "Ортопед"],
  "O-02": ["tooth", 60, "Ортопед"],
  "O-03": ["tooth", 60, "Ортопед"],
  "O-04": ["tooth", 60, "Ортопед"],
  "O-05": ["tooth", 30, "Ортопед"],
  "O-06": ["jaw", 60, "Ортопед"],
  "O-07": ["tooth", 30, "Ортопед"],
  "R-01": ["jaw", 90, "Ортодонт"],
  "R-02": ["jaw", 90, "Ортодонт"],
  "R-03": ["service", 60, "Ортодонт"],
  "R-04": ["visit", 30, "Ортодонт"],
  "R-05": ["jaw", 45, "Ортодонт"],
  "K-01": ["tooth", 45, "Детский стоматолог"],
  "K-02": ["tooth", 20, "Детский стоматолог"],
  "K-03": ["tooth", 20, "Детский стоматолог"],
};

/** Cost prices of some services (materials, lab, implant) */
const COSTS: Record<string, number> = {
  "G-01": 4500,
  "G-03": 28000,
  "T-01": 5500,
  "T-02": 7000,
  "T-03": 9000,
  "T-05": 16000,
  "T-07": 11000,
  "I-01": 72000,
  "I-02": 165000,
  "I-03": 6000,
  "I-04": 30000,
  "O-01": 22000,
  "O-02": 48000,
  "O-03": 60000,
  "O-04": 65000,
  "R-01": 120000,
  "R-03": 610000,
};

const MATERIALS: Record<string, string> = {
  "T-01": "Filtek Z550, адгезив Single Bond Universal",
  "T-07": "Estelite Asteria, коффердам",
  "T-05": "ProTaper Gold, гуттаперча, AH Plus",
  "G-03": "Philips ZOOM WhiteSpeed, гель 25 %",
  "I-01": "Osstem TS III SA, формирователь в комплекте",
  "O-02": "Диоксид циркония Katana, лаборатория «Дентал Арт»",
};

/**
 * The price list page of the demo clinic (stage 35): a two-level tree of
 * the services of stage 29, their units, lengths and specialties, the cost
 * price of some of them and the history of the prices — the first price a
 * year ago and a rise this spring for about a third of them.
 */
export const generatePriceList = (db: Db) => {
  const categories: ServiceCategory[] = [];
  const byCode = new Map(
    db.services.filter((s) => s.code).map((s) => [s.code!, s]),
  );
  let id = 0;
  TREE.forEach(([sectionName, children], sectionIndex) => {
    const section: ServiceCategory = {
      id: ++id,
      parent_id: null,
      name: sectionName,
      position: sectionIndex,
    };
    categories.push(section);
    const assign = (codes: string[], category: ServiceCategory, path: string) =>
      codes.forEach((code) => {
        const service = byCode.get(code);
        if (!service) return;
        service.category_id = category.id;
        service.category = path;
      });
    children.forEach(([childName, codes], childIndex) => {
      const child: ServiceCategory = {
        id: ++id,
        parent_id: section.id,
        name: childName,
        position: childIndex,
      };
      categories.push(child);
      assign(codes, child, `${sectionName} / ${childName}`);
    });
    // Services of the section left outside its subsections
    for (const service of db.services) {
      if (service.category === sectionName && service.category_id == null) {
        service.category_id = section.id;
      }
    }
  });
  db.service_categories = categories;

  for (const service of db.services) {
    const details = service.code ? DETAILS[service.code] : undefined;
    service.unit = details?.[0] ?? "service";
    service.duration_minutes = details?.[1] ?? null;
    service.specialty = details?.[2] ?? null;
    service.materials_note = (service.code && MATERIALS[service.code]) || null;
    // The directions without a price (the deals' «Услуга») keep a category
    if (service.category && service.category_id == null) {
      service.category_id =
        categories.find(
          (c) => c.parent_id == null && c.name === service.category,
        )?.id ?? null;
      if (service.category_id == null) service.category = null;
    }
  }

  db.service_costs = Object.entries(COSTS)
    .map(([code, cost]) => [byCode.get(code), cost] as const)
    .filter(([service]) => service)
    .map(([service, cost], index) => ({
      id: index + 1,
      service_id: service!.id,
      cost_price: cost,
      updated_by: 0,
      updated_at: new Date(Date.now() - 40 * DAY).toISOString(),
    }));

  const history: PriceHistoryRow[] = [];
  const yearAgo = Date.now() - 365 * DAY;
  const spring = Date.now() - 150 * DAY;
  db.services
    .filter((service) => service.price != null)
    .forEach((service, index) => {
      const price = service.price!;
      if (index % 3 === 0) {
        // A rise of about 10 %: the old price rounded to 500 ₸
        const old = Math.round(price / 1.1 / 500) * 500;
        history.push(
          {
            id: history.length + 1,
            service_id: service.id,
            old_price: null,
            new_price: old,
            sales_id: 0,
            changed_at: new Date(yearAgo + index * 3600_000).toISOString(),
          },
          {
            id: history.length + 2,
            service_id: service.id,
            old_price: old,
            new_price: price,
            sales_id: 0,
            changed_at: new Date(spring + index * 3600_000).toISOString(),
          },
        );
      } else {
        history.push({
          id: history.length + 1,
          service_id: service.id,
          old_price: null,
          new_price: price,
          sales_id: 0,
          changed_at: new Date(yearAgo + index * 3600_000).toISOString(),
        });
      }
    });
  db.service_price_history = history;
};
