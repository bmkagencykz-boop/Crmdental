import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import {
  marketingReport,
  normalizeAttribution,
  normalizeUtmSources,
  utmLeadSource,
} from "../../marketing/marketingMath";
import type {
  AdSpend,
  MarketingFilters,
  MarketingReport,
} from "../../marketing/types";
import type {
  Deal,
  DealEvent,
  DealPayment,
  LeadSource,
  Organization,
  Sale,
  Stage,
} from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const forbidden = () =>
  Object.assign(new Error("Расходы на рекламу видят владелец и руководитель"), {
    code: "42501",
  });

/**
 * Marketing analytics of the demo (stage 32): the same rules as
 * supabase/schemas/32_marketing.sql — the ad spend for the owner and the
 * head only, trimmed UTM tags on the deals, utm_source → lead source for a
 * deal without a source, normalized utm_sources, and the report
 * (marketing/marketingMath.ts).
 */
export const createMarketingDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
}) => {
  const seesMoney = async () => {
    const salesId = await currentSalesId();
    const role =
      (await all<Sale>("sales")).find((sale) => same(sale.id, salesId))?.role ??
      "owner";
    return role === "owner" || role === "head";
  };
  const checkMoney = async () => {
    if (!(await seesMoney())) throw forbidden();
  };
  const cleanSpend = (data: Partial<AdSpend>) => ({
    ...data,
    ...("campaign" in data ? { campaign: data.campaign?.trim() || null } : {}),
    ...("comment" in data ? { comment: data.comment?.trim() || null } : {}),
  });

  /** Same as private.handle_deal_attribution */
  const attribute = async (data: Partial<Deal>, previous?: Deal) => {
    const result = normalizeAttribution(data);
    const sourceId =
      "source_id" in result ? result.source_id : previous?.source_id;
    const utmSource =
      "utm_source" in result ? result.utm_source : previous?.utm_source;
    if (
      sourceId == null &&
      utmSource &&
      (!previous || utmSource !== previous.utm_source)
    ) {
      const source = utmLeadSource(
        await all<LeadSource>("lead_sources"),
        utmSource,
      );
      if (source) result.source_id = source.id;
    }
    return result;
  };

  const methods = {
    /** Same as public.report_marketing */
    getMarketingReport: async (
      filters: MarketingFilters,
    ): Promise<MarketingReport> => {
      if (!(await seesMoney())) throw new Error("reports.forbidden");
      const [deals, stages, events, payments, sources, spend, organizations] =
        await Promise.all([
          all<Deal>("deals"),
          all<Stage>("stages"),
          all<DealEvent>("deal_events"),
          all<DealPayment>("deal_payments"),
          all<LeadSource>("lead_sources"),
          all<AdSpend>("ad_spend"),
          all<Organization>("organizations"),
        ]);
      return marketingReport(
        {
          deals,
          stages,
          deal_events: events,
          deal_payments: payments,
          lead_sources: sources,
          ad_spend: spend,
          timeZone: organizations[0]?.timezone,
        },
        filters,
      );
    },
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "ad_spend",
      afterGetList: async (result) =>
        (await seesMoney()) ? result : { ...result, data: [], total: 0 },
      afterGetMany: async (result) =>
        (await seesMoney()) ? result : { ...result, data: [] },
      beforeCreate: async (params) => {
        await checkMoney();
        return {
          ...params,
          data: {
            ...cleanSpend(params.data),
            sales_id: (await currentSalesId()) ?? null,
            created_at: new Date().toISOString(),
          },
        };
      },
      beforeUpdate: async (params) => {
        await checkMoney();
        return { ...params, data: cleanSpend(params.data) };
      },
      beforeDelete: async (params) => {
        await checkMoney();
        return params;
      },
      beforeDeleteMany: async (params) => {
        await checkMoney();
        return params;
      },
    },
    {
      resource: "deals",
      beforeCreate: async (params) => ({
        ...params,
        data: await attribute(params.data),
      }),
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<Deal>(
          "deals",
          { id: params.id },
        );
        return { ...params, data: await attribute(params.data, previous) };
      },
    },
    {
      resource: "lead_sources",
      beforeSave: async (data) =>
        "utm_sources" in data
          ? { ...data, utm_sources: normalizeUtmSources(data.utm_sources) }
          : data,
    },
  ];

  return { methods, callbacks };
};
