/** Months of the ad spend editor: "YYYY-MM" ↔ local dates "YYYY-MM-DD" */

const pad = (n: number) => String(n).padStart(2, "0");

/** First and last day of a month */
export const monthRange = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${year}-${pad(m)}-01`, to: `${year}-${pad(m)}-${pad(last)}` };
};

/** The month `delta` months later (earlier when negative) */
export const shiftMonth = (month: string, delta: number) => {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
};

const short = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * The range of a spend row: null when it is the whole month shown, else
 * «16.08–15.09»
 */
export const spendPeriodLabel = (
  row: { spent_from: string; spent_to: string },
  monthFrom: string,
  monthTo: string,
) =>
  row.spent_from === monthFrom && row.spent_to === monthTo
    ? null
    : `${short(row.spent_from)}–${short(row.spent_to)}`;
