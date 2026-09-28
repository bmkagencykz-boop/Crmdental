import type { Identifier } from "ra-core";

import type {
  Automessage,
  AutomessageRule,
  CustomField,
  Deal,
  MessageTemplate,
} from "../../types";
import { customFieldVars } from "../../custom-fields/customFields";

/**
 * Automatic messages (stage 6): the same rules as the database
 * (supabase/schemas/08_automessages.sql), for the settings preview and the
 * demo data provider.
 */

export const DEFAULT_TIME_ZONE = "Asia/Almaty";

/** Variables of the templates, in the order shown to the user */
export const TEMPLATE_VARIABLES = [
  "имя",
  "услуга",
  "дата_визита",
  "клиника",
  "врач",
  "сумма_плана",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
/** The variables, plus {поле:Название} of the custom fields (stage 19) */
export type TemplateValues = Partial<
  Record<TemplateVariable, string | null | undefined>
> &
  Record<string, string | null | undefined>;

/**
 * Replaces {variable} with its value (a missing value gives an empty string)
 * and collapses the spaces left behind. Same as private.render_template.
 */
export const renderTemplate = (body: string, values: TemplateValues) => {
  let result = body ?? "";
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{${key}}`).join(value ?? "");
  }
  return result
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/^[ \n]+|[ \n]+$/g, "");
};

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** Wall clock of a moment in a time zone */
export const wallClock = (date: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
  };
};

/** "12 марта в 14:30" in the clinic time zone. Same as private.format_visit_date */
export const formatVisitDate = (
  value: string | Date | null | undefined,
  timeZone = DEFAULT_TIME_ZONE,
) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const wall = wallClock(date, timeZone || DEFAULT_TIME_ZONE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${wall.day} ${MONTHS[wall.month - 1]} в ${pad(wall.hour)}:${pad(wall.minute)}`;
};

/** The moment a wall clock time of a time zone happens */
export const fromWallClock = (
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
) => {
  const target = Date.UTC(year, month - 1, day, hour);
  let guess = target;
  // Two passes are enough outside of the (skipped) DST transition hours
  for (let i = 0; i < 2; i++) {
    const wall = wallClock(new Date(guess), timeZone);
    const shown = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    guess += target - shown;
  }
  return new Date(guess);
};

export const QUIET_HOURS = { start: 21, end: 9 };

/**
 * Nothing is sent between 21:00 and 9:00 of the clinic: a send time outside
 * 9:00-21:00 moves to the next 9:00. Same as private.automessage_send_time.
 */
export const automessageSendTime = (
  sendAt: Date,
  timeZone = DEFAULT_TIME_ZONE,
) => {
  const zone = timeZone || DEFAULT_TIME_ZONE;
  const wall = wallClock(sendAt, zone);
  if (wall.hour >= QUIET_HOURS.end && wall.hour < QUIET_HOURS.start) {
    return sendAt;
  }
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  if (wall.hour >= QUIET_HOURS.start) day.setUTCDate(day.getUTCDate() + 1);
  return fromWallClock(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    QUIET_HOURS.end,
    zone,
  );
};

/**
 * Messages queued when a deal enters its stage (onlyTiming: only the rules
 * of this timing, when the visit moves). Same as private.schedule_automessages.
 */
export const scheduleAutomessages = ({
  deal,
  rules,
  onlyTiming,
  timeZone = DEFAULT_TIME_ZONE,
  now = new Date(),
}: {
  deal: Pick<Deal, "id" | "stage_id" | "appointment_at" | "archived_at">;
  rules: AutomessageRule[];
  onlyTiming?: AutomessageRule["timing"];
  timeZone?: string;
  now?: Date;
}): Omit<Automessage, "id">[] => {
  if (deal.archived_at) return [];
  const visit = deal.appointment_at ? new Date(deal.appointment_at) : null;
  return rules
    .filter(
      (rule) =>
        rule.is_active &&
        String(rule.stage_id) === String(deal.stage_id) &&
        (!onlyTiming || rule.timing === onlyTiming),
    )
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id))
    .flatMap((rule) => {
      const offset = rule.offset_minutes * 60 * 1000;
      let at: Date;
      if (rule.timing === "after_stage") {
        at = new Date(now.getTime() + offset);
      } else {
        if (!visit || visit <= now) return [];
        at = new Date(Math.max(visit.getTime() - offset, now.getTime()));
      }
      const sendAt = automessageSendTime(at, timeZone);
      if (rule.timing === "before_visit" && visit && sendAt >= visit) {
        return [];
      }
      return [
        {
          deal_id: deal.id,
          rule_id: rule.id,
          stage_id: rule.stage_id,
          timing: rule.timing,
          send_at: sendAt.toISOString(),
          status: "pending" as const,
          text: null,
          error: null,
          processed_at: null,
          created_at: now.toISOString(),
        },
      ];
    });
};

/**
 * {сумма_плана}: the plan amount of the deal (the total of its agreed
 * treatment plan, stage 29) as "577 090 ₸", nothing when there is none
 */
export const formatPlanSum = (amount: number | null | undefined) =>
  amount != null && amount > 0
    ? `${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`
    : null;

/** Values of the variables for a deal. Same as private.automessage_vars */
export const automessageValues = ({
  deal,
  patientFirstName,
  serviceName,
  clinicName,
  doctorName,
  customFields = [],
  timeZone = DEFAULT_TIME_ZONE,
}: {
  deal: Pick<Deal, "appointment_at" | "visit_at" | "custom_values"> &
    Partial<Pick<Deal, "plan_amount">>;
  patientFirstName?: string | null;
  serviceName?: string | null;
  clinicName?: string | null;
  /** Name of the deal's doctor (stage 13) */
  doctorName?: string | null;
  /** Custom fields of the clinic: {поле:Название} (stage 19) */
  customFields?: CustomField[];
  timeZone?: string;
}): TemplateValues => ({
  имя: patientFirstName?.trim() || null,
  услуга: serviceName ?? null,
  дата_визита: formatVisitDate(deal.appointment_at ?? deal.visit_at, timeZone),
  клиника: clinicName ?? null,
  врач: doctorName?.trim() || null,
  сумма_плана: formatPlanSum(deal.plan_amount),
  ...customFieldVars(customFields, "deal", deal.custom_values, timeZone),
});

/** Sample values for the live preview of the settings */
export const previewValues = (clinicName?: string | null): TemplateValues => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 30, 0, 0);
  return {
    имя: "Асель",
    услуга: "Имплантация",
    дата_визита: formatVisitDate(
      tomorrow,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    клиника: clinicName || "Клиника",
    врач: "Ахметова Айгуль",
    сумма_плана: formatPlanSum(577090),
  };
};

/** A queued message still waiting (it can be cancelled) */
export const isAutomessageOpen = (automessage: Pick<Automessage, "status">) =>
  automessage.status === "pending" || automessage.status === "awaiting";

/** The template of a rule, when it still exists */
export const ruleTemplate = (
  rule: Pick<AutomessageRule, "template_id"> | undefined,
  templates: MessageTemplate[],
) =>
  rule
    ? templates.find((t) => String(t.id) === String(rule.template_id))
    : undefined;

export const sameId = (a: Identifier | null | undefined, b: Identifier) =>
  a != null && String(a) === String(b);
