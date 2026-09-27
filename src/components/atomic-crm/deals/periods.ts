/** Period filter of the board: deals created since N days ago (start of day) */
export const PERIODS = [
  { key: "today", days: 0 },
  { key: "week", days: 7 },
  { key: "month", days: 30 },
  { key: "quarter", days: 90 },
] as const;

export const periodStart = (days: number, now = new Date()) => {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

/** Choices whose ids stay the same all day long (they are kept in the URL) */
export const periodChoices = (
  translate: (key: string) => string,
  now = new Date(),
) =>
  PERIODS.map(({ key, days }) => ({
    id: periodStart(days, now),
    name: translate(`crm.deals.periods.${key}`),
  }));
