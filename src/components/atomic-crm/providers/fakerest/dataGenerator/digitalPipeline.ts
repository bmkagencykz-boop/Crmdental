import type {
  ApiKey,
  StageTrigger,
  StageTriggerRun,
  Webhook,
  WebhookDelivery,
} from "../../../pipeline-automation/types";
import type { Db } from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const noConditions = {
  source_ids: [],
  service_ids: [],
  doctor_ids: [],
  sales_ids: [],
  tags_present: [],
  tags_absent: [],
};

/**
 * Digital pipeline of the demo clinic (stage 20): a few triggers on the main
 * pipeline, their runs in the feed of some deals, one webhook to a MIS with
 * its recent deliveries, and one API key of the clinic's website.
 */
export const generateDigitalPipeline = (db: Db) => {
  const now = Date.now();
  const iso = (time: number) => new Date(time).toISOString();
  const owner = db.sales.find((sale) => sale.role === "owner") ?? db.sales[0];

  const trigger = (
    data: Partial<StageTrigger> &
      Pick<StageTrigger, "id" | "stage_id" | "event" | "action">,
  ): StageTrigger => ({
    pipeline_id: 1,
    name: null,
    delay_minutes: 0,
    is_active: true,
    position: 0,
    created_at: iso(now - 60 * DAY),
    ...noConditions,
    ...data,
  });

  db.webhooks = [
    {
      id: 1,
      name: "МИС клиники",
      url: "https://mis.zhemchug-dental.kz/webhooks/dentalcrm",
      events: [
        "deal.created",
        "deal.stage_changed",
        "deal.won",
        "payment.added",
      ],
      secret:
        "7c1e9a2f4b8d4e0fa3c5b7d9e1f20a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f",
      is_active: true,
      failure_count: 0,
      last_error: null,
      last_success_at: iso(now - 2 * HOUR),
      last_failure_at: iso(now - 6 * DAY),
      disabled_at: null,
      created_at: iso(now - 45 * DAY),
    } satisfies Webhook,
  ];

  db.stage_triggers = [
    trigger({
      id: 1,
      stage_id: 1,
      name: "Пациент ответил",
      event: "message_in",
      action: "move_stage",
      target_stage_id: 2,
    }),
    trigger({
      id: 2,
      stage_id: 1,
      name: "Нет активности 2 часа",
      event: "idle",
      delay_minutes: 120,
      action: "create_task",
      task_type: "call",
      task_text: "Напомнить о себе пациенту",
      task_due_minutes: 0,
      position: 1,
    }),
    trigger({
      id: 3,
      stage_id: 3,
      name: "Подтвердить запись",
      event: "appointment_set",
      action: "create_task",
      task_type: "call",
      task_text: "Подтвердить визит пациента",
      task_due_minutes: 60,
    }),
    trigger({
      id: 4,
      stage_id: 3,
      name: "Визит прошёл",
      event: "visit_passed",
      delay_minutes: 120,
      action: "create_task",
      task_type: "reminder",
      task_text: "Отметить, пришёл ли пациент на консультацию",
      task_due_minutes: 0,
    }),
    trigger({
      id: 5,
      stage_id: 5,
      name: "Оплата получена",
      event: "payment_added",
      action: "move_stage",
      target_stage_id: 6,
    }),
    trigger({
      id: 6,
      stage_id: 1,
      name: "VIP — руководителю",
      event: "stage_entered",
      action: "set_responsible",
      target_sales_id: owner?.id ?? null,
      tags_present: [0],
      position: 2,
    }),
    trigger({
      id: 7,
      stage_id: 7,
      name: "Передать в МИС",
      event: "stage_entered",
      action: "send_webhook",
      webhook_id: 1,
    }),
  ];

  // Runs: the deals moved on their own, visible in their feed
  const runs: StageTriggerRun[] = [];
  const moved = (stageId: number, count: number) =>
    db.deals
      .filter((deal) => deal.stage_id === stageId && !deal.archived_at)
      .slice(0, count);
  for (const deal of moved(2, 4)) {
    runs.push({
      id: runs.length + 1,
      deal_id: deal.id,
      trigger_id: 1,
      trigger_name: "Пациент ответил",
      event: "message_in",
      event_key: `message:demo-${deal.id}`,
      action: "move_stage",
      status: "done",
      details: { from_stage_id: 1, to_stage_id: 2 },
      error: null,
      created_at: deal.stage_changed_at ?? deal.updated_at,
    });
  }
  for (const deal of moved(6, 3)) {
    runs.push({
      id: runs.length + 1,
      deal_id: deal.id,
      trigger_id: 5,
      trigger_name: "Оплата получена",
      event: "payment_added",
      event_key: `payment:demo-${deal.id}`,
      action: "move_stage",
      status: "done",
      details: { from_stage_id: 5, to_stage_id: 6 },
      error: null,
      created_at: deal.stage_changed_at ?? deal.updated_at,
    });
  }
  db.stage_trigger_runs = runs;

  // Deliveries of the MIS webhook: recent events, one that never got through
  const recent = [...db.deals]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 6);
  const deliveries: WebhookDelivery[] = recent.map((deal, index) => {
    const event = index % 2 === 0 ? "deal.stage_changed" : "deal.created";
    const at = now - (index + 1) * 3 * HOUR;
    return {
      id: index + 1,
      webhook_id: 1,
      event,
      payload: {
        event,
        occurred_at: iso(at),
        organization_id: 1,
        data: {
          deal_id: deal.id,
          patient_id: deal.patient_id,
          deal: {
            id: deal.id,
            name: deal.name,
            stage_id: deal.stage_id,
            plan_amount: deal.plan_amount,
          },
        },
      },
      status: "delivered",
      attempts: index === 2 ? 2 : 1,
      next_attempt_at: iso(at),
      response_status: 200,
      error: null,
      delivered_at: iso(at + (index === 2 ? 60_000 : 400)),
      created_at: iso(at),
    };
  });
  const lost = recent[recent.length - 1];
  if (lost) {
    deliveries.push({
      id: deliveries.length + 1,
      webhook_id: 1,
      event: "payment.added",
      payload: {
        event: "payment.added",
        occurred_at: iso(now - 6 * DAY),
        organization_id: 1,
        data: { deal_id: lost.id, patient_id: lost.patient_id },
      },
      status: "failed",
      attempts: 5,
      next_attempt_at: iso(now - 5 * DAY),
      response_status: 502,
      error: "HTTP 502",
      delivered_at: null,
      created_at: iso(now - 6 * DAY),
    });
  }
  db.webhook_deliveries = deliveries;

  db.api_keys = [
    {
      id: 1,
      name: "Сайт клиники",
      prefix: "dcrm_3f9a1c2",
      scope: "write",
      created_by: owner?.id ?? null,
      created_at: iso(now - 30 * DAY),
      last_used_at: iso(now - 5 * HOUR),
      revoked_at: null,
    } satisfies ApiKey,
  ];
};
