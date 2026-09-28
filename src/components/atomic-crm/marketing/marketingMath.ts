import type { Identifier } from "ra-core";

import {
  dealProgress,
  inPeriod,
  localDate,
  type ReportData,
} from "../reports/reportMath";
import type { Deal, LeadSource } from "../types";
import type {
  AdSpend,
  MarketingFilters,
  MarketingMetrics,
  MarketingReport,
} from "./types";

/**
 * Marketing analytics of the demo (stage 32): the TypeScript twin of
 * private.utm_lead_source, the lead_sources.utm_sources trigger and
 * public.report_marketing (supabase/schemas/32_marketing.sql), with the same
 * shapes and the same rounding.
 */

/** round() of PostgreSQL numerics: half away from zero */
export const roundHalfAway = (value: number) =>
  Math.sign(value) * Math.round(Math.abs(value));

const clean = (value: string | null | undefined) => {
  const text = value?.trim();
  return text ? text : null;
};

/** Same as the lead_source_utm trigger: trimmed, lower case, no blanks, no repeats */
export const normalizeUtmSources = (values: string[] | null | undefined) => {
  const result: string[] = [];
  for (const value of values ?? []) {
    const text = clean(value)?.toLowerCase();
    if (text && !result.includes(text)) result.push(text);
  }
  return result;
};

/** «google, adwords» typed in the settings → the list */
export const parseUtmSources = (text: string) =>
  normalizeUtmSources(text.split(/[,;\n]/));

/**
 * Same as private.utm_lead_source: the source listing the value in
 * utm_sources, else the one whose code or name it is (any case)
 */
export const utmLeadSource = (
  sources: LeadSource[],
  value: string | null | undefined,
): LeadSource | undefined => {
  const needle = clean(value)?.toLowerCase();
  if (!needle) return undefined;
  const listed = (source: LeadSource) =>
    normalizeUtmSources(source.utm_sources).includes(needle);
  return sources
    .filter(
      (source) =>
        listed(source) ||
        source.code?.toLowerCase() === needle ||
        source.name.toLowerCase() === needle,
    )
    .sort(
      (a, b) =>
        Number(listed(b)) - Number(listed(a)) ||
        Number(a.is_archived) - Number(b.is_archived) ||
        a.position - b.position ||
        Number(a.id) - Number(b.id),
    )[0];
};

export const UTM_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export const ATTRIBUTION_FIELDS = [
  ...UTM_FIELDS,
  "referrer",
  "landing_page",
] as const;
export type AttributionField = (typeof ATTRIBUTION_FIELDS)[number];

/** Same as private.handle_deal_attribution: trimmed tags, blank is null */
export const normalizeAttribution = <T extends Record<string, unknown>>(
  data: T,
): T => {
  const result: Record<string, unknown> = { ...data };
  for (const field of ATTRIBUTION_FIELDS) {
    if (!(field in result)) continue;
    const value = result[field];
    const text = typeof value === "string" ? clean(value) : null;
    result[field] = text
      ? text.slice(
          0,
          field === "referrer" || field === "landing_page" ? 2000 : 500,
        )
      : null;
  }
  return result as T;
};

/** Campaigns match in any case: the key of a campaign */
export const campaignKey = (value: string | null | undefined) =>
  clean(value)?.toLowerCase() ?? null;

const DAY = 24 * 60 * 60 * 1000;
const dayNumber = (date: string) => {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY;
};

/**
 * Spend of a row within [firstDay, afterLastDay) (local dates, null: open),
 * pro rata of its days, rounded; null when it is outside
 */
export const spendInPeriod = (
  spend: Pick<AdSpend, "spent_from" | "spent_to" | "amount">,
  firstDay: string | null,
  afterLastDay: string | null,
) => {
  const from = dayNumber(spend.spent_from);
  const afterTo = dayNumber(spend.spent_to) + 1;
  const start = firstDay == null ? from : Math.max(from, dayNumber(firstDay));
  const end =
    afterLastDay == null ? afterTo : Math.min(afterTo, dayNumber(afterLastDay));
  if (end <= start) return null;
  return roundHalfAway(
    (Number(spend.amount) * (end - start)) / (afterTo - from),
  );
};

export type MarketingData = Pick<
  ReportData,
  "deals" | "stages" | "deal_events" | "deal_payments" | "lead_sources"
> & { ad_spend: AdSpend[]; timeZone?: string };

type Fact = {
  source_id: Identifier | null;
  campaign: string | null;
  spend: number;
  leads: number;
  came: number;
  paid: number;
  revenue: number;
};

const metrics = (facts: Fact[]): MarketingMetrics => {
  const sum = (key: keyof Omit<Fact, "source_id" | "campaign">) =>
    facts.reduce((total, fact) => total + fact[key], 0);
  const spend = sum("spend");
  const leads = sum("leads");
  const came = sum("came");
  const paid = sum("paid");
  const revenue = sum("revenue");
  const per = (count: number) =>
    spend > 0 && count > 0 ? roundHalfAway(spend / count) : null;
  return {
    spend,
    leads,
    came,
    paid,
    revenue,
    cpl: per(leads),
    cost_per_came: per(came),
    cost_per_paid: per(paid),
    romi: spend > 0 ? roundHalfAway(((revenue - spend) * 100) / spend) : null,
  };
};

const key = (id: Identifier | null | undefined) =>
  id == null ? "" : String(id);

/** Same as public.report_marketing */
export const marketingReport = (
  data: MarketingData,
  filters: MarketingFilters,
): MarketingReport => {
  const timeZone = data.timeZone ?? "Asia/Almaty";
  const firstDay = filters.from ? localDate(filters.from, timeZone) : null;
  const afterLastDay = filters.to ? localDate(filters.to, timeZone) : null;
  const sourceFilter = filters.source_id ?? null;
  const facts: Fact[] = [];

  for (const row of data.ad_spend) {
    if (sourceFilter != null && key(row.source_id) !== key(sourceFilter)) {
      continue;
    }
    const amount = spendInPeriod(row, firstDay, afterLastDay);
    if (amount == null) continue;
    facts.push({
      source_id: row.source_id,
      campaign: campaignKey(row.campaign),
      spend: amount,
      leads: 0,
      came: 0,
      paid: 0,
      revenue: 0,
    });
  }

  const revenueByDeal = new Map<string, number>();
  for (const payment of data.deal_payments) {
    const day = payment.paid_at.slice(0, 10);
    if (firstDay != null && day < firstDay) continue;
    if (afterLastDay != null && day >= afterLastDay) continue;
    revenueByDeal.set(
      key(payment.deal_id),
      (revenueByDeal.get(key(payment.deal_id)) ?? 0) + Number(payment.amount),
    );
  }
  const progress = dealProgress(
    {
      ...data,
      pipelines: [],
      tasks: [],
      messages: [],
      sales: [],
      services: [],
      lost_reasons: [],
    },
    { source_id: sourceFilter },
  );
  for (const row of progress) {
    if (!inPeriod(row.deal.created_at, filters)) continue;
    const revenue = revenueByDeal.get(key(row.deal.id)) ?? 0;
    facts.push({
      source_id: row.deal.source_id ?? null,
      campaign: campaignKey(row.deal.utm_campaign),
      spend: 0,
      leads: 1,
      came: row.reached_visit || row.deal.visit_at != null ? 1 : 0,
      paid: revenue > 0 ? 1 : 0,
      revenue,
    });
  }

  const sources = new Map(data.lead_sources.map((s) => [key(s.id), s]));
  const bySource = new Map<string, Fact[]>();
  for (const fact of facts) {
    const k = key(fact.source_id);
    bySource.set(k, [...(bySource.get(k) ?? []), fact]);
  }

  const rows = [...bySource.entries()].map(([k, group]) => {
    const source = sources.get(k);
    const byCampaign = new Map<string | null, Fact[]>();
    for (const fact of group) {
      byCampaign.set(fact.campaign, [
        ...(byCampaign.get(fact.campaign) ?? []),
        fact,
      ]);
    }
    const campaigns = [...byCampaign.entries()]
      .map(([campaign, list]) => ({ campaign, ...metrics(list) }))
      .sort(
        (a, b) =>
          b.spend - a.spend ||
          b.leads - a.leads ||
          (a.campaign == null ? 1 : 0) - (b.campaign == null ? 1 : 0) ||
          (a.campaign! < b.campaign! ? -1 : a.campaign! > b.campaign! ? 1 : 0),
      );
    return {
      id: group[0].source_id,
      name: source?.name ?? null,
      ...metrics(group),
      campaigns,
      _order: [
        source?.position ?? Number.POSITIVE_INFINITY,
        source ? Number(source.id) : Number.POSITIVE_INFINITY,
      ],
    };
  });
  rows.sort(
    (a, b) =>
      b.spend - a.spend ||
      b.leads - a.leads ||
      a._order[0] - b._order[0] ||
      a._order[1] - b._order[1],
  );

  return {
    totals: metrics(facts),
    by_source: rows.map(({ _order, ...row }) => row),
  };
};

/** Share of a part, in whole percent; null when there is nothing to divide */
export const conversion = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

/** «google / cpc / implant»: the tags that say where the deal came from */
export const attributionSummary = (deal: Partial<Deal>) =>
  [deal.utm_source, deal.utm_medium, deal.utm_campaign]
    .filter(Boolean)
    .join(" / ");
