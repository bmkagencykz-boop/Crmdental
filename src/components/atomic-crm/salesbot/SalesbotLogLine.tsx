import { useTranslate } from "ra-core";

import { actionSummary } from "./labels";
import type { SalesbotLog, SetAction } from "./types";
import { useBotDictionaries } from "./useBotDictionaries";

const time = (value: unknown) =>
  typeof value === "string"
    ? new Date(value).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const shorten = (text: string | null | undefined, length = 90) => {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
};

/**
 * «Бот: отправил …», «Бот: ждёт ответа до 14:30», «Бот передал диалог»: a
 * line of the deal feed.
 */
export const SalesbotLogLine = ({ log }: { log: SalesbotLog }) => {
  const translate = useTranslate();
  const lookups = useBotDictionaries();
  switch (log.kind) {
    case "started":
      return (
        <>{translate("salesbot.feed.started", { name: log.text ?? "" })}</>
      );
    case "sent":
      return (
        <>{translate("salesbot.feed.sent", { text: shorten(log.text) })}</>
      );
    case "waiting":
    case "delay":
      return (
        <>
          {translate(`salesbot.feed.${log.kind}`, {
            time: time(log.details.until),
          })}
        </>
      );
    case "set": {
      const action = log.details.action as SetAction | undefined;
      return (
        <>
          {translate("salesbot.feed.set", {
            what: action
              ? actionSummary(action, translate, lookups)
              : translate("salesbot.feed.set_other"),
          })}
        </>
      );
    }
    case "task":
      return (
        <>{translate("salesbot.feed.task", { text: shorten(log.text) })}</>
      );
    case "handoff":
      return (
        <>
          {log.text
            ? translate("salesbot.feed.handoff_note", { text: log.text })
            : translate("salesbot.feed.handoff")}
        </>
      );
    case "skipped":
    case "failed":
    case "stopped":
      return (
        <>{translate(`salesbot.feed.${log.kind}`, { text: log.text ?? "" })}</>
      );
    default:
      return <>{translate(`salesbot.feed.${log.kind}`)}</>;
  }
};
