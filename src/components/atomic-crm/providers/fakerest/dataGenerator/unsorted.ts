import { leadNoteText } from "../../../leads/leadWebhook";
import type { Deal, Message, Patient } from "../../../types";
import { normalizePatient } from "../../commons/domain";
import type { Db } from "./types";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const nextId = (rows: { id: unknown }[]) =>
  Math.max(-1, ...rows.map((row) => Number(row.id))) + 1;

/**
 * Stage 18 in the demo: «Неразобранное» is on, with a few leads waiting
 * (WhatsApp, Instagram, a website form, a missed call), and a few possible
 * duplicate patients (same phone, same Instagram, same name and birth date).
 */
export const generateUnsorted = (db: Db) => {
  const now = Date.now();
  const at = (minutesAgo: number) =>
    new Date(now - minutesAgo * MINUTE).toISOString();
  // The generated Instagram handles repeat (same first names): only the
  // pairs made below are duplicates
  const handles = new Set<string>();
  for (const patient of db.patients) {
    if (!patient.instagram) continue;
    if (handles.has(patient.instagram)) {
      patient.instagram = `${patient.instagram}${patient.id}`;
    }
    handles.add(patient.instagram);
  }
  const settings = db.organization_settings[0];
  settings.unsorted_enabled = true;
  settings.unsorted_source_ids = [];

  const pipeline = db.pipelines.find((p) => p.is_default) ?? db.pipelines[0];
  const firstStage = db.stages
    .filter((s) => s.pipeline_id === pipeline.id && s.kind === "open")
    .sort((a, b) => a.position - b.position)[0];
  const source = (code: string) =>
    db.lead_sources.find((s) => s.code === code) ?? db.lead_sources[0];

  const addPatient = (fields: Partial<Patient>, since: string) => {
    const patient = normalizePatient({
      id: nextId(db.patients),
      first_name: "",
      last_name: "",
      middle_name: null,
      phone_jsonb: [],
      whatsapp: null,
      instagram: null,
      telegram: null,
      birth_date: null,
      city: null,
      source_id: null,
      tags: [],
      sales_id: null,
      background: null,
      status: null,
      first_seen: since,
      last_seen: since,
      ...fields,
    } as Patient);
    db.patients.push(patient);
    return patient;
  };

  const addLead = (patient: Patient, sourceCode: string, since: string) => {
    const deal: Deal = {
      id: nextId(db.deals),
      patient_id: patient.id,
      pipeline_id: pipeline.id,
      stage_id: firstStage.id,
      name: null,
      source_id: source(sourceCode).id,
      service_id: null,
      plan_amount: 0,
      paid_amount: 0,
      sales_id: null,
      lost_reason_id: null,
      lost_comment: null,
      appointment_at: null,
      visit_at: null,
      tags: [],
      description: null,
      index: 0,
      created_at: since,
      updated_at: since,
      stage_changed_at: since,
      closed_at: null,
      first_response_at: null,
      archived_at: null,
      doctor_id: null,
      consultation_amount: null,
      unsorted_at: since,
    };
    db.deals.push(deal);
    patient.source_id ??= deal.source_id;
    db.deal_events.push({
      id: nextId(db.deal_events),
      deal_id: deal.id,
      type: "created",
      from_stage_id: null,
      to_stage_id: deal.stage_id,
      changes: {},
      sales_id: null,
      created_at: since,
    });
    return deal;
  };

  const incoming = (
    deal: Deal,
    patient: Patient,
    transport: Message["transport"],
    chatId: string,
    texts: string[],
    minutesAgo: number,
  ) =>
    texts.forEach((text, index) =>
      db.messages.push({
        id: nextId(db.messages),
        patient_id: patient.id,
        deal_id: deal.id,
        channel_id: transport === "instagram" ? 2 : 1,
        transport,
        chat_id: chatId,
        direction: "in",
        sales_id: null,
        text,
        content_type: "text",
        status: "inbound",
        sent_at: at(minutesAgo - index * 2),
        read_at: null,
      }),
    );

  // WhatsApp: a new patient asks twice
  const whatsapp = addPatient(
    {
      first_name: "Айгерим",
      phone_jsonb: [{ number: "+7 707 418 22 90", type: "mobile" }],
      whatsapp: "+7 707 418 22 90",
    },
    at(12),
  );
  incoming(
    addLead(whatsapp, "whatsapp", at(12)),
    whatsapp,
    "whatsapp",
    "77074182290",
    [
      "Здравствуйте! Сколько стоит отбеливание?",
      "И можно ли записаться на эту субботу?",
    ],
    12,
  );

  // Instagram: a patient the clinic knows writes from Instagram (same handle)
  const known =
    db.patients.find((p) => p.instagram && p.last_name) ?? db.patients[0];
  known.instagram ??= "dana.smile";
  const instagram = addPatient(
    { first_name: known.instagram!, instagram: known.instagram },
    at(50),
  );
  incoming(
    addLead(instagram, "instagram", at(50)),
    instagram,
    "instagram",
    "ig-demo-lead",
    [
      `Добрый день, это ${known.first_name}, я у вас лечилась. Хочу записаться на чистку`,
    ],
    50,
  );

  // A website form
  const form = addPatient(
    {
      first_name: "Руслан",
      phone_jsonb: [{ number: "+7 701 562 30 11", type: "mobile" }],
    },
    at(190),
  );
  const formDeal = addLead(form, "website", at(190));
  db.deal_notes.push({
    id: nextId(db.deal_notes),
    deal_id: formDeal.id,
    type: "lead",
    text: leadNoteText({
      repeat: false,
      sourceName: source("website").name,
      name: "Руслан",
      phone: "+77015623011",
      service: "Имплантация",
      comment: "Нет двух зубов снизу, интересует имплантация под ключ",
    }),
    date: at(190),
    sales_id: null as any,
    attachments: [],
  });

  // A missed call from a new number
  const caller = addPatient(
    { first_name: "+77087770455", phone_jsonb: [{ number: "+77087770455" }] },
    at(26 * 60),
  );
  const callDeal = addLead(caller, "call", at(26 * 60));
  db.calls.push({
    id: nextId(db.calls),
    patient_id: caller.id,
    deal_id: callDeal.id,
    direction: "in",
    duration_seconds: 0,
    comment: null,
    called_at: at(26 * 60),
    sales_id: null,
    provider: "zadarma",
    status: "missed",
    external_id: "demo-unsorted-call",
    phone: "+77087770455",
    extension: null,
    recording_url: null,
  });
  db.tasks.push({
    id: nextId(db.tasks),
    deal_id: callDeal.id,
    type: "call",
    text: "Перезвонить",
    due_date: at(26 * 60),
    done_date: null,
    sales_id: undefined,
  });

  // Duplicates: the same phone written another way (a WhatsApp contact)
  const byPhone = db.patients.find((p) => p.phones?.length && p.last_name)!;
  addPatient(
    {
      first_name: byPhone.first_name,
      phone_jsonb: [
        {
          number: byPhone.phones![0].replace(/^\+7/, "8"),
          type: "mobile",
        },
      ],
      city: "Алматы",
    },
    new Date(now - 20 * DAY).toISOString(),
  );

  // Duplicates: same full name and birth date, another phone
  const byName = db.patients.find(
    (p) => p.last_name && p.id !== byPhone.id && p.id !== known.id,
  )!;
  byName.birth_date = "1988-04-17";
  const twin = addPatient(
    {
      first_name: byName.first_name,
      last_name: byName.last_name,
      birth_date: "1988-04-17",
      phone_jsonb: [{ number: "+7 747 301 55 18", type: "mobile" }],
      background: "Записывалась по телефону, карту завели заново",
    },
    new Date(now - 7 * DAY).toISOString(),
  );
  db.patient_notes.push({
    id: nextId(db.patient_notes),
    patient_id: twin.id,
    text: "Аллергия на лидокаин",
    date: new Date(now - 7 * DAY).toISOString(),
    sales_id: db.sales[0].id,
    status: "warm",
    attachments: [],
  });
};
