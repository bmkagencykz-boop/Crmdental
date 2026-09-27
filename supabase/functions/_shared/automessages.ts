/**
 * Dispatcher of the automatic messages (edge function automessages_dispatch).
 * No Deno import here so that it can be unit tested.
 */

/** A due message, as returned by public.claim_automessages */
export type ClaimedAutomessage = {
  id: number;
  organization_id: number;
  deal_id: number;
  patient_id: number;
  message_text: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

/** Wazzup24 is not a mass mailer: a few messages per second per clinic */
export const MESSAGES_PER_SECOND = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the claimed messages: clinics in parallel, the messages of a clinic
 * one after the other, at most `perSecond` per second. A send that throws is
 * a failure of this message only.
 */
export const dispatchThrottled = async (
  rows: ClaimedAutomessage[],
  send: (row: ClaimedAutomessage) => Promise<SendResult>,
  {
    perSecond = MESSAGES_PER_SECOND,
    sleep = wait,
  }: { perSecond?: number; sleep?: (ms: number) => Promise<unknown> } = {},
) => {
  const byClinic = new Map<number, ClaimedAutomessage[]>();
  for (const row of rows) {
    byClinic.set(row.organization_id, [
      ...(byClinic.get(row.organization_id) ?? []),
      row,
    ]);
  }
  const interval = Math.ceil(1000 / perSecond);
  const results = new Map<number, SendResult>();
  await Promise.all(
    [...byClinic.values()].map(async (clinicRows) => {
      for (const [index, row] of clinicRows.entries()) {
        if (index > 0) await sleep(interval);
        try {
          results.set(row.id, await send(row));
        } catch (error) {
          results.set(row.id, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }),
  );
  return results;
};

/**
 * The dispatcher is started by pg_cron with a secret key (Vault
 * automessages_dispatch_key = function secret AUTOMESSAGES_DISPATCH_KEY), or
 * by hand with the service role key.
 */
export const isDispatchAuthorized = (
  authorization: string | null,
  keys: (string | undefined | null)[],
) => {
  const token = authorization?.match(/^Bearer\s+(.+)$/)?.[1]?.trim();
  return !!token && keys.some((key) => !!key && key === token);
};

/** Error text stored on the automessage, in Russian for the deal page */
export const describeSendError = (code: string, detail?: string) => {
  switch (code) {
    case "not_connected":
      return "Мессенджеры не подключены (Настройки → Мессенджеры)";
    case "no_route":
      return "Нет чата пациента и номера для WhatsApp";
    case "send_failed":
      return `Wazzup24 не принял сообщение${detail ? `: ${detail}` : ""}`;
    default:
      return detail || code;
  }
};
