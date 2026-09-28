import type {
  Automessage,
  CrmNotification,
  Deal,
  Message,
  Patient,
  Task,
} from "../../../types";
import { withButtons } from "../../../salesbot/engine";
import { importBot, type BotDictionaries } from "../../../salesbot/portable";
import { BOT_TEMPLATES } from "../../../salesbot/templates";
import type {
  LogKind,
  Salesbot,
  SalesbotLog,
  SalesbotSession,
  SessionStatus,
} from "../../../salesbot/types";
import { normalizePatient } from "../../commons/domain";
import type { Db } from "./types";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const nextId = (rows: { id: unknown }[]) =>
  Math.max(-1, ...rows.map((row) => Number(row.id))) + 1;

/**
 * «Салесбот» of the demo clinic (stage 26): the «Первичная консультация»
 * bot of the gallery, active on new WhatsApp leads, the «Реактивация
 * отказа» bot switched off, and three new WhatsApp requests with the bot's
 * history: one conversation in progress, one handed over, one booked.
 */
export const generateSalesbot = (db: Db) => {
  const now = Date.now();
  const at = (minutesAgo: number) =>
    new Date(now - minutesAgo * MINUTE).toISOString();
  const pipeline = db.pipelines.find((p) => p.is_default) ?? db.pipelines[0];
  const stages = db.stages
    .filter((s) => s.pipeline_id === pipeline.id)
    .sort((a, b) => a.position - b.position);
  const stageNamed = (name: string) =>
    stages.find((s) => s.name === name) ?? stages[0];
  const owner = db.sales.find((s) => s.role === "owner") ?? db.sales[0];
  const manager = db.sales.find((s) => s.role === "manager") ?? owner;

  // The tags the consultation bot sets
  for (const name of ["Боль", "Имплантация", "Брекеты"]) {
    if (!db.tags.some((tag) => tag.name === name)) {
      db.tags.push({ id: nextId(db.tags), name, color: "#e4e1f3" });
    }
  }
  const dicts: BotDictionaries = {
    stages: [
      ...stages,
      ...db.stages.filter((s) => s.pipeline_id !== pipeline.id),
    ],
    tags: db.tags,
    sources: db.lead_sources,
    fields: db.custom_fields.filter((f) => f.entity === "deal"),
    templates: db.message_templates,
    webhooks: db.webhooks.map((w) => ({ id: w.id, name: w.name ?? w.url })),
    services: db.services,
    doctors: db.doctors,
  };
  db.salesbots = BOT_TEMPLATES.map(({ id, bot }, index) => ({
    ...importBot(bot, dicts),
    id: index + 1,
    is_active: id === "consultation",
    version: 1,
    position: index,
    created_by: owner.id,
    created_at: at(20 * 24 * 60),
    updated_at: at(20 * 24 * 60),
  })) satisfies Salesbot[];
  const bot = db.salesbots[0];
  db.salesbot_sessions = [];
  db.salesbot_logs = [];

  const tagId = (name: string) => db.tags.find((t) => t.name === name)!.id;
  const stepText = (id: string) => {
    const step = bot.scenario.steps.find((s) => s.id === id)!;
    return (name: string) =>
      withButtons(
        (step.text ?? "")
          .replace("{имя}", name)
          .replace("{клиника}", "Жемчуг Дентал"),
        step.buttons,
      );
  };

  type Line =
    | { in: string }
    | { bot: string; step: string }
    | { log: LogKind; step?: string; text?: string };

  const conversation = ({
    firstName,
    lastName,
    phone,
    minutesAgo,
    stage,
    tags,
    serviceName,
    status,
    currentStep,
    lines,
  }: {
    firstName: string;
    lastName: string;
    phone: string;
    minutesAgo: number;
    stage: string;
    tags: string[];
    serviceName?: string;
    status: SessionStatus;
    currentStep: string | null;
    lines: Line[];
  }) => {
    const since = at(minutesAgo);
    const patient = normalizePatient({
      id: nextId(db.patients),
      first_name: firstName,
      last_name: lastName,
      middle_name: null,
      phone_jsonb: [{ number: phone, type: "mobile" }],
      whatsapp: phone,
      instagram: null,
      telegram: null,
      birth_date: null,
      city: "Алматы",
      source_id: db.lead_sources.find((s) => s.code === "whatsapp")?.id ?? null,
      tags: [],
      sales_id: manager.id,
      background: null,
      status: null,
      first_seen: since,
      last_seen: since,
    } as Patient);
    db.patients.push(patient);
    const deal: Deal = {
      id: nextId(db.deals),
      patient_id: patient.id,
      pipeline_id: pipeline.id,
      stage_id: stageNamed(stage).id,
      name: null,
      source_id: patient.source_id ?? null,
      service_id: serviceName
        ? (db.services.find((s) => s.name === serviceName)?.id ?? null)
        : null,
      plan_amount: 0,
      paid_amount: 0,
      sales_id: manager.id,
      lost_reason_id: null,
      lost_comment: null,
      appointment_at: null,
      visit_at: null,
      tags: tags.map(tagId),
      description: null,
      index: 0,
      created_at: since,
      updated_at: at(Math.max(minutesAgo - lines.length * 3, 1)),
      stage_changed_at: since,
      closed_at: null,
      first_response_at: null,
      archived_at: null,
      doctor_id: null,
      consultation_amount: null,
      unsorted_at: null,
      custom_values: {},
    };
    db.deals.push(deal);
    db.deal_events.push({
      id: nextId(db.deal_events),
      deal_id: deal.id,
      type: "created",
      from_stage_id: null,
      to_stage_id: stageNamed("Новый лид").id,
      changes: {},
      sales_id: null,
      created_at: since,
    });
    const session: SalesbotSession = {
      id: db.salesbot_sessions.length + 1,
      deal_id: deal.id,
      bot_id: bot.id,
      bot_name: bot.name,
      bot_version: bot.version,
      scenario: bot.scenario,
      current_step: currentStep,
      state: status === "waiting" ? { wait: "reply", replies: [] } : {},
      status,
      wait_until: status === "waiting" ? at(minutesAgo - 150) : null,
      last_reply: null,
      messages_sent: 0,
      trigger: "new_lead",
      started_by: null,
      stopped_reason:
        status === "handed_off" ? "Пациенту нужен ответ администратора" : null,
      created_at: since,
      updated_at: since,
      finished_at: null,
    };
    db.salesbot_sessions.push(session);
    const log = (
      kind: LogKind,
      created: string,
      step?: string,
      text?: string | null,
      extra: Record<string, unknown> = {},
    ) => {
      const scenarioStep = step
        ? bot.scenario.steps.find((s) => s.id === step)
        : undefined;
      // What the database logs: the end of a wait, the action of a change
      const details: Record<string, unknown> = { ...extra };
      if (kind === "waiting" && scenarioStep?.timeout_minutes) {
        details.until = new Date(
          new Date(created).getTime() + scenarioStep.timeout_minutes * MINUTE,
        ).toISOString();
      }
      if (kind === "set" && scenarioStep?.actions?.[0]) {
        details.action = scenarioStep.actions[0];
      }
      db.salesbot_logs.push({
        id: db.salesbot_logs.length + 1,
        session_id: session.id,
        deal_id: deal.id,
        step_id: step ?? null,
        step_type: step
          ? (bot.scenario.steps.find((s) => s.id === step)?.type ?? null)
          : null,
        kind,
        text: text ?? null,
        details,
        created_at: created,
      } satisfies SalesbotLog);
    };

    const chatId = phone.replace(/\D/g, "");
    log("started", since, undefined, bot.name);
    lines.forEach((line, index) => {
      const sentAt = at(minutesAgo - index * 2);
      if ("in" in line) {
        db.messages.push({
          id: nextId(db.messages),
          patient_id: patient.id,
          deal_id: deal.id,
          channel_id: 1,
          transport: "whatsapp",
          chat_id: chatId,
          direction: "in",
          sales_id: null,
          text: line.in,
          content_type: "text",
          status: "inbound",
          sent_at: sentAt,
          read_at: sentAt,
        } satisfies Message);
        if (index > 0) log("reply", sentAt, undefined, line.in);
        session.last_reply = line.in;
      } else if ("bot" in line) {
        const automessageId = nextId(db.automessages);
        db.automessages.push({
          id: automessageId,
          deal_id: deal.id,
          rule_id: null,
          template_id: null,
          salesbot_session_id: session.id,
          stage_id: deal.stage_id,
          timing: "after_stage",
          send_at: sentAt,
          status: "sent",
          text: line.bot,
          processed_at: sentAt,
          created_at: sentAt,
        } satisfies Automessage);
        db.messages.push({
          id: nextId(db.messages),
          patient_id: patient.id,
          deal_id: deal.id,
          channel_id: 1,
          transport: "whatsapp",
          chat_id: chatId,
          direction: "out",
          sales_id: null,
          text: line.bot,
          content_type: "text",
          status: "read",
          sent_at: sentAt,
          automessage_id: automessageId,
        } satisfies Message);
        session.messages_sent++;
        log("sent", sentAt, line.step, line.bot, {
          automessage_id: automessageId,
          send_at: sentAt,
        });
      } else {
        log(line.log, sentAt, line.step, line.text);
      }
      session.updated_at = sentAt;
    });
    if (status !== "waiting") session.finished_at = session.updated_at;
    else {
      const wait = db.salesbot_logs
        .filter((l) => l.session_id === session.id && l.kind === "waiting")
        .at(-1);
      session.wait_until = (wait?.details.until as string) ?? null;
    }
    return { deal, patient, session };
  };

  const greet = stepText("greet");
  const offer = stepText("offer");

  // In progress: answered «2», waits for the booking answer
  conversation({
    firstName: "Жанна",
    lastName: "Сейтказы",
    phone: "+7 705 311 42 18",
    minutesAgo: 25,
    stage: "Новый лид",
    tags: ["Имплантация"],
    serviceName: "Имплантация",
    status: "waiting",
    currentStep: "wait_answer",
    lines: [
      { in: "Здравствуйте, хочу узнать про имплантацию" },
      { bot: greet("Жанна"), step: "greet" },
      { log: "waiting", step: "wait_need" },
      { in: "2" },
      { log: "set", step: "implant" },
      { bot: offer("Жанна"), step: "offer" },
      { log: "waiting", step: "wait_answer" },
    ],
  });

  // Handed over: a question the bot cannot answer
  const handed = conversation({
    firstName: "Нурлан",
    lastName: "Абенов",
    phone: "+7 701 204 77 35",
    minutesAgo: 26 * 60,
    stage: "Новый лид",
    tags: [],
    status: "handed_off",
    currentStep: "handoff",
    lines: [
      { in: "Добрый вечер" },
      { bot: greet("Нурлан"), step: "greet" },
      { log: "waiting", step: "wait_need" },
      { in: "4" },
      { bot: offer("Нурлан"), step: "offer" },
      { log: "waiting", step: "wait_answer" },
      { in: "Сначала хочу узнать цену и есть ли рассрочка" },
      { log: "handoff", text: "Пациенту нужен ответ администратора" },
    ],
  });
  const handoffTask: Task = {
    id: nextId(db.tasks),
    deal_id: handed.deal.id,
    type: "message",
    text: "Ответить пациенту: бот передал диалог",
    due_date: handed.session.updated_at,
    done_date: null,
    sales_id: manager.id,
  } as Task;
  db.tasks.push(handoffTask);
  db.notifications.push({
    id: nextId(db.notifications),
    sales_id: manager.id,
    kind: "bot_handoff",
    title: "Бот передал диалог",
    body: "Абенов Нурлан: Пациенту нужен ответ администратора",
    deal_id: handed.deal.id,
    patient_id: handed.patient.id,
    task_id: handoffTask.id,
    message_count: 1,
    created_at: handed.session.updated_at,
    updated_at: handed.session.updated_at,
    read_at: null,
  } as CrmNotification);

  // Booked: pain, «да» → «Записан» and a task for the admin
  const booked = conversation({
    firstName: "Алия",
    lastName: "Муратова",
    phone: "+7 747 902 18 64",
    minutesAgo: (2 * DAY) / MINUTE,
    stage: "Записан",
    tags: ["Боль"],
    status: "done",
    currentStep: null,
    lines: [
      { in: "Здравствуйте, болит зуб справа" },
      { bot: greet("Алия"), step: "greet" },
      { log: "waiting", step: "wait_need" },
      { in: "1" },
      { log: "set", step: "pain" },
      { bot: offer("Алия"), step: "offer" },
      { log: "waiting", step: "wait_answer" },
      { in: "Да, запишите" },
      { log: "set", step: "book" },
      { log: "task", step: "book_task" },
      {
        bot: stepText("thanks")("Алия"),
        step: "thanks",
      },
      { log: "done" },
    ],
  });
  db.deal_events.push({
    id: nextId(db.deal_events),
    deal_id: booked.deal.id,
    type: "stage_changed",
    from_stage_id: stageNamed("Новый лид").id,
    to_stage_id: stageNamed("Записан").id,
    changes: {},
    sales_id: null,
    created_at: booked.session.updated_at,
  });
  booked.deal.stage_changed_at = booked.session.updated_at;
  db.tasks.push({
    id: nextId(db.tasks),
    deal_id: booked.deal.id,
    type: "call",
    text: "Бот: пациент хочет на консультацию — подобрать время и записать",
    due_date: at(2 * 24 * 60 - 40),
    done_date: null,
    sales_id: manager.id,
  } as Task);
};
