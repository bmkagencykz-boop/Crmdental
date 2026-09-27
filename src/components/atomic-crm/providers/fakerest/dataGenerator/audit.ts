import { random } from "faker/locale/en_US";

import type { AuditLogEntry, Deal } from "../../../types";
import type { Db } from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Row = Omit<AuditLogEntry, "id">;

/**
 * The demo clinic's audit log, consistent with its data: the same rows the
 * database triggers would have written (supabase/schemas/15_audit.sql) for
 * the deals' history, payments, tasks, patients, the staff and the settings.
 */
export const generateAuditLog = (db: Db) => {
  const now = Date.now();
  const rows: Row[] = [];
  const owner = db.sales.find((sale) => sale.role === "owner") ?? db.sales[0];
  const managers = db.sales.filter((sale) => sale.id !== owner.id);
  const iso = (time: number) => new Date(time).toISOString();
  const dealsById = new Map(db.deals.map((deal) => [deal.id, deal]));
  const actor = (salesId: unknown, source = "webhook") =>
    salesId != null
      ? { sales_id: salesId as number, source: "user" }
      : { sales_id: null, source };
  const ofDeal = (deal: Deal) => ({
    deal_id: deal.id,
    patient_id: deal.patient_id,
  });

  // Clinic set-up: the owner invites the staff, connects the messengers,
  // configures the pipelines and the automations
  const setUp = now - 130 * DAY;
  rows.push({
    at: iso(setUp),
    ...actor(owner.id),
    entity: "employee",
    entity_id: owner.id,
    action: "create",
    changes: {
      first_name: [null, owner.first_name],
      last_name: [null, owner.last_name],
      role: [null, "owner"],
    },
  });
  managers.forEach((sale, index) =>
    rows.push({
      at: iso(setUp + (index + 1) * HOUR),
      ...actor(owner.id),
      entity: "employee",
      entity_id: sale.id,
      action: "invite",
      changes: {
        first_name: [null, sale.first_name],
        last_name: [null, sale.last_name],
        email: [null, sale.email],
        role: [null, "manager"],
      },
    }),
  );
  if (managers[0]) {
    rows.push(
      {
        at: iso(setUp + 20 * DAY),
        ...actor(owner.id),
        entity: "employee",
        entity_id: managers[0].id,
        action: "disable",
        changes: { disabled: [false, true] },
      },
      {
        at: iso(setUp + 21 * DAY),
        ...actor(owner.id),
        entity: "employee",
        entity_id: managers[0].id,
        action: "enable",
        changes: { disabled: [true, false] },
      },
    );
  }
  rows.push({
    at: iso(setUp + 2 * DAY),
    ...actor(owner.id),
    entity: "messenger",
    entity_id: null,
    action: "connect",
    changes: { provider: [null, "wazzup"], connected: [false, true] },
  });
  const orthodontics = db.pipelines.find((p) => !p.is_default);
  if (orthodontics) {
    rows.push({
      at: iso(setUp + 3 * DAY),
      ...actor(owner.id),
      entity: "pipeline",
      entity_id: orthodontics.id,
      action: "create",
      changes: { name: [null, orthodontics.name] },
    });
    db.stages
      .filter((stage) => stage.pipeline_id === orthodontics.id)
      .forEach((stage) =>
        rows.push({
          at: iso(setUp + 3 * DAY + (stage.position + 1) * 60 * 1000),
          ...actor(owner.id),
          entity: "stage",
          entity_id: stage.id,
          action: "create",
          changes: {
            pipeline_id: [null, orthodontics.id],
            name: [null, stage.name],
            kind: [null, stage.kind],
            position: [null, stage.position],
          },
        }),
      );
  }
  const settings = db.organization_settings[0];
  if (settings) {
    rows.push({
      at: iso(setUp + 4 * DAY),
      ...actor(owner.id),
      entity: "settings",
      entity_id: null,
      action: "update",
      changes: { lead_distribution: ["off", settings.lead_distribution] },
    });
  }
  db.stage_checklist_items.forEach((item, index) =>
    rows.push({
      at: iso(setUp + 5 * DAY + index * 60 * 1000),
      ...actor(owner.id),
      entity: "checklist_item",
      entity_id: item.id,
      action: "create",
      changes: { stage_id: [null, item.stage_id], text: [null, item.text] },
    }),
  );
  const rule = db.task_rules[0];
  if (rule) {
    rows.push({
      at: iso(setUp + 6 * DAY),
      ...actor(owner.id),
      entity: "task_rule",
      entity_id: rule.id,
      action: "update",
      changes: {
        due_in_minutes: [60, rule.due_in_minutes],
        text: ["Позвонить пациенту", rule.text],
      },
    });
  }

  // Patients: created with the first request, some edited afterwards
  db.patients.forEach((patient) => {
    const first = new Date(patient.first_seen).getTime();
    rows.push({
      at: patient.first_seen,
      ...actor(patient.sales_id),
      entity: "patient",
      entity_id: patient.id,
      action: "create",
      changes: {
        last_name: [null, patient.last_name ?? null],
        first_name: [null, patient.first_name ?? null],
        phones: [null, patient.phones ?? []],
        ...(patient.sales_id != null
          ? { sales_id: [null, patient.sales_id] }
          : {}),
      },
      deal_id: null,
      patient_id: patient.id,
    });
    if (random.number(9) < 2 && patient.tags.length) {
      rows.push({
        at: iso(Math.min(now - HOUR, first + 3 * DAY)),
        ...actor(patient.sales_id),
        entity: "patient",
        entity_id: patient.id,
        action: "update",
        changes: { tags: [[], patient.tags] },
        deal_id: null,
        patient_id: patient.id,
      });
    }
  });

  // Deals: their history (deal_events), amount and responsible changes,
  // refusals with their reason, archiving
  const events = [...db.deal_events].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  events.forEach((event) => {
    const deal = dealsById.get(event.deal_id);
    if (!deal) return;
    const stage = db.stages.find((s) => s.id === event.to_stage_id);
    if (event.type === "created") {
      rows.push({
        at: event.created_at,
        ...actor(event.sales_id),
        entity: "deal",
        entity_id: deal.id,
        action: "create",
        changes: {
          name: [null, deal.name ?? null],
          pipeline_id: [null, deal.pipeline_id],
          stage_id: [null, event.to_stage_id],
          ...(deal.sales_id != null ? { sales_id: [null, deal.sales_id] } : {}),
          source_id: [null, deal.source_id ?? null],
          service_id: [null, deal.service_id ?? null],
        },
        ...ofDeal(deal),
      });
      return;
    }
    rows.push({
      at: event.created_at,
      ...actor(event.sales_id),
      entity: "deal",
      entity_id: deal.id,
      action: "stage_change",
      changes: {
        stage_id: [event.from_stage_id ?? null, event.to_stage_id ?? null],
        ...(stage?.kind === "lost" && deal.lost_reason_id != null
          ? { lost_reason_id: [null, deal.lost_reason_id] }
          : {}),
      },
      ...ofDeal(deal),
    });
  });
  db.deals.forEach((deal) => {
    const created = new Date(deal.created_at).getTime();
    const span = Math.max(HOUR, now - created);
    if (deal.plan_amount > 0 && random.number(9) < 4) {
      const before = Math.round((deal.plan_amount * 0.8) / 1000) * 1000;
      rows.push({
        at: iso(created + span * 0.4),
        ...actor(deal.sales_id ?? owner.id),
        entity: "deal",
        entity_id: deal.id,
        action: "update",
        changes: { plan_amount: [before, deal.plan_amount] },
        ...ofDeal(deal),
      });
    }
    if (deal.sales_id != null && random.number(9) < 2) {
      const previous = random.arrayElement(
        managers.filter((sale) => sale.id !== deal.sales_id),
      );
      if (previous) {
        rows.push({
          at: iso(created + span * 0.2),
          ...actor(owner.id),
          entity: "deal",
          entity_id: deal.id,
          action: "update",
          changes: { sales_id: [previous.id, deal.sales_id] },
          ...ofDeal(deal),
        });
      }
    }
    if (deal.archived_at) {
      rows.push({
        at: deal.archived_at,
        ...actor(deal.sales_id ?? owner.id),
        entity: "deal",
        entity_id: deal.id,
        action: "archive",
        changes: { archived_at: [null, deal.archived_at] },
        ...ofDeal(deal),
      });
    }
  });

  // Payments
  db.deal_payments.forEach((payment) => {
    const deal = dealsById.get(payment.deal_id);
    if (!deal) return;
    rows.push({
      at: payment.created_at,
      ...actor(payment.sales_id ?? owner.id),
      entity: "payment",
      entity_id: payment.id,
      action: "create",
      changes: {
        amount: [null, payment.amount],
        paid_at: [null, payment.paid_at],
        comment: [null, payment.comment ?? null],
      },
      ...ofDeal(deal),
    });
  });

  // Tasks: created (by the rules or by hand), completed
  db.tasks.forEach((task) => {
    const deal = dealsById.get(task.deal_id);
    if (!deal) return;
    const automatic = random.number(9) < 5;
    rows.push({
      at: task.created_at ?? deal.created_at,
      ...(automatic
        ? { sales_id: null, source: "automation" }
        : actor(task.sales_id ?? owner.id)),
      entity: "task",
      entity_id: task.id,
      action: "create",
      changes: {
        type: [null, task.type],
        text: [null, task.text ?? null],
        due_date: [null, task.due_date],
        ...(task.sales_id != null ? { sales_id: [null, task.sales_id] } : {}),
      },
      ...ofDeal(deal),
    });
    if (task.done_date) {
      rows.push({
        at: task.done_date,
        ...actor(task.sales_id ?? owner.id),
        entity: "task",
        entity_id: task.id,
        action: "complete",
        changes: { done_date: [null, task.done_date] },
        ...ofDeal(deal),
      });
    }
  });

  db.audit_log = rows
    .map((row) => ({
      deal_id: null,
      patient_id: null,
      ...row,
      // Nothing in the future
      at: row.at > iso(now) ? iso(now) : row.at,
    }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((row, id) => ({ ...row, id }));
};
