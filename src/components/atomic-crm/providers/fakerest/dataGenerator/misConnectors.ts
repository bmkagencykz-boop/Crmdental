import type { Deal, Patient } from "../../../types";
import type { StageTriggerRun } from "../../../pipeline-automation/types";
import type {
  MisAppointment,
  MisConnection,
  MisDoctor,
  MisStatus,
  MisSyncLogEntry,
} from "../../../mis/types";
import type { Db } from "./types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * MIS connector of the demo clinic (stage 27): Dentist Plus connected, a few
 * appointments synced onto open deals (with the doctor mapped), one payment
 * from the MIS, the MIS doctors (one not linked yet) and the sync log.
 */
export const generateMisConnectors = (db: Db) => {
  const now = Date.now();
  const iso = (time: number) => new Date(time).toISOString();
  const stageId = (name: string) =>
    db.stages.find((stage) => stage.pipeline_id === 1 && stage.name === name)
      ?.id;

  const connection: MisConnection = {
    id: 1,
    kind: "dentist_plus",
    status: "connected",
    base_url: "https://api.dentist-plus.com/v1",
    has_api_key: true,
    webhook_token: "demo-mis-token",
    sync_patients: true,
    sync_appointments: true,
    sync_payments: true,
    push_appointments: false,
    status_map: {
      scheduled: { stage_id: stageId("Записан") },
      confirmed: { stage_id: stageId("Записан") },
      arrived: { stage_id: stageId("Пришёл на консультацию") },
      completed: { stage_id: stageId("Пришёл на консультацию") },
      in_treatment: { stage_id: stageId("В лечении") },
    },
    last_sync_at: iso(now - 7 * MINUTE),
    last_error: null,
    connected_at: iso(now - 21 * DAY),
    created_at: iso(now - 21 * DAY),
  };
  db.mis_connections = [connection];
  db.integrations.push({
    id: 1,
    kind: "dentist_plus",
    status: "connected",
    last_sync_at: connection.last_sync_at,
    last_error: null,
  });

  // MIS doctors: the ones of the clinic (linked by name) and one unknown
  db.mis_doctors = [
    ...db.doctors.slice(0, 3).map(
      (doctor, index): MisDoctor => ({
        id: index + 1,
        kind: "dentist_plus",
        external_id: `D${101 + index}`,
        name: doctor.name,
        doctor_id: doctor.id,
        created_at: iso(now - 20 * DAY),
      }),
    ),
    {
      id: 4,
      kind: "dentist_plus",
      external_id: "D199",
      name: "Омарова Гульнара Ержановна",
      doctor_id: null,
      created_at: iso(now - 3 * DAY),
    },
  ];

  // Appointments on open deals of the booked and visited stages
  const openDeals = db.deals
    .filter(
      (deal) =>
        deal.archived_at == null &&
        [
          stageId("Записан"),
          stageId("Пришёл на консультацию"),
          stageId("В лечении"),
        ].includes(deal.stage_id as number),
    )
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 4);
  const plan: Array<{
    status: MisStatus;
    label: string;
    offset: number;
    service: string;
  }> = [
    {
      status: "scheduled",
      label: "Записан",
      offset: 2 * DAY + 3 * HOUR,
      service: "Консультация",
    },
    {
      status: "completed",
      label: "Визит состоялся",
      offset: -1 * DAY,
      service: "Консультация хирурга",
    },
    {
      status: "in_treatment",
      label: "Лечение начато",
      offset: -3 * DAY,
      service: "Имплантация",
    },
    {
      status: "confirmed",
      label: "Подтверждён",
      offset: 1 * DAY,
      service: "Профгигиена",
    },
  ];
  db.mis_appointments = [];
  db.mis_sync_log = [];
  let logId = 0;
  const log = (entry: Omit<MisSyncLogEntry, "id" | "kind">) =>
    db.mis_sync_log.push({ id: ++logId, kind: "dentist_plus", ...entry });

  openDeals.forEach((deal: Deal, index) => {
    const step = plan[index];
    const doctor = db.mis_doctors[index % 3];
    const startsAt = new Date(now + step.offset);
    startsAt.setMinutes(0, 0, 0);
    const appointment: MisAppointment = {
      id: index + 1,
      kind: "dentist_plus",
      external_id: String(5501 + index),
      patient_id: deal.patient_id,
      deal_id: deal.id,
      doctor_id: doctor.doctor_id,
      doctor_external_id: doctor.external_id,
      doctor_name: doctor.name,
      service_name: step.service,
      status: step.status,
      status_label: step.label,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
      completed_at: ["completed", "in_treatment"].includes(step.status)
        ? new Date(startsAt.getTime() + 50 * MINUTE).toISOString()
        : null,
      comment: null,
      created_at: iso(now - 5 * DAY),
      updated_at: iso(now - (index + 1) * HOUR),
    };
    db.mis_appointments.push(appointment);
    if (["scheduled", "confirmed"].includes(step.status)) {
      deal.appointment_at = appointment.starts_at;
    } else {
      deal.visit_at = appointment.completed_at;
    }
    deal.doctor_id = doctor.doctor_id ?? deal.doctor_id;
    db.external_refs.push(
      {
        id: db.external_refs.length + 1,
        entity: "patient",
        entity_id: deal.patient_id,
        system: "dentist_plus",
        external_id: String(1042 + index),
      },
      {
        id: db.external_refs.length + 2,
        entity: "appointment",
        entity_id: deal.id,
        system: "dentist_plus",
        external_id: appointment.external_id,
      },
    );
    const patient = db.patients.find(
      (p: Patient) => String(p.id) === String(deal.patient_id),
    );
    log({
      direction: "in",
      operation: "appointment",
      external_id: appointment.external_id,
      result: "ok",
      message: `Запись обновлена, статус ${step.label}`,
      patient_id: patient?.id ?? null,
      deal_id: deal.id,
      created_at: iso(now - (index + 1) * HOUR),
    });
  });

  // The deal feed shows what the MIS did (like private.mis_apply_status)
  const runId = () =>
    Math.max(0, ...db.stage_trigger_runs.map((run) => Number(run.id))) + 1;
  if (openDeals[1]) {
    db.stage_trigger_runs.push({
      id: runId(),
      deal_id: openDeals[1].id,
      trigger_id: null,
      trigger_name: "МИС: Dentist Plus",
      event: "mis" as StageTriggerRun["event"],
      event_key: "mis:dentist_plus:5502:completed",
      action: "move_stage",
      status: "done",
      details: {
        from_stage_id: stageId("Записан"),
        to_stage_id: openDeals[1].stage_id,
      },
      error: null,
      created_at: iso(now - 2 * HOUR),
    });
  }
  if (openDeals[2]) {
    db.stage_trigger_runs.push({
      id: runId(),
      deal_id: openDeals[2].id,
      trigger_id: null,
      trigger_name: "МИС: Dentist Plus",
      event: "mis" as StageTriggerRun["event"],
      event_key: "mis:dentist_plus:5503:in_treatment",
      action: "move_stage",
      status: "skipped",
      details: { to_stage_id: stageId("В лечении") },
      error: "Выполните чек-лист этапа «Пришёл на консультацию»",
      created_at: iso(now - 3 * HOUR),
    });
  }

  // One payment of the MIS on the visited deal
  const paid = openDeals[1];
  if (paid) {
    const paymentId =
      Math.max(0, ...db.deal_payments.map((payment) => Number(payment.id))) + 1;
    db.deal_payments.push({
      id: paymentId,
      deal_id: paid.id,
      amount: 15000,
      kind: "payment",
      paid_at: iso(now - DAY).slice(0, 10),
      comment: "Оплата из МИС: консультация",
      sales_id: null,
      created_at: iso(now - DAY),
    });
    paid.paid_amount += 15000;
    db.external_refs.push({
      id: db.external_refs.length + 1,
      entity: "payment",
      entity_id: paymentId,
      system: "dentist_plus",
      external_id: "PAY-880",
    });
    log({
      direction: "in",
      operation: "payment",
      external_id: "PAY-880",
      result: "ok",
      message: "Оплата 15000 ₸",
      patient_id: paid.patient_id,
      deal_id: paid.id,
      created_at: iso(now - 50 * MINUTE),
    });
  }

  log({
    direction: "in",
    operation: "stage",
    external_id: "5503",
    result: "skipped",
    message:
      "Перевод на «В лечении» пропущен: Выполните чек-лист этапа «Пришёл на консультацию»",
    patient_id: openDeals[2]?.patient_id ?? null,
    deal_id: openDeals[2]?.id ?? null,
    created_at: iso(now - 3 * HOUR),
  });
  log({
    direction: "in",
    operation: "test",
    external_id: null,
    result: "ok",
    message: "Dentist Plus ответила",
    patient_id: null,
    deal_id: null,
    created_at: iso(now - 21 * DAY),
  });
  log({
    direction: "in",
    operation: "poll",
    external_id: null,
    result: "ok",
    message: "Принято: 5, без изменений: 12, ошибок: 0",
    patient_id: null,
    deal_id: null,
    created_at: iso(now - 7 * MINUTE),
  });
  db.mis_sync_log.sort((a, b) => b.created_at.localeCompare(a.created_at));
};
