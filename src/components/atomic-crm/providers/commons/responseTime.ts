import type { Identifier } from "ra-core";

import type {
  Deal,
  DealWaiting,
  Message,
  OrganizationSettings,
  Patient,
  Stage,
} from "../../types";
import { DEFAULT_TIME_ZONE, fromWallClock, wallClock } from "./automessages";

/**
 * Response-time control (stage 16): the same rules as the database
 * (supabase/schemas/16_notifications.sql), for the demo data provider and
 * the settings.
 */

export const DEFAULT_RESPONSE_SETTINGS = {
  response_control_enabled: true,
  response_limit_minutes: 15,
  response_hours_start: 9,
  response_hours_end: 21,
  response_alert_responsible: true,
  response_alert_managers: true,
  response_alert_sales_ids: [] as Identifier[],
} satisfies Partial<OrganizationSettings>;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * Minutes between two moments that fall within the working hours of the
 * clinic (hoursStart:00 to hoursEnd:00 every day, in its time zone). Same as
 * private.working_minutes.
 */
export const workingMinutes = (
  from: Date,
  to: Date,
  timeZone: string | null | undefined = DEFAULT_TIME_ZONE,
  hoursStart = 9,
  hoursEnd = 21,
) => {
  if (!(from < to)) return 0;
  const zone = timeZone || DEFAULT_TIME_ZONE;
  const first = wallClock(from, zone);
  const last = wallClock(to, zone);
  const lastDay = Date.UTC(last.year, last.month - 1, last.day);
  let total = 0;
  for (
    let day = Date.UTC(first.year, first.month - 1, first.day);
    day <= lastDay;
    day += DAY
  ) {
    const date = new Date(day);
    const [y, m, d] = [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    ];
    const start = fromWallClock(y, m, d, hoursStart, zone).getTime();
    const end = fromWallClock(y, m, d, hoursEnd, zone).getTime();
    total += Math.max(
      0,
      Math.min(to.getTime(), end) - Math.max(from.getTime(), start),
    );
  }
  return Math.floor(total / MINUTE);
};

/** An answer of the clinic: not an automatic message */
const isAnswer = (
  message: Pick<Message, "direction" | "sales_id" | "automessage_id">,
) =>
  message.direction === "out" &&
  (message.automessage_id == null || message.sales_id != null);

/**
 * Since when the patient waits for an answer: the first inbound message
 * after the last answer of the clinic (null: nobody waits). Same as
 * private.deal_waiting_since.
 */
export const waitingSince = (
  messages: Pick<
    Message,
    "direction" | "sales_id" | "automessage_id" | "sent_at"
  >[],
) => {
  const time = (message: { sent_at: string }) =>
    new Date(message.sent_at).getTime();
  const lastAnswer = Math.max(
    -Infinity,
    ...messages.filter(isAnswer).map(time),
  );
  const waiting = messages
    .filter(
      (message) => message.direction === "in" && time(message) > lastAnswer,
    )
    .sort((a, b) => time(a) - time(b));
  return waiting[0]?.sent_at ?? null;
};

/**
 * Rows of the view deals_waiting: open deals whose patient waits, with the
 * working minutes waited and whether the limit is reached.
 */
export const dealsWaiting = ({
  deals,
  stages,
  patients,
  messages,
  settings,
  timeZone = DEFAULT_TIME_ZONE,
  now = new Date(),
}: {
  deals: Deal[];
  stages: Pick<Stage, "id" | "kind">[];
  patients: Patient[];
  messages: Message[];
  settings?: Partial<OrganizationSettings> | null;
  timeZone?: string;
  now?: Date;
}): DealWaiting[] => {
  const config = { ...DEFAULT_RESPONSE_SETTINGS, ...settings };
  if (!config.response_control_enabled) return [];
  const open = new Set(
    stages.filter((stage) => stage.kind === "open").map((s) => String(s.id)),
  );
  const byDeal = new Map<string, Message[]>();
  for (const message of messages) {
    const key = String(message.deal_id);
    byDeal.set(key, [...(byDeal.get(key) ?? []), message]);
  }
  return deals.flatMap((deal) => {
    // An unsorted lead (stage 18) gets no response alert
    if (
      deal.archived_at ||
      deal.unsorted_at ||
      !open.has(String(deal.stage_id))
    )
      return [];
    const since = waitingSince(byDeal.get(String(deal.id)) ?? []);
    if (!since) return [];
    const patient = patients.find(
      (p) => String(p.id) === String(deal.patient_id),
    );
    const minutes = workingMinutes(
      new Date(since),
      now,
      timeZone,
      config.response_hours_start,
      config.response_hours_end,
    );
    return [
      {
        id: deal.id,
        patient_id: deal.patient_id,
        pipeline_id: deal.pipeline_id,
        stage_id: deal.stage_id,
        sales_id: deal.sales_id ?? null,
        name: deal.name ?? null,
        patient_first_name: patient?.first_name ?? null,
        patient_last_name: patient?.last_name ?? null,
        patient_phone: patient?.phones?.[0] ?? null,
        waiting_since: since,
        waiting_minutes: minutes,
        limit_minutes: config.response_limit_minutes,
        overdue: minutes >= config.response_limit_minutes,
      },
    ];
  });
};

/**
 * Quick filter «Ждут ответа» of the deals: the filter key the lists use,
 * turned by the data providers into a filter on the ids of the overdue deals.
 */
export const WAITING_FILTER = "waiting_response";

export const applyWaitingFilter = <
  Params extends { filter?: Record<string, any> },
>(
  params: Params,
  waitingIds: Identifier[],
): Params => {
  if (!params.filter?.[WAITING_FILTER]) return params;
  const { [WAITING_FILTER]: _, ...filter } = params.filter;
  return {
    ...params,
    filter: { ...filter, "id@in": `(${waitingIds.join(",")})` },
  };
};

/** "5 мин", "1 ч 5 мин": hours and minutes of a wait */
export const splitMinutes = (minutes: number) => ({
  hours: Math.floor(minutes / 60),
  minutes: minutes % 60,
});
