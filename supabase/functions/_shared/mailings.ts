/**
 * Dispatcher of the mailings and recall messages (edge function
 * mailings_dispatch). No Deno import here so that it can be unit tested.
 */

/** A due message, as returned by public.claim_mailing_messages */
export type ClaimedMailingMessage = {
  id: number;
  organization_id: number;
  patient_id: number;
  /** The deal the message is attached to; null: the patient's chat only */
  deal_id: number | null;
  message_text: string;
};

export type MailingSendResult =
  | { ok: true }
  | { ok: false; error: string };

/** Anti-ban: a random pause between two messages of a clinic */
export const MIN_PAUSE_MS = 5_000;
export const MAX_PAUSE_MS = 20_000;

/** A pause between MIN_PAUSE_MS and MAX_PAUSE_MS (random in [0, 1)) */
export const randomPause = (random: () => number = Math.random) =>
  Math.round(MIN_PAUSE_MS + random() * (MAX_PAUSE_MS - MIN_PAUSE_MS));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the claimed messages: clinics in parallel, the messages of a clinic
 * one after the other with a random pause of 5-20 s in between (the claim
 * already limited how many per clinic). A send that throws is a failure of
 * this message only.
 */
export const dispatchWithPauses = async (
  rows: ClaimedMailingMessage[],
  send: (row: ClaimedMailingMessage) => Promise<MailingSendResult>,
  {
    sleep = wait,
    random = Math.random,
  }: {
    sleep?: (ms: number) => Promise<unknown>;
    random?: () => number;
  } = {},
) => {
  const byClinic = new Map<number, ClaimedMailingMessage[]>();
  for (const row of rows) {
    byClinic.set(row.organization_id, [
      ...(byClinic.get(row.organization_id) ?? []),
      row,
    ]);
  }
  const results = new Map<number, MailingSendResult>();
  await Promise.all(
    [...byClinic.values()].map(async (clinicRows) => {
      for (const [index, row] of clinicRows.entries()) {
        if (index > 0) await sleep(randomPause(random));
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
