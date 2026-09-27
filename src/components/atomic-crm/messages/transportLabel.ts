import type { MessengerTransport } from "../types";

/** Translation key of a messenger's name (the bot has its own namespace) */
export const transportLabelKey = (transport: MessengerTransport) =>
  transport === "telegram_bot"
    ? "telegram.transport"
    : `crm.messages.transport.${transport}`;
