const pad = (value: number) => String(value).padStart(2, "0");

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * amoCRM-style card date: "Сегодня 11:14", "Вчера 11:14" or "19.09.2026".
 */
export const formatCardDate = (
  value: string | undefined,
  labels: { today: string; yesterday: string },
  now = new Date(),
) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (isSameDay(date, now)) return `${labels.today} ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `${labels.yesterday} ${time}`;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
};

export const formatMoney = (
  amount: number | null | undefined,
  currency: string,
  compact = false,
) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: compact ? 1 : 0,
    ...(compact ? { notation: "compact" as const } : {}),
  }).format(amount ?? 0);
