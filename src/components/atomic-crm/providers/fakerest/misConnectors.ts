import type { DataProvider, Identifier } from "ra-core";

import {
  defaultStatusMap,
  MIS_STATUSES,
  misWebhookUrl,
} from "../../mis/misConnectors";
import type {
  MisActionResult,
  MisAppointment,
  MisConnection,
  MisConnectionPatch,
  MisDoctor,
  MisKind,
  MisStatusMap,
  MisSyncLogEntry,
} from "../../mis/types";
import type { IntegrationStatus, Sale, Stage, Tag } from "../../types";

const LABELS: Record<MisKind, string> = {
  dentist_plus: "Dentist Plus",
  macdent: "MacDent",
};

const forbidden = () =>
  Object.assign(
    new Error("Only the owner and the head manage the MIS connection"),
    { code: "42501" },
  );
const invalid = (message: string) =>
  Object.assign(new Error(message), { code: "22023" });

// Demo address of the edge functions (nothing is reachable)
const DEMO_FUNCTIONS_URL = "https://demo.dentalcrm.kz/functions/v1";
const withWebhookUrl = (connection: MisConnection | null) =>
  connection
    ? {
        ...connection,
        webhook_url: misWebhookUrl(
          DEMO_FUNCTIONS_URL,
          connection.kind,
          connection.webhook_token,
        ),
      }
    : null;

const token = () =>
  Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");

/**
 * MIS connectors of the demo (stage 27): the same rules as the settings
 * functions of supabase/schemas/27_mis_connectors.sql. Nothing leaves the
 * browser: «Проверить подключение» and «Синхронизировать сейчас» answer
 * for the MIS and write the sync log.
 */
export const createMisDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
}) => {
  const canEdit = async () => {
    const salesId = await currentSalesId();
    const me = (await all<Sale>("sales")).find(
      (sale) => String(sale.id) === String(salesId),
    );
    // The demo user is the owner of the clinic
    return !me || me.role === "owner" || me.role === "head";
  };

  const find = async (kind: MisKind) =>
    (await all<MisConnection>("mis_connections")).find(
      (connection) => connection.kind === kind,
    ) ?? null;

  /** integrations mirrors the status (integration_status, useMisConnection) */
  const syncStatus = async (connection: MisConnection) => {
    const row = (
      await all<IntegrationStatus & { id: Identifier }>("integrations")
    ).find((integration) => integration.kind === connection.kind);
    const data = {
      kind: connection.kind,
      status: connection.status,
      last_sync_at: connection.last_sync_at,
      last_error: connection.last_error,
    };
    if (row) {
      await baseDataProvider.update("integrations", {
        id: row.id,
        data,
        previousData: row,
      });
    } else {
      await baseDataProvider.create("integrations", { data });
    }
  };

  const save = async (connection: MisConnection) => {
    const { webhook_url: _url, ...stored } = connection;
    const { data } = await baseDataProvider.update<MisConnection>(
      "mis_connections",
      { id: connection.id, data: stored, previousData: connection },
    );
    await syncStatus(data);
    return withWebhookUrl(data)!;
  };

  const log = (
    kind: MisKind,
    entry: Pick<MisSyncLogEntry, "operation" | "result" | "message"> &
      Partial<MisSyncLogEntry>,
  ) =>
    baseDataProvider.create("mis_sync_log", {
      data: {
        kind,
        direction: "in",
        external_id: null,
        patient_id: null,
        deal_id: null,
        created_at: new Date().toISOString(),
        ...entry,
      },
    });

  /** Same checks as private.mis_clean_status_map */
  const cleanStatusMap = async (map: MisStatusMap): Promise<MisStatusMap> => {
    const stages = await all<Stage>("stages");
    const tags = await all<Tag>("tags");
    const result: MisStatusMap = {};
    for (const [status, target] of Object.entries(map)) {
      if (!MIS_STATUSES.includes(status as (typeof MIS_STATUSES)[number])) {
        throw invalid(`Неизвестный статус МИС: ${status}`);
      }
      if (target?.stage_id != null) {
        const stage = stages.find(
          (s) => String(s.id) === String(target.stage_id),
        );
        if (!stage || stage.kind === "lost") {
          throw invalid(
            `Этап для статуса «${status}» не найден или это этап отказа`,
          );
        }
        result[status as keyof MisStatusMap] = { stage_id: stage.id };
      } else if (target?.tag_id != null) {
        if (!tags.some((tag) => String(tag.id) === String(target.tag_id))) {
          throw invalid(`Тег для статуса «${status}» не найден`);
        }
        result[status as keyof MisStatusMap] = { tag_id: target.tag_id };
      }
    }
    return result;
  };

  const methods = {
    getMisConnection: async (kind: MisKind): Promise<MisConnection | null> =>
      (await canEdit()) ? withWebhookUrl(await find(kind)) : null,

    saveMisConnection: async (
      kind: MisKind,
      patch: MisConnectionPatch,
    ): Promise<MisConnection> => {
      if (!(await canEdit())) throw forbidden();
      const baseUrl =
        patch.base_url === undefined
          ? undefined
          : patch.base_url?.trim() || null;
      if (baseUrl && !/^https:\/\/[^/\s]+/.test(baseUrl)) {
        throw invalid("Адрес API должен начинаться с https://");
      }
      let current = await find(kind);
      if (!current) {
        const now = new Date().toISOString();
        const { data } = await baseDataProvider.create<MisConnection>(
          "mis_connections",
          {
            data: {
              kind,
              status: "requested",
              base_url: null,
              has_api_key: false,
              webhook_token: token(),
              sync_patients: true,
              sync_appointments: true,
              sync_payments: true,
              push_appointments: false,
              status_map: defaultStatusMap(await all<Stage>("stages")),
              last_sync_at: null,
              last_error: null,
              connected_at: null,
              created_at: now,
            } as Omit<MisConnection, "id"> as MisConnection,
          },
        );
        current = data;
      }
      const keyChanged = patch.api_key != null;
      const hasKey = keyChanged ? !!patch.api_key?.trim() : current.has_api_key;
      const status: MisConnection["status"] = !hasKey
        ? "requested"
        : ["connected", "error"].includes(current.status) &&
            !(keyChanged && patch.api_key?.trim())
          ? current.status
          : "connected";
      return save({
        ...current,
        base_url: baseUrl === undefined ? current.base_url : baseUrl,
        has_api_key: hasKey,
        status,
        last_error:
          status === "connected" && keyChanged ? null : current.last_error,
        connected_at:
          status === "connected" && current.status !== "connected"
            ? new Date().toISOString()
            : current.connected_at,
        sync_patients: patch.sync_patients ?? current.sync_patients,
        sync_appointments: patch.sync_appointments ?? current.sync_appointments,
        sync_payments: patch.sync_payments ?? current.sync_payments,
        push_appointments: patch.push_appointments ?? current.push_appointments,
        status_map: patch.status_map
          ? await cleanStatusMap(patch.status_map)
          : current.status_map,
      });
    },

    disconnectMis: async (kind: MisKind): Promise<void> => {
      if (!(await canEdit())) throw forbidden();
      const current = await find(kind);
      if (!current) return;
      await save({
        ...current,
        status: "disabled",
        has_api_key: false,
        push_appointments: false,
        last_error: null,
      });
    },

    regenerateMisToken: async (kind: MisKind): Promise<string> => {
      if (!(await canEdit())) throw forbidden();
      const current = await find(kind);
      if (!current) throw new Error("The MIS is not connected");
      const next = await save({ ...current, webhook_token: token() });
      return next.webhook_token;
    },

    linkMisDoctor: async (
      misDoctorId: Identifier,
      doctorId: Identifier | null,
    ): Promise<void> => {
      if (!(await canEdit())) throw forbidden();
      const { data: misDoctor } = await baseDataProvider.getOne<MisDoctor>(
        "mis_doctors",
        { id: misDoctorId },
      );
      await baseDataProvider.update("mis_doctors", {
        id: misDoctorId,
        data: { doctor_id: doctorId },
        previousData: misDoctor,
      });
      const visits = (await all<MisAppointment>("mis_appointments")).filter(
        (visit) =>
          visit.kind === misDoctor.kind &&
          visit.doctor_external_id === misDoctor.external_id,
      );
      for (const visit of visits) {
        await baseDataProvider.update("mis_appointments", {
          id: visit.id,
          data: { doctor_id: doctorId },
          previousData: visit,
        });
      }
    },

    testMisConnection: async (kind: MisKind): Promise<MisActionResult> => {
      if (!(await canEdit())) throw forbidden();
      const current = await find(kind);
      if (!current?.has_api_key) {
        return { ok: false, message: "Сначала сохраните ключ API" };
      }
      const message = `Демо: ${LABELS[kind]} ответила (настоящий запрос уйдёт после подключения)`;
      await log(kind, { operation: "test", result: "ok", message });
      await save({ ...current, status: "connected", last_error: null });
      return { ok: true, message };
    },

    syncMisNow: async (kind: MisKind): Promise<MisActionResult> => {
      if (!(await canEdit())) throw forbidden();
      const current = await find(kind);
      if (!current?.has_api_key || current.status === "disabled") {
        return { ok: false, message: "МИС не подключена: сохраните ключ API" };
      }
      const message = "Демо: новых изменений в МИС нет";
      await log(kind, { operation: "poll", result: "ok", message });
      await save({
        ...current,
        status: "connected",
        last_error: null,
        last_sync_at: new Date().toISOString(),
      });
      return { ok: true, message, processed: 0, skipped: 0, errors: 0 };
    },
  };

  return { methods };
};
