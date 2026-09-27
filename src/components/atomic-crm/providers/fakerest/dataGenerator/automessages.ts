import {
  automessageValues,
  renderTemplate,
  scheduleAutomessages,
} from "../../commons/automessages";
import type { Db } from "./types";

export const DEMO_CLINIC_NAME = "Демо-клиника «Жемчуг»";

/**
 * Same defaults as private.seed_automessages, plus what the demo shows: the
 * reminders queued for the booked deals and a greeting waiting for the
 * employee (a task with the «Отправить» button). Stage scripts too.
 */
export const generateAutomessages = (db: Db) => {
  db.message_templates = [
    {
      id: 1,
      name: "Напоминание о визите",
      body: "Здравствуйте, {имя}! Напоминаем, что вы записаны в {клиника} на {дата_визита}. Если планы изменились, напишите нам, пожалуйста.",
      position: 0,
    },
    {
      id: 2,
      name: "Возврат после отказа",
      body: "Здравствуйте, {имя}! Это {клиника}. Вы обращались к нам недавно. Вопрос ещё актуален? Будем рады помочь и подобрать удобное время.",
      position: 1,
    },
    {
      id: 3,
      name: "Приветствие",
      body: "Здравствуйте, {имя}! Спасибо за обращение в {клиника}. Подскажите, пожалуйста, что вас беспокоит и когда вам удобно прийти на консультацию?",
      position: 2,
    },
  ];
  db.automessage_rules = [
    {
      id: 1,
      stage_id: 3,
      template_id: 1,
      timing: "before_visit",
      offset_minutes: 24 * 60,
      mode: "auto",
      is_active: true,
      position: 0,
    },
    {
      id: 2,
      stage_id: 8,
      template_id: 2,
      timing: "after_stage",
      offset_minutes: 30 * 24 * 60,
      mode: "confirm",
      is_active: false,
      position: 1,
    },
    {
      id: 3,
      stage_id: 1,
      template_id: 3,
      timing: "after_stage",
      offset_minutes: 0,
      mode: "confirm",
      is_active: false,
      position: 2,
    },
  ];

  // Stage scripts of the main pipeline
  const scripts: Record<number, string> = {
    1: "Поздоровайтесь и представьтесь.\nУточните, что беспокоит и как давно.\nПредложите консультацию и два варианта времени.",
    3: "Напомните адрес и как добраться.\nПопросите взять снимки, если они есть.\nПредупредите, что консультация бесплатная.",
    4: "Спросите, всё ли было понятно на консультации.\nОзвучьте план и стоимость, предложите рассрочку.\nДоговоритесь о дате начала лечения.",
  };
  db.stages = db.stages.map((stage) => ({
    ...stage,
    script: scripts[Number(stage.id)] ?? null,
  }));

  db.automessages = [];
  const now = new Date();
  // Booked deals with a visit ahead: their reminder is queued
  for (const deal of db.deals.filter((d) => d.stage_id === 3)) {
    for (const job of scheduleAutomessages({
      deal,
      rules: db.automessage_rules,
      now,
    })) {
      db.automessages.push({ ...job, id: db.automessages.length + 1 });
    }
  }

  // The newest lead: a greeting waiting for the employee
  const lead = [...db.deals]
    .filter((d) => d.stage_id === 1 && !d.archived_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (lead) {
    const patient = db.patients.find((p) => p.id === lead.patient_id);
    const text = renderTemplate(
      db.message_templates[2].body,
      automessageValues({
        deal: lead,
        patientFirstName: patient?.first_name,
        clinicName: DEMO_CLINIC_NAME,
      }),
    );
    const id = db.automessages.length + 1;
    db.automessages.push({
      id,
      deal_id: lead.id,
      rule_id: 3,
      stage_id: 1,
      timing: "after_stage",
      send_at: lead.created_at,
      status: "awaiting",
      text,
      error: null,
      processed_at: lead.created_at,
      created_at: lead.created_at,
    });
    db.tasks.push({
      id: Math.max(-1, ...db.tasks.map((t) => Number(t.id))) + 1,
      deal_id: lead.id,
      type: "message",
      text,
      due_date: lead.created_at,
      done_date: null,
      sales_id: lead.sales_id ?? undefined,
      automessage_id: id,
    });
  }
};
