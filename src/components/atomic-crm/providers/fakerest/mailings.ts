import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import {
  automessageValues,
  DEFAULT_TIME_ZONE,
  renderTemplate,
} from "../commons/automessages";
import {
  DEFAULT_MAILING_SETTINGS,
  mailingAllowance,
  validateMailingSettings,
} from "../../mailings/limits";
import {
  decideRecall,
  RECALL_CATCH_UP_DAYS,
  recallCandidates,
  recallDealName,
} from "../../mailings/recalls";
import { classifySegment, type SegmentData } from "../../mailings/segment";
import type {
  Mailing,
  MailingMessage,
  MailingSegment,
  MailingSettings,
  MailingSummary,
  Recall,
  RecallReport,
  RecallRule,
  SegmentPreview,
} from "../../mailings/types";
import { segmentPreview } from "../../mailings/segment";
import type {
  Automessage,
  Deal,
  LeadSource,
  LostReason,
  Message,
  MessageTemplate,
  Patient,
  Sale,
  Service,
  Stage,
} from "../../types";
import type { PatientOptOut } from "../supabase/mailingMethods";
import { DEMO_CLINIC_NAME } from "./dataGenerator/automessages";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Repeat sales and mailings of the demo (stage 17): the same rules as the
 * database (supabase/schemas/17_repeat_mailings.sql) on the in-browser data.
 * The "dispatcher" sends the due mailing messages within the limits when
 * the mailings are listed; the "daily job" creates the due recall deals when
 * the repeat sales screen opens.
 */
export const createMailingDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  /** The provider with the lifecycle callbacks (deal triggers) */
  getDataProvider: () => DataProvider;
}) => {
  const now = () => new Date();

  const checkRole = async () => {
    const salesId = await currentSalesId();
    const me = (await all<Sale>("sales")).find(
      (sale) => String(sale.id) === String(salesId),
    );
    if (me?.role !== "owner" && me?.role !== "head") {
      throw new Error("mailings.forbidden");
    }
  };

  const clinicName = async () => {
    const configuration = await baseDataProvider
      .getOne("configuration", { id: 1 })
      .then((r) => r.data)
      .catch(() => undefined);
    return configuration?.config?.title || DEMO_CLINIC_NAME;
  };

  const settings = async (): Promise<MailingSettings> => {
    const [row] = await all<MailingSettings & { id: number }>(
      "mailing_settings",
    );
    return row
      ? {
          per_minute: row.per_minute,
          per_day: row.per_day,
          work_start: row.work_start,
          work_end: row.work_end,
        }
      : DEFAULT_MAILING_SETTINGS;
  };

  const segmentData = async (): Promise<SegmentData> => {
    const [patients, deals, stages, messages] = await Promise.all([
      all<Patient>("patients"),
      all<Deal>("deals"),
      all<Stage>("stages"),
      all<Message>("messages"),
    ]);
    return {
      patients,
      deals,
      stages,
      chatPatientIds: [...new Set(messages.map((m) => m.patient_id))],
    };
  };

  const update = <T extends { id: Identifier }>(
    resource: string,
    record: T,
    data: Partial<T>,
  ) =>
    baseDataProvider.update(resource, {
      id: record.id,
      data,
      previousData: record,
    });

  /** Same as private.cancel of the pending rows of a patient or a mailing */
  const cancelPending = async (
    match: (row: MailingMessage) => boolean,
    reason: string,
  ) => {
    const rows = (await all<MailingMessage>("mailing_messages")).filter(
      (row) => row.status === "pending" && match(row),
    );
    for (const row of rows) {
      await update("mailing_messages", row, {
        status: "cancelled",
        error: reason,
        processed_at: now().toISOString(),
      });
    }
  };

  // --- the dispatcher (public.claim_mailing_messages + mailings_dispatch)

  let dispatching: Promise<void> | null = null;
  const dispatchDueMailings = () => {
    dispatching ??= (async () => {
      const at = now();
      const [rows, mailings, patients, deals, stages, messages, services] =
        await Promise.all([
          all<MailingMessage>("mailing_messages"),
          all<Mailing>("mailings"),
          all<Patient>("patients"),
          all<Deal>("deals"),
          all<Stage>("stages"),
          all<Message>("messages"),
          all<Service>("services"),
        ]);
      // Delivery reports of the demo: sent -> delivered -> read
      for (const row of rows) {
        if (row.status !== "sent" || row.message_id != null) continue;
        if (row.delivery_status === "sent") {
          await update("mailing_messages", row, {
            delivery_status: "delivered",
          });
        } else if (row.delivery_status === "delivered" && Math.random() < 0.3) {
          await update("mailing_messages", row, { delivery_status: "read" });
        }
      }

      const kind = new Map(stages.map((s) => [String(s.id), s.kind]));
      const active = new Set(
        mailings
          .filter((m) => m.status === "scheduled")
          .map((m) => String(m.id)),
      );
      const due = rows
        .filter(
          (row) =>
            row.status === "pending" &&
            row.send_at <= at.toISOString() &&
            (row.mailing_id == null || active.has(String(row.mailing_id))),
        )
        .sort(
          (a, b) =>
            a.send_at.localeCompare(b.send_at) || Number(a.id) - Number(b.id),
        );
      let allowance = mailingAllowance({
        at,
        settings: await settings(),
        timeZone: DEFAULT_TIME_ZONE,
        claimedAt: rows.map((row) => row.claimed_at),
      });
      const clinic = await clinicName();
      const chats = new Set(messages.map((m) => String(m.patient_id)));
      for (const row of due) {
        if (allowance <= 0) break;
        const patient = patients.find(
          (p) => String(p.id) === String(row.patient_id),
        );
        const close = (data: Partial<MailingMessage>) =>
          update("mailing_messages", row, {
            processed_at: at.toISOString(),
            ...data,
          });
        if (!patient || patient.messaging_opt_out) {
          await close({
            status: "skipped",
            error: "Пациент отказался от сообщений",
          });
          continue;
        }
        if (!patient.phones?.length && !chats.has(String(patient.id))) {
          await close({ status: "skipped", error: "Нет телефона или чата" });
          continue;
        }
        const own = deals
          .filter((d) => String(d.patient_id) === String(patient.id))
          .sort(
            (a, b) =>
              b.updated_at.localeCompare(a.updated_at) ||
              Number(b.id) - Number(a.id),
          );
        let deal: Deal | undefined;
        if (row.recall_id != null) {
          deal = own.find(
            (d) =>
              String(d.id) === String(row.deal_id) &&
              kind.get(String(d.stage_id)) === "open" &&
              !d.archived_at,
          );
          if (!deal) {
            await close({
              status: "cancelled",
              error: "Сделка повторной продажи уже закрыта",
            });
            continue;
          }
        } else {
          deal =
            (row.deal_id != null
              ? own.find((d) => String(d.id) === String(row.deal_id))
              : undefined) ??
            own.find(
              (d) => kind.get(String(d.stage_id)) === "open" && !d.archived_at,
            ) ??
            own[0];
        }
        const text = renderTemplate(
          row.body,
          deal
            ? automessageValues({
                deal,
                patientFirstName: patient.first_name,
                serviceName: services.find((s) => s.id === deal.service_id)
                  ?.name,
                clinicName: clinic,
              })
            : { имя: patient.first_name, клиника: clinic },
        );
        allowance--;
        let messageId: Identifier | null = null;
        if (deal) {
          const previous = messages
            .filter((m) => String(m.deal_id) === String(deal.id))
            .sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
          const { data: message } = await baseDataProvider.create<Message>(
            "messages",
            {
              data: {
                patient_id: patient.id,
                deal_id: deal.id,
                channel_id: previous?.channel_id ?? 1,
                transport: previous?.transport ?? "whatsapp",
                chat_id:
                  previous?.chat_id ??
                  (patient.phones?.[0] ?? "").replace(/\D/g, ""),
                direction: "out",
                sales_id: null,
                text,
                content_type: "text",
                status: "sent",
                sent_at: at.toISOString(),
                automessage_id: null,
              },
            },
          );
          messageId = message.id;
        }
        await close({
          status: "sent",
          text,
          deal_id: deal?.id ?? null,
          message_id: messageId,
          delivery_status: deal ? null : "sent",
          claimed_at: at.toISOString(),
        });
      }

      // Mailings with nothing left are done
      const left = await all<MailingMessage>("mailing_messages");
      for (const mailing of mailings) {
        if (
          mailing.status === "scheduled" &&
          mailing.scheduled_at <= at.toISOString() &&
          !left.some(
            (row) =>
              String(row.mailing_id) === String(mailing.id) &&
              (row.status === "pending" || row.status === "sending"),
          )
        ) {
          await update("mailings", mailing, {
            status: "done",
            finished_at: at.toISOString(),
          });
        }
      }
    })().finally(() => {
      dispatching = null;
    });
    return dispatching;
  };

  // --- mailings_summary ---------------------------------------------------

  const mailingsSummary = async (): Promise<MailingSummary[]> => {
    await dispatchDueMailings();
    const [mailings, rows, messages] = await Promise.all([
      all<Mailing>("mailings"),
      all<MailingMessage>("mailing_messages"),
      all<Message>("messages"),
    ]);
    const statusOf = new Map(messages.map((m) => [String(m.id), m.status]));
    return mailings.map((mailing) => {
      const own = rows.filter(
        (row) => String(row.mailing_id) === String(mailing.id),
      );
      const delivery = (row: MailingMessage) =>
        (row.message_id != null
          ? statusOf.get(String(row.message_id))
          : null) ?? row.delivery_status;
      const sent = own.filter((row) => row.status === "sent");
      return {
        ...mailing,
        queued_count: own.filter(
          (row) => row.status === "pending" || row.status === "sending",
        ).length,
        sent_count: sent.length,
        delivered_count: sent.filter((row) =>
          ["delivered", "read"].includes(delivery(row) ?? ""),
        ).length,
        read_count: sent.filter((row) => delivery(row) === "read").length,
        failed_count:
          own.filter((row) => row.status === "failed").length +
          sent.filter((row) => delivery(row) === "error").length,
        skipped_count: own.filter((row) => row.status === "skipped").length,
        cancelled_count: own.filter((row) => row.status === "cancelled").length,
      };
    });
  };

  // --- the daily job of the recalls (private.process_recalls) -------------

  const repeatSourceId = async () => {
    const sources = await all<LeadSource>("lead_sources");
    const found = sources.find((s) => s.code === "repeat");
    if (found) return found.id;
    const { data } = await baseDataProvider.create<LeadSource>("lead_sources", {
      data: {
        name: "Повторное обращение",
        code: "repeat",
        is_system: true,
        position: sources.length,
        is_archived: false,
      },
    });
    return data.id;
  };

  const processDueRecalls = async () => {
    const at = now();
    const [
      rules,
      deals,
      stages,
      recalls,
      patients,
      lostReasons,
      services,
      templates,
      messages,
    ] = await Promise.all([
      all<RecallRule>("recall_rules"),
      all<Deal>("deals"),
      all<Stage>("stages"),
      all<Recall>("recalls"),
      all<Patient>("patients"),
      all<LostReason>("lost_reasons"),
      all<Service>("services"),
      all<MessageTemplate>("message_templates"),
      all<Message>("messages"),
    ]);
    const candidates = recallCandidates({
      rules,
      deals,
      stages,
      recalls,
      from: new Date(at.getTime() - RECALL_CATCH_UP_DAYS * DAY),
      to: at,
    });
    const clinic = await clinicName();
    for (const { rule, deal: wonDeal, due_at } of candidates) {
      const patient = patients.find(
        (p) => String(p.id) === String(wonDeal.patient_id),
      );
      if (!patient) continue;
      // Deals created by this run count (a patient due twice gets one deal)
      const current = await all<Deal>("deals");
      const decision = decideRecall({
        patientId: patient.id,
        optedOut: patient.messaging_opt_out,
        deals: current,
        stages,
        lostReasons,
      });
      const base = {
        rule_id: rule.id,
        deal_id: wonDeal.id,
        patient_id: patient.id,
        due_at,
        created_at: at.toISOString(),
      };
      if (decision.status !== "created") {
        await baseDataProvider.create("recalls", {
          data: { ...base, ...decision, recall_deal_id: null },
        });
        continue;
      }
      const serviceId = rule.deal_service_id ?? wonDeal.service_id ?? null;
      const { data: recallDeal } = await getDataProvider().create<Deal>(
        "deals",
        {
          data: {
            patient_id: patient.id,
            pipeline_id: rule.pipeline_id,
            stage_id: rule.stage_id,
            name: recallDealName(
              services.find((s) => s.id === serviceId)?.name,
              rule.name,
            ),
            source_id: await repeatSourceId(),
            service_id: serviceId,
            sales_id: wonDeal.sales_id ?? patient.sales_id ?? null,
          },
        },
      );
      const { data: recall } = await baseDataProvider.create<Recall>(
        "recalls",
        {
          data: {
            ...base,
            status: "created",
            reason: null,
            recall_deal_id: recallDeal.id,
          },
        },
      );
      const template = templates.find(
        (t) => String(t.id) === String(rule.template_id),
      );
      const reachable =
        patient.phones?.length ||
        messages.some((m) => String(m.patient_id) === String(patient.id));
      if (!template || !reachable) continue;
      if (rule.message_mode === "confirm") {
        const text = renderTemplate(
          template.body,
          automessageValues({
            deal: recallDeal,
            patientFirstName: patient.first_name,
            serviceName: services.find((s) => s.id === serviceId)?.name,
            clinicName: clinic,
          }),
        );
        const { data: automessage } =
          await baseDataProvider.create<Automessage>("automessages", {
            data: {
              deal_id: recallDeal.id,
              rule_id: null,
              stage_id: recallDeal.stage_id,
              timing: "after_stage",
              send_at: at.toISOString(),
              status: "awaiting",
              text,
              error: null,
              processed_at: at.toISOString(),
              created_at: at.toISOString(),
            },
          });
        await baseDataProvider.create("tasks", {
          data: {
            deal_id: recallDeal.id,
            type: "message",
            text,
            due_date: at.toISOString(),
            done_date: null,
            sales_id: recallDeal.sales_id ?? null,
            automessage_id: automessage.id,
            created_at: at.toISOString(),
          },
        });
      } else {
        await baseDataProvider.create("mailing_messages", {
          data: {
            mailing_id: null,
            recall_id: recall.id,
            patient_id: patient.id,
            deal_id: recallDeal.id,
            body: template.body,
            send_at: at.toISOString(),
            status: "pending",
            text: null,
            error: null,
            message_id: null,
            claimed_at: null,
            processed_at: null,
            created_at: at.toISOString(),
          },
        });
      }
    }
  };

  const recallReport = async (filters: {
    from?: string | null;
    to?: string | null;
  }): Promise<RecallReport> => {
    await checkRole();
    await processDueRecalls();
    const at = now();
    const [rules, deals, stages, recalls, patients] = await Promise.all([
      all<RecallRule>("recall_rules"),
      all<Deal>("deals"),
      all<Stage>("stages"),
      all<Recall>("recalls"),
      all<Patient>("patients"),
    ]);
    const kind = new Map(stages.map((s) => [String(s.id), s.kind]));
    const patientName = (id: Identifier) => {
      const p = patients.find((x) => String(x.id) === String(id));
      return [p?.last_name, p?.first_name].filter(Boolean).join(" ");
    };
    const upcoming = recallCandidates({
      rules,
      deals,
      stages,
      recalls,
      from: at,
      to: new Date(at.getTime() + 30 * DAY),
    }).map(({ rule, deal, due_at }) => ({
      rule_id: rule.id,
      rule_name: rule.name,
      deal_id: deal.id,
      deal_name: deals.find((d) => d.id === deal.id)?.name ?? null,
      patient_id: deal.patient_id,
      patient_name: patientName(deal.patient_id),
      due_at,
      opted_out: !!patients.find(
        (p) => String(p.id) === String(deal.patient_id),
      )?.messaging_opt_out,
    }));
    const inPeriod = recalls
      .filter(
        (r) =>
          (!filters.from || r.created_at >= filters.from) &&
          (!filters.to || r.created_at < filters.to),
      )
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) ||
          Number(b.id) - Number(a.id),
      );
    const recallKind = (r: Recall) => {
      const deal = deals.find((d) => String(d.id) === String(r.recall_deal_id));
      return deal ? (kind.get(String(deal.stage_id)) ?? null) : null;
    };
    const created = inPeriod.filter((r) => r.status === "created");
    return {
      upcoming,
      recalls: inPeriod.slice(0, 200).map((r) => ({
        id: r.id,
        rule_name:
          rules.find((rule) => String(rule.id) === String(r.rule_id))?.name ??
          null,
        patient_id: r.patient_id,
        patient_name: patientName(r.patient_id),
        due_at: r.due_at,
        created_at: r.created_at,
        status: r.status,
        reason: r.reason,
        recall_deal_id: r.recall_deal_id,
        recall_deal_name:
          deals.find((d) => String(d.id) === String(r.recall_deal_id))?.name ??
          null,
        recall_deal_kind: recallKind(r),
      })),
      totals: {
        created: created.length,
        skipped: inPeriod.filter((r) => r.status === "skipped").length,
        cancelled: inPeriod.filter((r) => r.status === "cancelled").length,
        open: created.filter((r) => recallKind(r) === "open").length,
        won: created.filter((r) => recallKind(r) === "won").length,
        lost: created.filter((r) => recallKind(r) === "lost").length,
        upcoming: upcoming.length,
      },
    };
  };

  // --- methods, views and triggers ------------------------------------------

  const methods = {
    getSegmentPreview: async (
      segment: MailingSegment,
    ): Promise<SegmentPreview> => {
      await checkRole();
      return segmentPreview(await segmentData(), segment);
    },
    getRecallReport: recallReport,
    getMailingSettings: settings,
    updateMailingSettings: async (
      data: MailingSettings,
    ): Promise<MailingSettings> => {
      await checkRole();
      const error = validateMailingSettings(data);
      if (error) throw new Error(error);
      const [row] = await all<MailingSettings & { id: number }>(
        "mailing_settings",
      );
      if (row) await update("mailing_settings", row, data);
      else await baseDataProvider.create("mailing_settings", { data });
      return data;
    },
    getPatientOptOut: async (patientId: Identifier): Promise<PatientOptOut> => {
      const { data } = await baseDataProvider.getOne<Patient>("patients", {
        id: patientId,
      });
      return {
        messaging_opt_out: !!data.messaging_opt_out,
        messaging_opt_out_at: data.messaging_opt_out_at ?? null,
      };
    },
    setPatientOptOut: async (
      patientId: Identifier,
      value: boolean,
    ): Promise<PatientOptOut> => {
      const { data: patient } = await baseDataProvider.getOne<Patient>(
        "patients",
        { id: patientId },
      );
      const result = {
        messaging_opt_out: value,
        messaging_opt_out_at: value
          ? (patient.messaging_opt_out_at ?? now().toISOString())
          : null,
      };
      await update("patients", patient, result);
      // Same as private.handle_patient_opt_out
      if (value && !patient.messaging_opt_out) {
        await cancelPending(
          (row) => String(row.patient_id) === String(patientId),
          "Пациент отказался от сообщений",
        );
      }
      return result;
    },
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "mailings",
      beforeCreate: async (params) => {
        await checkRole();
        const at = now().toISOString();
        return {
          ...params,
          data: {
            name: params.data.name,
            segment: params.data.segment ?? {},
            template_id: params.data.template_id ?? null,
            body: params.data.body,
            scheduled_at: params.data.scheduled_at ?? at,
            status: "scheduled",
            recipients_count: 0,
            created_by: (await currentSalesId()) ?? null,
            created_at: at,
            finished_at: null,
          },
        };
      },
      // Same as private.handle_mailing_created: the segment is queued
      afterCreate: async (result) => {
        const mailing = result.data as Mailing;
        const segment = await segmentData();
        const rows = classifySegment(segment, mailing.segment).filter(
          (row) => row.status === "ok",
        );
        // A mailing to chosen deals: the patient's latest updated one of them
        const chosen = mailing.segment.deal_ids?.map(String);
        const dealOf = (patientId: Identifier) =>
          chosen
            ? (segment.deals
                .filter(
                  (d) =>
                    String(d.patient_id) === String(patientId) &&
                    chosen.includes(String(d.id)),
                )
                .sort(
                  (a, b) =>
                    (b.updated_at ?? "").localeCompare(a.updated_at ?? "") ||
                    Number(b.id) - Number(a.id),
                )[0]?.id ?? null)
            : null;
        for (const row of rows) {
          await baseDataProvider.create("mailing_messages", {
            data: {
              mailing_id: mailing.id,
              recall_id: null,
              patient_id: row.patient_id,
              deal_id: dealOf(row.patient_id),
              body: mailing.body,
              send_at: mailing.scheduled_at,
              status: "pending",
              text: null,
              error: null,
              message_id: null,
              delivery_status: null,
              claimed_at: null,
              processed_at: null,
              created_at: mailing.created_at,
            },
          });
        }
        const { data } = await update("mailings", mailing, {
          recipients_count: rows.length,
        });
        return { ...result, data };
      },
      // Same as private.handle_mailing_update
      beforeUpdate: async (params) => {
        await checkRole();
        const { data: previous } = await baseDataProvider.getOne<Mailing>(
          "mailings",
          { id: params.id },
        );
        const status = params.data.status ?? previous.status;
        const allowed =
          status === previous.status ||
          (previous.status === "scheduled" &&
            ["paused", "cancelled"].includes(status)) ||
          (previous.status === "paused" &&
            ["scheduled", "cancelled"].includes(status));
        if (!allowed) throw new Error("mailings.errors.status_locked");
        if (status === "cancelled" && previous.status !== "cancelled") {
          await cancelPending(
            (row) => String(row.mailing_id) === String(previous.id),
            "Рассылка отменена",
          );
        }
        return {
          ...params,
          data: {
            ...(params.data.name ? { name: params.data.name } : {}),
            status,
            ...(status === "cancelled" && previous.status !== "cancelled"
              ? { finished_at: now().toISOString() }
              : {}),
          },
        };
      },
    },
  ];

  const views: Record<string, () => Promise<any[]>> = {
    // mailings_summary (the demo adapter reads it as "mailings")
    mailings: mailingsSummary,
  };

  return { methods, callbacks, views };
};

export type MailingDemo = ReturnType<typeof createMailingDemo>;
