import { PORTABLE_FORMAT, type PortableBot } from "./portable";

/**
 * Ready bots of the gallery (portable form: stages, tags and services by
 * name). Created inactive; the clinic reads them through, then switches
 * them on.
 */
export const BOT_TEMPLATES: { id: string; bot: PortableBot }[] = [
  {
    id: "consultation",
    bot: {
      format: PORTABLE_FORMAT,
      version: 1,
      name: "Первичная консультация",
      description:
        "Приветствует новую заявку, узнаёт, что беспокоит, ставит тег и услугу, предлагает записаться. Согласие — этап «Записан» и задача администратору, иначе диалог переходит к сотруднику.",
      triggers: {
        new_lead: true,
        transports: ["whatsapp"],
        keywords: [],
        sources: [],
      },
      scenario: {
        start: "greet",
        steps: [
          {
            id: "greet",
            type: "send_message",
            text: "Здравствуйте, {имя}! Это {клиника}. Подскажите, пожалуйста, что вас беспокоит? Ответьте цифрой:",
            buttons: ["Боль", "Имплантация", "Брекеты", "Другое"],
            next: "wait_need",
          },
          {
            id: "wait_need",
            type: "wait_reply",
            timeout_minutes: 60,
            next: "need",
            timeout_next: "handoff",
          },
          {
            id: "need",
            type: "condition",
            branches: [
              { match: "option", value: "1", next: "pain" },
              { match: "keywords", value: "боль, болит, ноет", next: "pain" },
              { match: "option", value: "2", next: "implant" },
              {
                match: "keywords",
                value: "имплант, имплантация",
                next: "implant",
              },
              { match: "option", value: "3", next: "braces" },
              {
                match: "keywords",
                value: "брекеты, элайнеры, прикус",
                next: "braces",
              },
            ],
            else_next: "offer",
          },
          {
            id: "pain",
            type: "set",
            actions: [{ kind: "tag_add", tag_name: "Боль" }],
            next: "offer",
          },
          {
            id: "implant",
            type: "set",
            actions: [
              { kind: "tag_add", tag_name: "Имплантация" },
              {
                kind: "deal_field",
                field: "service_id",
                value_name: "Имплантация",
              },
            ],
            next: "offer",
          },
          {
            id: "braces",
            type: "set",
            actions: [
              { kind: "tag_add", tag_name: "Брекеты" },
              {
                kind: "deal_field",
                field: "service_id",
                value_name: "Ортодонтия",
              },
            ],
            next: "offer",
          },
          {
            id: "offer",
            type: "send_message",
            text: "Спасибо! Лучше всего разобраться на консультации у врача. Записать вас?",
            buttons: ["Да, запишите", "Нет, пока нет"],
            next: "wait_answer",
          },
          {
            id: "wait_answer",
            type: "wait_reply",
            timeout_minutes: 120,
            next: "answer",
            timeout_next: "handoff",
          },
          {
            id: "answer",
            type: "condition",
            branches: [
              { match: "option", value: "1", next: "book" },
              {
                match: "keywords",
                value: "да, давайте, хочу, запишите",
                next: "book",
              },
            ],
            else_next: "handoff",
          },
          {
            id: "book",
            type: "set",
            actions: [{ kind: "stage", stage_name: "Записан" }],
            next: "book_task",
          },
          {
            id: "book_task",
            type: "create_task",
            task_type: "call",
            text: "Бот: пациент хочет на консультацию — подобрать время и записать",
            due_minutes: 15,
            next: "thanks",
          },
          {
            id: "thanks",
            type: "send_message",
            text: "Отлично! Администратор свяжется с вами в ближайшее время и подберёт удобное время.",
            next: null,
          },
          {
            id: "handoff",
            type: "handoff",
            text: "Пациенту нужен ответ администратора",
            create_task: true,
            task_text: "Ответить пациенту: бот передал диалог",
          },
        ],
      },
    },
  },
  {
    id: "reactivation",
    bot: {
      format: PORTABLE_FORMAT,
      version: 1,
      name: "Реактивация отказа",
      description:
        "Спрашивает пациента, актуален ли ещё вопрос. «Да» — этап «В работе» и передача сотруднику, «нет» — бот завершается. Запускайте вручную или цифровой воронкой.",
      triggers: { new_lead: false, transports: [], keywords: [], sources: [] },
      scenario: {
        start: "ask",
        steps: [
          {
            id: "ask",
            type: "send_message",
            text: "Здравствуйте, {имя}! Это {клиника}. Вы обращались к нам недавно — вопрос ещё актуален?",
            buttons: ["Да, актуально", "Нет"],
            next: "wait",
          },
          {
            id: "wait",
            type: "wait_reply",
            timeout_minutes: 1440,
            next: "answer",
            timeout_next: "end",
          },
          {
            id: "answer",
            type: "condition",
            branches: [
              { match: "option", value: "1", next: "yes" },
              { match: "option", value: "2", next: "no" },
              {
                match: "keywords",
                value: "нет, неактуально, не нужно",
                next: "no",
              },
              { match: "keywords", value: "да, актуально, хочу", next: "yes" },
            ],
            else_next: "handoff",
          },
          {
            id: "yes",
            type: "set",
            actions: [{ kind: "stage", stage_name: "В работе" }],
            next: "handoff",
          },
          {
            id: "handoff",
            type: "handoff",
            text: "Пациент ответил на реактивацию",
            create_task: true,
            task_text: "Связаться с пациентом: он ответил на реактивацию",
          },
          {
            id: "no",
            type: "send_message",
            text: "Спасибо за ответ! Если понадобится помощь — просто напишите нам.",
            next: "end",
          },
          { id: "end", type: "stop" },
        ],
      },
    },
  },
];
