import { random } from "faker/locale/en_US";

import { normalizePatient } from "../../commons/domain";
import type { Deal, DealEvent, Patient, Stage } from "../../../types";
import {
  dealAmounts,
  dealTitles,
  kzPerson,
  kzPhone,
  noteTexts,
  roundedAmount,
  taskTexts,
} from "./kz";
import { assignDoctors } from "./doctors";
import type { Db } from "./types";
import { randomDate } from "./utils";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Keys of the deal titles and amounts by service name
const serviceKeys: Record<string, string> = {
  Имплантация: "implantation",
  Ортодонтия: "orthodontics",
  Терапия: "therapy",
  Гигиена: "hygiene",
  Протезирование: "prosthetics",
  Хирургия: "surgery",
  "Детская стоматология": "other",
  Другое: "other",
};

/**
 * A believable clinic: patients, their requests across the stages, payments,
 * tasks (some overdue, some deals without any), notes, calls and the log.
 */
export const generateClinic = (db: Db, nbPatients = 90) => {
  const now = Date.now();
  const staff = db.sales;

  db.patients = Array.from({ length: nbPatients }, (_, id) => {
    const person = kzPerson();
    const phone = kzPhone();
    const first_seen = randomDate(new Date(now - 120 * DAY)).toISOString();
    return normalizePatient({
      id,
      first_name: person.first_name,
      last_name: person.last_name,
      middle_name: null,
      gender: person.gender,
      phone_jsonb: [{ number: phone, type: "Mobile" }],
      whatsapp: random.boolean() ? phone : null,
      instagram: random.boolean()
        ? `${person.first_name.toLowerCase()}.dent`
        : null,
      telegram: null,
      birth_date: null,
      city: random.arrayElement([
        "Алматы",
        "Алматы",
        "Алматы",
        "Астана",
        "Каскелен",
      ]),
      source_id: null,
      tags: random
        .arrayElements(db.tags, random.arrayElement([0, 0, 0, 1, 2]))
        .map((tag) => tag.id),
      sales_id: random.arrayElement(staff).id,
      background: random.boolean() ? random.arrayElement(noteTexts) : null,
      status: random.arrayElement(["cold", "warm", "hot", "in-treatment"]),
      avatar: undefined,
      first_seen,
      last_seen: randomDate(new Date(first_seen)).toISOString(),
    } as Patient);
  });

  // Requests: most patients have one, some come back
  const deals: Deal[] = [];
  db.patients.forEach((patient) => {
    const count = random.arrayElement([1, 1, 1, 1, 2]);
    for (let i = 0; i < count; i++) {
      const pipelineId = random.arrayElement([1, 1, 1, 1, 2]);
      const stages = db.stages.filter((s) => s.pipeline_id === pipelineId);
      const stage = random.arrayElement(
        // Open deals first, then refusals (reports need some) and successes
        stages.flatMap((s) =>
          s.kind === "open"
            ? [s, s, s]
            : s.kind === "lost"
              ? [s, s, s, s]
              : [s, s],
        ),
      );
      const service =
        pipelineId === 2 ? db.services[1] : random.arrayElement(db.services);
      const key = serviceKeys[service.name] ?? "other";
      const source = random.arrayElement(db.lead_sources.slice(0, 7));
      const created_at = randomDate(new Date(patient.first_seen)).toISOString();
      const closed = stage.kind !== "open";
      deals.push({
        id: deals.length,
        patient_id: patient.id,
        pipeline_id: pipelineId,
        stage_id: stage.id,
        name: random.arrayElement(dealTitles[key] ?? dealTitles.other),
        source_id: source.id,
        service_id: service.id,
        plan_amount: roundedAmount(dealAmounts[key] ?? dealAmounts.other),
        paid_amount: 0,
        sales_id:
          random.boolean() || !closed
            ? patient.sales_id
            : random.arrayElement(staff).id,
        lost_reason_id:
          stage.kind === "lost"
            ? random.arrayElement(db.lost_reasons).id
            : null,
        lost_comment: null,
        appointment_at:
          stage.position >= 2 && stage.kind === "open"
            ? new Date(
                now + random.number({ min: -3, max: 10 }) * DAY,
              ).toISOString()
            : null,
        visit_at:
          stage.position >= 3
            ? new Date(now - random.number(20) * DAY).toISOString()
            : null,
        tags: [],
        description: random.boolean() ? random.arrayElement(noteTexts) : null,
        index: 0,
        created_at,
        updated_at: created_at,
        stage_changed_at: created_at,
        closed_at: closed
          ? randomDate(new Date(created_at)).toISOString()
          : null,
        first_response_at: null,
        archived_at: null,
        doctor_id: null,
        consultation_amount: null,
      });
      if (patient.source_id == null) patient.source_id = source.id;
    }
  });
  // Column order
  db.stages.forEach((stage) =>
    deals
      .filter((deal) => deal.stage_id === stage.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .forEach((deal, index) => (deal.index = index)),
  );
  db.deals = deals;
  assignDoctors(db, deals);

  // Stage history: every deal walks through the stages up to its current one
  // (sometimes skipping one), a lost deal leaves from an open stage. The log
  // feeds the deal feed and the reports (time in stage, funnel, lost from).
  const history = new Map<
    Deal["id"],
    Array<{ stage_id: Stage["id"]; at: number }>
  >();
  deals.forEach((deal) => {
    const pipelineStages = db.stages
      .filter((s) => s.pipeline_id === deal.pipeline_id)
      .sort((a, b) => a.position - b.position);
    const open = pipelineStages.filter((s) => s.kind === "open");
    const current = pipelineStages.find((s) => s.id === deal.stage_id)!;
    // The furthest open stage reached before the current one
    const lastOpen =
      current.kind === "open"
        ? current
        : current.kind === "won"
          ? open[open.length - 1]
          : random.arrayElement(
              open.flatMap((s, index) =>
                Array(Math.max(1, open.length - index)).fill(s),
              ),
            );
    const path = open.filter(
      (s, index) =>
        index === 0 ||
        s.id === lastOpen.id ||
        (s.position < lastOpen.position && random.number(9) > 1),
    );
    if (current.kind !== "open") path.push(current);
    const start = new Date(deal.created_at).getTime();
    // Steps of a few hours to a few days, within the time the deal has had
    const room = Math.max(now - start, HOUR);
    const weights = path.slice(1).map(() => random.number({ min: 1, max: 10 }));
    const total = weights.reduce((sum, w) => sum + w, 0) || 1;
    const span = room * random.arrayElement([0.3, 0.5, 0.7, 0.9]);
    let at = start;
    const entries = [{ stage_id: path[0].id, at }];
    weights.forEach((weight, index) => {
      at += Math.round((span * weight) / total);
      entries.push({ stage_id: path[index + 1].id, at });
    });
    history.set(deal.id, entries);
    const last = new Date(entries[entries.length - 1].at).toISOString();
    deal.stage_changed_at = last;
    deal.updated_at = last;
    deal.closed_at = current.kind === "open" ? null : last;
  });
  // When the deal reached its stage at or after "План согласован": payments come after
  const planReachedAt = (deal: Deal) => {
    const plan = db.stages.find(
      (s) => s.pipeline_id === deal.pipeline_id && s.name === "План согласован",
    );
    const entries = history.get(deal.id) ?? [];
    const entry = entries.find((e) => {
      const stage = db.stages.find((s) => s.id === e.stage_id)!;
      return plan
        ? stage.position >= plan.position && stage.kind !== "lost"
        : stage.kind === "won";
    });
    return entry ? new Date(entry.at) : new Date(deal.created_at);
  };

  // Payments on deals with an agreed plan, in treatment or finished; some
  // start with a prepayment. Some booked patients prepay the visit.
  db.deal_payments = [];
  const pay = (
    deal: Deal,
    amount: number,
    kind: "prepayment" | "payment",
    after: Date,
  ) => {
    if (amount <= 0) return;
    db.deal_payments.push({
      id: db.deal_payments.length,
      deal_id: deal.id,
      amount,
      kind,
      paid_at: randomDate(after).toISOString().slice(0, 10),
      comment: random.arrayElement([
        "Kaspi",
        "Наличные",
        "Карта",
        "Рассрочка Kaspi",
      ]),
      sales_id: deal.sales_id,
      created_at: deal.updated_at,
    });
    deal.paid_amount += amount;
  };
  deals.forEach((deal) => {
    const stage = db.stages.find((s) => s.id === deal.stage_id)!;
    const paying =
      stage.kind === "won" || (stage.kind === "open" && stage.position >= 4);
    if (!paying) {
      const booked =
        stage.kind === "open" && stage.position >= 2 && deal.doctor_id != null;
      if (booked && random.number(9) < 3) {
        pay(
          deal,
          random.arrayElement([5000, 10000, 20000]),
          "prepayment",
          new Date(deal.created_at),
        );
      }
      return;
    }
    const share = stage.kind === "won" ? 1 : random.arrayElement([0.3, 0.5]);
    const amount = Math.round((deal.plan_amount * share) / 1000) * 1000;
    if (random.number(9) < 4) {
      const prepayment = Math.round((amount * 0.2) / 1000) * 1000;
      pay(deal, prepayment, "prepayment", planReachedAt(deal));
      pay(deal, amount - prepayment, "payment", planReachedAt(deal));
    } else {
      pay(deal, amount, "payment", planReachedAt(deal));
    }
  });

  // Tasks done along the way: most in time, some late
  db.tasks = [];
  deals.forEach((deal) => {
    const entries = history.get(deal.id) ?? [];
    entries.slice(0, -1).forEach((entry, index) => {
      if (random.number(9) < 3) return;
      const next = entries[index + 1].at;
      const due = entry.at + random.arrayElement([1, 4, 24, 48]) * HOUR;
      const done = Math.min(
        next,
        random.number(9) < 7 ? due - HOUR : due + random.number(48) * HOUR,
      );
      db.tasks.push({
        id: db.tasks.length,
        deal_id: deal.id,
        type: random.arrayElement(["call", "message", "reminder"]),
        text: random.arrayElement(taskTexts),
        created_at: new Date(entry.at).toISOString(),
        due_date: new Date(due).toISOString(),
        done_date: new Date(
          Math.max(done, entry.at + 10 * 60 * 1000),
        ).toISOString(),
        sales_id: deal.sales_id ?? undefined,
      });
    });
  });

  // Tasks on open deals: some overdue, some deals left without any
  deals.forEach((deal) => {
    const stage = db.stages.find((s) => s.id === deal.stage_id)!;
    if (stage.kind !== "open" || random.number(9) < 2) return;
    const hours = random.arrayElement([
      -60, -20, -3, 2, 5, 20, 30, 48, 96, 168,
    ]);
    db.tasks.push({
      id: db.tasks.length,
      deal_id: deal.id,
      type: random.arrayElement([
        "call",
        "call",
        "message",
        "reminder",
        "other",
      ]),
      text: random.arrayElement(taskTexts),
      created_at: deal.stage_changed_at,
      due_date: new Date(now + hours * 60 * 60 * 1000).toISOString(),
      done_date: null,
      sales_id: deal.sales_id ?? undefined,
    });
  });

  db.patient_notes = db.patients
    .filter(() => random.number(9) < 3)
    .map((patient, id) => ({
      id,
      patient_id: patient.id,
      text: random.arrayElement(noteTexts),
      date: randomDate(new Date(patient.first_seen)).toISOString(),
      sales_id: patient.sales_id!,
      status: patient.status ?? "warm",
      attachments: [],
    }));

  db.deal_notes = deals
    .filter(() => random.number(9) < 2)
    .map((deal, id) => ({
      id,
      deal_id: deal.id,
      text: random.arrayElement(noteTexts),
      date: randomDate(new Date(deal.created_at)).toISOString(),
      sales_id: deal.sales_id!,
      attachments: [],
    }));

  db.calls = db.patients
    .filter(() => random.number(9) < 4)
    .map((patient, id) => ({
      id,
      patient_id: patient.id,
      deal_id: null,
      direction: random.arrayElement(["in", "out"] as const),
      duration_seconds: random.number({ min: 20, max: 600 }),
      comment: random.arrayElement([
        "Спрашивала про рассрочку",
        "Уточнил стоимость имплантации",
        "Перенёс визит на следующую неделю",
        "Не взял трубку",
      ]),
      called_at: randomDate(new Date(patient.first_seen)).toISOString(),
      sales_id: patient.sales_id,
    }));

  // Conversations: open deals of the last weeks talk in WhatsApp or Instagram,
  // the most recent ones still unread
  db.messenger_channels = [
    {
      id: 1,
      external_id: "demo-wa",
      transport: "whatsapp",
      name: "+7 727 355 00 00",
      state: "active",
    },
    {
      id: 2,
      external_id: "demo-ig",
      transport: "instagram",
      name: "zhemchug.dental",
      state: "active",
    },
  ];
  const dialogs = [
    [
      "Здравствуйте! Сколько стоит имплант под ключ?",
      "Добрый день! Имплантация под ключ от 280 000 ₸. Приглашаем на бесплатную консультацию — когда вам удобно?",
      "Можно в субботу утром?",
    ],
    [
      "Добрый день, можно записаться на чистку?",
      "Здравствуйте! Есть окно завтра в 11:00 или в 16:30.",
      "Давайте в 16:30",
    ],
    [
      "Сколько стоят брекеты?",
      "Металлические от 450 000 ₸, керамические от 650 000 ₸. Есть рассрочка 0-0-12.",
      "А рассрочка через Kaspi?",
    ],
    [
      "У ребёнка болит зуб, примете сегодня?",
      "Здравствуйте! Да, детский врач свободен в 15:00. Записать вас?",
    ],
    [
      "Хочу виниры, сколько по времени делаются?",
      "Добрый день! 2–3 визита, около двух недель. Нужна консультация, чтобы назвать точную стоимость.",
    ],
  ];
  const openStages = new Set(
    db.stages.filter((stage) => stage.kind === "open").map((stage) => stage.id),
  );
  let messageId = 0;
  db.messages = deals
    .filter((deal) => openStages.has(deal.stage_id))
    .filter(() => random.number(9) < 5)
    .flatMap((deal, index) => {
      const patient = db.patients.find((p) => p.id === deal.patient_id)!;
      const instagram = index % 4 === 3;
      const lines = dialogs[index % dialogs.length];
      const start = Math.max(
        new Date(deal.created_at).getTime(),
        now - 5 * DAY,
      );
      const unread = index % 3 === 0;
      return lines.map((text, position) => {
        const incoming = position % 2 === 0;
        const sentAt = new Date(
          Math.min(
            start + position * 40 * 60 * 1000,
            now - (lines.length - position) * 60 * 1000,
          ),
        ).toISOString();
        return {
          id: messageId++,
          patient_id: patient.id,
          deal_id: deal.id,
          channel_id: instagram ? 2 : 1,
          transport: instagram ? ("instagram" as const) : ("whatsapp" as const),
          chat_id: instagram
            ? `ig-${patient.id}`
            : (patient.phones?.[0] ?? "").replace(/\D/g, ""),
          direction: incoming ? ("in" as const) : ("out" as const),
          sales_id: incoming ? null : deal.sales_id,
          text,
          content_type: "text",
          status: incoming ? ("inbound" as const) : ("read" as const),
          sent_at: sentAt,
          read_at:
            incoming && !(unread && position === lines.length - 1)
              ? sentAt
              : null,
        };
      });
    });

  // Same as the database trigger: the first answer of each deal. Older deals
  // (their conversation is not generated) were answered within minutes to hours.
  for (const deal of deals) {
    const first = db.messages
      .filter((m) => m.deal_id === deal.id && m.direction === "out")
      .sort((a, b) => a.sent_at.localeCompare(b.sent_at))[0];
    const createdAt = new Date(deal.created_at).getTime();
    // A conversation of the last days on an older deal: it was answered before
    if (first && new Date(first.sent_at).getTime() - createdAt < DAY) {
      deal.first_response_at = first.sent_at;
    } else if (first || random.number(9) < 8) {
      const minutes = random.arrayElement([3, 7, 12, 20, 35, 60, 95, 180, 420]);
      deal.first_response_at = new Date(
        createdAt + minutes * 60 * 1000,
      ).toISOString();
    }
  }

  db.deal_events = deals
    .flatMap((deal) =>
      (history.get(deal.id) ?? []).map(
        (entry, index, entries): DealEvent => ({
          id: 0,
          deal_id: deal.id,
          type: index === 0 ? "created" : "stage_changed",
          from_stage_id: index === 0 ? null : entries[index - 1].stage_id,
          to_stage_id: entry.stage_id,
          changes: {},
          sales_id: deal.sales_id,
          created_at: new Date(entry.at).toISOString(),
        }),
      ),
    )
    .map((event, id) => ({ ...event, id }));
};
