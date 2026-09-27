import type { CrmNotification, Deal, Message } from "../../../types";
import type { Db } from "./types";

const MINUTE = 60 * 1000;

/** The demo user (the owner of the demo clinic) */
const DEMO_SALES_ID = 0;

const patientName = (db: Db, deal: Deal) => {
  const patient = db.patients.find((p) => p.id === deal.patient_id);
  return (
    [patient?.last_name, patient?.first_name].filter(Boolean).join(" ") ||
    patient?.phones?.[0] ||
    "Пациент"
  );
};

/**
 * What stage 16 shows in the demo: a few deals whose patient waits for an
 * answer (two past the limit), and notifications of the demo user in the
 * bell. The texts are the ones the database writes.
 */
export const generateNotifications = (db: Db) => {
  const now = Date.now();
  const openStages = new Set(
    db.stages.filter((stage) => stage.kind === "open").map((s) => s.id),
  );
  const open = db.deals.filter(
    (deal) => openStages.has(deal.stage_id) && !deal.archived_at,
  );
  const mine = open.filter((deal) => deal.sales_id === DEMO_SALES_ID);
  const candidates = [
    ...mine,
    ...open.filter((deal) => deal.sales_id !== DEMO_SALES_ID),
  ];
  const [late, later, fresh, assigned] = candidates;

  // Unanswered messages: 55 and 25 minutes (past the 15-minute limit), 6 minutes
  let messageId = Math.max(0, ...db.messages.map((m) => Number(m.id))) + 1;
  const waiting: Array<[Deal | undefined, number, string]> = [
    [late, 55, "Здравствуйте! Можно записаться на консультацию на эту неделю?"],
    [later, 25, "Сколько стоит профессиональная чистка?"],
    [fresh, 6, "А по субботам вы работаете?"],
  ];
  for (const [deal, minutesAgo, text] of waiting) {
    if (!deal) continue;
    const patient = db.patients.find((p) => p.id === deal.patient_id);
    const sentAt = new Date(now - minutesAgo * MINUTE).toISOString();
    // Nothing of this deal after the patient's message
    db.messages = db.messages.filter(
      (m) => m.deal_id !== deal.id || m.sent_at < sentAt,
    );
    db.messages.push({
      id: messageId++,
      patient_id: deal.patient_id,
      deal_id: deal.id,
      channel_id: 1,
      transport: "whatsapp",
      chat_id: (patient?.phones?.[0] ?? "").replace(/\D/g, ""),
      direction: "in",
      sales_id: null,
      text,
      content_type: "text",
      status: "inbound",
      sent_at: sentAt,
      read_at: null,
    } satisfies Message);
  }

  const notification = (
    id: number,
    deal: Deal | undefined,
    data: Pick<CrmNotification, "kind" | "title" | "body"> &
      Partial<CrmNotification>,
    minutesAgo: number,
  ): CrmNotification[] => {
    if (!deal) return [];
    const at = new Date(now - minutesAgo * MINUTE).toISOString();
    return [
      {
        id,
        sales_id: DEMO_SALES_ID,
        deal_id: deal.id,
        patient_id: deal.patient_id,
        task_id: null,
        message_count: 1,
        created_at: at,
        updated_at: at,
        read_at: null,
        ...data,
      },
    ];
  };
  const task = db.tasks.find(
    (t) => t.sales_id === DEMO_SALES_ID && !t.done_date,
  );
  const taskDeal = db.deals.find((deal) => deal.id === task?.deal_id);

  db.notifications = [
    ...notification(
      1,
      late,
      {
        kind: "response_overdue",
        title: "Пациент ждёт ответа",
        body: late ? `${patientName(db, late)} · ждёт 15 мин` : "",
      },
      40,
    ),
    ...notification(
      2,
      later,
      {
        kind: "patient_message",
        title: "Новые сообщения (2)",
        body: later
          ? `${patientName(db, later)}, 2 сообщения: Сколько стоит профессиональная чистка?`
          : "",
        message_count: 2,
      },
      24,
    ),
    ...notification(
      3,
      assigned,
      {
        kind: "lead_assigned",
        title: "Вам передали сделку",
        body: assigned ? patientName(db, assigned) : "",
      },
      3,
    ),
    ...notification(
      4,
      taskDeal,
      {
        kind: "task_overdue",
        title: "Задача просрочена",
        body: taskDeal
          ? `${task?.text ?? "Задача"} · ${patientName(db, taskDeal)}`
          : "",
        task_id: task?.id ?? null,
        read_at: new Date(now - 60 * MINUTE).toISOString(),
      },
      120,
    ),
  ];
};
