import type { Identifier } from "ra-core";

import type { Service } from "../types";

/**
 * Step «Услуги и цены» of the setup wizard (stage 24): common dental
 * services to tick, each with an optional price. A preset matches an
 * existing service of the clinic by its name or an alias of the same
 * service («Гигиена» is «Профгигиена»); broader default services of a new
 * clinic («Терапия», «Ортодонтия»…) stay the clinic's own services.
 */
export type ServicePreset = {
  key: string;
  name: string;
  /** Other names of the same service, lower case */
  aliases?: string[];
};

export const SERVICE_PRESETS: ServicePreset[] = [
  {
    key: "consultation",
    name: "Консультация",
    aliases: ["консультация врача"],
  },
  {
    key: "hygiene",
    name: "Профгигиена",
    aliases: ["гигиена", "профессиональная гигиена"],
  },
  { key: "caries", name: "Лечение кариеса", aliases: ["кариес"] },
  { key: "canals", name: "Лечение каналов", aliases: ["эндодонтия"] },
  {
    key: "extraction",
    name: "Удаление",
    aliases: ["удаление зуба", "удаление зубов"],
  },
  { key: "implants", name: "Имплантация" },
  { key: "all_on_4", name: "All-on-4", aliases: ["all on 4", "все на 4"] },
  { key: "crown", name: "Коронка", aliases: ["коронки"] },
  { key: "veneers", name: "Виниры" },
  {
    key: "braces",
    name: "Брекеты / элайнеры",
    aliases: ["брекеты", "элайнеры", "брекеты/элайнеры"],
  },
  { key: "whitening", name: "Отбеливание" },
  {
    key: "children",
    name: "Детский приём",
    aliases: ["детская стоматология", "детский прием"],
  },
];

/** The preset whose consultation price feeds the «Стоимость консультации» reply */
export const CONSULTATION_KEY = "consultation";

/** Lower case, ё as е, single spaces */
export const normalizeServiceName = (name: string) =>
  name.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

const matches = (preset: ServicePreset, name: string) => {
  const normalized = normalizeServiceName(name);
  return (
    normalizeServiceName(preset.name) === normalized ||
    (preset.aliases ?? []).some(
      (alias) => normalizeServiceName(alias) === normalized,
    )
  );
};

export type ServiceRow = {
  /** Preset key, or `service-<id>` for the clinic's own services */
  key: string;
  name: string;
  serviceId: Identifier | null;
  checked: boolean;
  price: number | null;
  preset: boolean;
};

/**
 * The list the step shows: the presets (ticked when the clinic has an
 * active matching service), then the clinic's other active services.
 * A service matches one preset at most, an exact name winning over an alias.
 */
export const buildServiceRows = (
  services: Service[],
  presets: ServicePreset[] = SERVICE_PRESETS,
): ServiceRow[] => {
  const used = new Set<string>();
  const pick = (preset: ServicePreset) => {
    const free = services.filter((service) => !used.has(String(service.id)));
    const exact = free.filter(
      (service) =>
        normalizeServiceName(service.name) ===
        normalizeServiceName(preset.name),
    );
    const candidates = exact.length
      ? exact
      : free.filter((service) => matches(preset, service.name));
    // An active service first
    return candidates.find((service) => !service.is_archived) ?? candidates[0];
  };
  // Exact names first, so that an alias never steals the service of another preset
  const matched = new Map<string, Service>();
  for (const pass of ["exact", "alias"] as const) {
    for (const preset of presets) {
      if (matched.has(preset.key)) continue;
      const service = pick(preset);
      if (!service) continue;
      const isExact =
        normalizeServiceName(service.name) ===
        normalizeServiceName(preset.name);
      if (pass === "exact" && !isExact) continue;
      matched.set(preset.key, service);
      used.add(String(service.id));
    }
  }

  const presetRows = presets.map((preset): ServiceRow => {
    const service = matched.get(preset.key);
    return {
      key: preset.key,
      name: service?.name ?? preset.name,
      serviceId: service?.id ?? null,
      checked: !!service && !service.is_archived,
      price: service?.price ?? null,
      preset: true,
    };
  });
  const ownRows = services
    .filter((service) => !used.has(String(service.id)) && !service.is_archived)
    .sort((a, b) => a.position - b.position)
    .map(
      (service): ServiceRow => ({
        key: `service-${service.id}`,
        name: service.name,
        serviceId: service.id,
        checked: true,
        price: service.price ?? null,
        preset: false,
      }),
    );
  return [...presetRows, ...ownRows];
};

export type ServiceChange =
  | {
      type: "create";
      data: Pick<Service, "name" | "position"> & { price: number | null };
    }
  | { type: "update"; id: Identifier; data: Partial<Service> }
  | { type: "none" };

/** What ticking or unticking a row does: create, unarchive or archive */
export const serviceToggle = (
  row: ServiceRow,
  checked: boolean,
  nextPosition: number,
): ServiceChange => {
  if (row.serviceId == null) {
    return checked
      ? {
          type: "create",
          data: { name: row.name, position: nextPosition, price: row.price },
        }
      : { type: "none" };
  }
  if (checked === row.checked) return { type: "none" };
  return { type: "update", id: row.serviceId, data: { is_archived: !checked } };
};

/** "5 000", "" or "abc" -> 5000, null, null */
export const parsePrice = (raw: string): number | null => {
  const cleaned = raw.replace(/[\s₸]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
};

/** 5000 -> "5 000", as private.format_tenge */
export const formatTenge = (amount: number) =>
  String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export const ADDRESS_PLACEHOLDER = "[укажите адрес клиники]";
export const PRICE_PLACEHOLDER = "[укажите цену]";

/** Same as private.fill_quick_reply_placeholder: blank values change nothing */
export const fillPlaceholder = (
  text: string,
  placeholder: string,
  value: string | null | undefined,
) => {
  const trimmed = value?.trim();
  if (!trimmed) return text;
  return text.split(placeholder).join(trimmed);
};

/** Same as private.handle_service_price: the consultation service */
export const isConsultation = (name: string) =>
  normalizeServiceName(name).startsWith("консультац");
