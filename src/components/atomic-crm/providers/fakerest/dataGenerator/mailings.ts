import { renderTemplate } from "../../commons/automessages";
import { DEFAULT_MAILING_SETTINGS } from "../../../mailings/limits";
import { addMonths } from "../../../mailings/segment";
import type { MailingMessage } from "../../../mailings/types";
import { DEMO_CLINIC_NAME } from "./automessages";
import type { Db } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/**
 * Repeat sales and mailings of the demo (stage 17): two recall rules, won
 * deals whose recall is due soon (upcoming) or now (created when the repeat
 * sales screen opens), a mailing in progress and a finished one.
 */
export const generateMailings = (db: Db) => {
  const now = Date.now();
  // The texts of the demo mailings (the stage 6 templates stay as they are)
  const promoBody =
    "Здравствуйте, {имя}! В {клиника} до конца месяца профессиональная гигиена со скидкой 20%. Записать вас?";
  const hygieneBody =
    "Здравствуйте, {имя}! Это {клиника}. С вашего последнего визита прошло полгода — самое время для профессиональной гигиены. Подобрать вам удобное время?";
  const service = (name: string) =>
    db.services.find((s) => s.name === name)?.id ?? null;

  db.recall_rules = [
    {
      id: 1,
      name: "Профгигиена",
      service_id: null,
      delay_months: 6,
      pipeline_id: 1,
      stage_id: 1,
      deal_service_id: service("Гигиена"),
      template_id: null,
      message_mode: "confirm",
      is_active: true,
      position: 0,
    },
    {
      id: 2,
      name: "Контроль импланта",
      service_id: service("Имплантация"),
      delay_months: 12,
      pipeline_id: 1,
      stage_id: 1,
      deal_service_id: null,
      template_id: null,
      message_mode: "auto",
      is_active: false,
      position: 1,
    },
  ];
  db.recalls = [];

  // Won deals of the main pipeline, one per patient: two are due now, four
  // in the next 30 days
  const wonStages = new Set(
    db.stages
      .filter((s) => s.kind === "won" && s.pipeline_id === 1)
      .map((s) => s.id),
  );
  const seen = new Set<string>();
  const won = db.deals.filter((deal) => {
    const key = String(deal.patient_id);
    if (!wonStages.has(deal.stage_id as number) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  [-12, -4, 3, 9, 17, 25].forEach((days, index) => {
    const deal = won[index];
    if (!deal) return;
    deal.closed_at = addMonths(new Date(now + days * DAY), -6).toISOString();
    // Only its latest won deal counts: older ones of the patient
    db.deals
      .filter(
        (other) =>
          other.patient_id === deal.patient_id &&
          other.id !== deal.id &&
          wonStages.has(other.stage_id as number),
      )
      .forEach((other) => {
        other.closed_at = new Date(now - 400 * DAY).toISOString();
      });
  });

  db.mailing_settings = [{ id: 1, ...DEFAULT_MAILING_SETTINGS }];

  // A mailing to the VIP patients, started an hour ago, and a finished one
  const vip = db.tags.find((tag) => tag.name === "VIP")?.id ?? 0;
  const recipients = db.patients
    .filter((p) => p.phones?.length)
    .filter((p, index) => p.tags?.includes(vip) || index % 4 === 0)
    .slice(0, 24);
  const started = now - 60 * MINUTE;
  db.mailings = [
    {
      id: 1,
      name: "Акция на гигиену — VIP",
      segment: { tag_ids: [vip], tag_mode: "any" },
      template_id: null,
      body: promoBody,
      scheduled_at: new Date(started).toISOString(),
      status: "scheduled",
      recipients_count: recipients.length,
      created_by: db.sales[0]?.id ?? null,
      created_at: new Date(started - 5 * MINUTE).toISOString(),
      finished_at: null,
    },
    {
      id: 2,
      name: "Напоминание о гигиене",
      segment: { inactive_months: 6 },
      template_id: null,
      body: hygieneBody,
      scheduled_at: new Date(now - 20 * DAY).toISOString(),
      status: "done",
      recipients_count: 6,
      created_by: db.sales[0]?.id ?? null,
      created_at: new Date(now - 20 * DAY - 10 * MINUTE).toISOString(),
      finished_at: new Date(now - 20 * DAY + 40 * MINUTE).toISOString(),
    },
  ];

  let id = 1;
  const row = (
    mailingId: number,
    patient: Db["patients"][number],
    status: MailingMessage["status"],
    at: number,
    delivery: string | null,
    error: string | null = null,
  ): MailingMessage => {
    const text = mailingId === 1 ? promoBody : hygieneBody;
    return {
      id: id++,
      mailing_id: mailingId,
      recall_id: null,
      patient_id: patient.id,
      deal_id: null,
      body: text,
      send_at: new Date(
        mailingId === 1 ? started : now - 20 * DAY,
      ).toISOString(),
      status,
      text:
        status === "sent" || status === "failed"
          ? renderTemplate(text, {
              имя: patient.first_name,
              клиника: DEMO_CLINIC_NAME,
            })
          : null,
      error,
      message_id: null,
      external_id: null,
      delivery_status: delivery,
      claimed_at: status === "pending" ? null : new Date(at).toISOString(),
      processed_at: status === "pending" ? null : new Date(at).toISOString(),
      created_at: new Date(started - 5 * MINUTE).toISOString(),
    };
  };
  db.mailing_messages = recipients.map((patient, index) => {
    const at = started + index * 15_000;
    if (index < 5) return row(1, patient, "sent", at, "read");
    if (index < 9) return row(1, patient, "sent", at, "delivered");
    if (index < 12) return row(1, patient, "sent", at, "sent");
    if (index === 12) {
      return row(
        1,
        patient,
        "failed",
        at,
        null,
        "Wazzup24 не принял сообщение",
      );
    }
    if (index === 13) {
      return row(
        1,
        patient,
        "skipped",
        at,
        null,
        "Пациент отказался от сообщений",
      );
    }
    return row(1, patient, "pending", at, null);
  });
  db.mailing_messages.push(
    ...db.patients
      .filter((p) => p.phones?.length)
      .slice(40, 46)
      .map((patient, index) =>
        row(
          2,
          patient,
          "sent",
          now - 20 * DAY + index * 20_000,
          index < 3 ? "read" : "delivered",
        ),
      ),
  );
  // The opted-out patient of the mailing
  const optedOut = recipients[13];
  if (optedOut) {
    optedOut.messaging_opt_out = true;
    optedOut.messaging_opt_out_at = new Date(started).toISOString();
  }
};
