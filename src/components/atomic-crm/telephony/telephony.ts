import type { Call, TelephonyProvider } from "../types";

export const TELEPHONY_PROVIDERS: TelephonyProvider[] = [
  "binotel",
  "zadarma",
  "mango",
  "sipuni",
  "generic",
];

type ProviderText =
  | "providers"
  | "secret_help"
  | "api_key_help"
  | "instructions";

/**
 * Translation key of a text of a provider. Sipuni (stage 27) keeps its
 * texts in its own namespace «sipuni».
 */
export const providerTextKey = (
  provider: TelephonyProvider,
  text: ProviderText,
) =>
  provider === "sipuni"
    ? `sipuni.${text === "providers" ? "name" : text}`
    : `telephony.${text}.${provider}`;

/**
 * Does the provider use the secret and the API key fields? Sipuni does not
 * sign its events and its recording links come with them: none.
 */
export const providerUsesKeys = (provider: TelephonyProvider) =>
  provider !== "sipuni";

/**
 * Address of the telephony_webhook edge function for the clinic's PBX.
 * Mango Office appends /events/<event> to the address, so it gets the
 * token in the path; the others get it in the query.
 */
export const telephonyWebhookUrl = (
  baseUrl: string,
  provider: TelephonyProvider,
  token: string,
) => {
  const functionUrl = `${baseUrl.replace(/\/+$/, "")}/functions/v1/telephony_webhook`;
  return provider === "mango"
    ? `${functionUrl}/mango/${encodeURIComponent(token)}`
    : `${functionUrl}?provider=${provider}&token=${encodeURIComponent(token)}`;
};

/**
 * Translation key of the status of a call from the PBX. Calls logged by
 * hand show none; an unanswered outgoing call is "no answer", not "missed".
 */
export const callStatusKey = (
  call: Pick<Call, "status" | "direction" | "provider">,
) => {
  if (!call.status || !call.provider) return null;
  if (call.status === "missed" && call.direction === "out") {
    return "telephony.call.status.no_answer";
  }
  return `telephony.call.status.${call.status}`;
};
