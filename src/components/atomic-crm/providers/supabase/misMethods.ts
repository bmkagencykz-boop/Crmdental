import type { Identifier } from "ra-core";

import type {
  MisActionResult,
  MisConnection,
  MisConnectionPatch,
  MisKind,
} from "../../mis/types";
import { functionsBaseUrl } from "../../leads/leadWebhook";
import { misWebhookUrl } from "../../mis/misConnectors";
import { getSupabaseClient } from "./supabase";

const withWebhookUrl = (connection: MisConnection | null) =>
  connection
    ? {
        ...connection,
        webhook_url: misWebhookUrl(
          functionsBaseUrl(
            import.meta.env.VITE_SUPABASE_URL ?? "",
            import.meta.env.VITE_WEBHOOK_BASE_URL,
          ),
          connection.kind,
          connection.webhook_token,
        ),
      }
    : null;

/** Message of a failed edge function call (its JSON body when there is one) */
const functionError = async (error: any): Promise<MisActionResult> => {
  try {
    const body = await error?.context?.json();
    if (body?.message) return { ok: false, message: String(body.message) };
  } catch {
    // not a JSON body
  }
  return { ok: false, message: error?.message ?? "Error" };
};

/**
 * MIS connectors (stage 27): the settings of Dentist Plus and MacDent go
 * through the public.*_mis_* functions (owner and head, the API key never
 * comes back); the test and the manual sync call the edge functions with
 * the employee's session. The log, the MIS doctors and the synced visits
 * are the resources mis_sync_log, mis_doctors and mis_appointments.
 */
export const getMisMethods = () => ({
  async getMisConnection(kind: MisKind): Promise<MisConnection | null> {
    const { data, error } = await getSupabaseClient().rpc(
      "mis_connection_status",
      { connection_kind: kind },
    );
    if (error) throw error;
    return withWebhookUrl((data as MisConnection | null) ?? null);
  },
  async saveMisConnection(
    kind: MisKind,
    patch: MisConnectionPatch,
  ): Promise<MisConnection> {
    const { data, error } = await getSupabaseClient().rpc(
      "save_mis_connection",
      { connection_kind: kind, connection_settings: patch },
    );
    if (error) throw error;
    return withWebhookUrl(data as MisConnection)!;
  },
  async disconnectMis(kind: MisKind): Promise<void> {
    const { error } = await getSupabaseClient().rpc("disconnect_mis", {
      connection_kind: kind,
    });
    if (error) throw error;
  },
  async regenerateMisToken(kind: MisKind): Promise<string> {
    const { data, error } = await getSupabaseClient().rpc(
      "regenerate_mis_token",
      { connection_kind: kind },
    );
    if (error) throw error;
    return data as string;
  },
  async linkMisDoctor(
    misDoctorId: Identifier,
    doctorId: Identifier | null,
  ): Promise<void> {
    const { error } = await getSupabaseClient().rpc("link_mis_doctor", {
      mis_doctor_id: misDoctorId,
      target_doctor_id: doctorId,
    });
    if (error) throw error;
  },
  /** «Проверить подключение»: the vendor API with the stored key */
  async testMisConnection(kind: MisKind): Promise<MisActionResult> {
    const { data, error } =
      await getSupabaseClient().functions.invoke<MisActionResult>(
        "mis_test_connection",
        { method: "POST", body: { kind } },
      );
    if (error) return functionError(error);
    return data ?? { ok: false, message: "Error" };
  },
  /** «Синхронизировать сейчас»: changes since the last sync, then the push */
  async syncMisNow(kind: MisKind): Promise<MisActionResult> {
    const { data, error } =
      await getSupabaseClient().functions.invoke<MisActionResult>("mis_sync", {
        method: "POST",
        body: { kind },
      });
    if (error) return functionError(error);
    return data ?? { ok: false, message: "Error" };
  },
});
