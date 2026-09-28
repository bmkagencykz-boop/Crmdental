import { random } from "faker/locale/en_US";

import { localDate } from "../../../reports/reportMath";
import type { AdSpend } from "../../../marketing/types";
import type { Deal, LeadSource } from "../../../types";
import type { Db } from "./types";

/**
 * Marketing analytics of the demo (stage 32): a «Google» source, the
 * utm_source values of the sources, UTM tags on the deals that came from
 * adverts and a few months of ad spend per source and campaign, so that the
 * report «Маркетинг» looks like a real clinic's: Instagram and Google
 * adverts with campaigns, 2GIS and the website paid monthly, referrals free.
 */

const SITE = "https://dental-demo.kz";

type Plan = {
  utm_source: string;
  utm_medium: string;
  referrer: string;
  campaigns: Array<{ name: string; page: string }>;
  /** Cost per lead aimed at, tenge */
  cpl: number;
};

const PLANS: Record<string, Plan> = {
  Instagram: {
    utm_source: "instagram",
    utm_medium: "paid_social",
    referrer: "https://l.instagram.com/",
    campaigns: [
      { name: "implant_almaty", page: "/implant" },
      { name: "whitening", page: "/whitening" },
      { name: "braces_kids", page: "/orthodontics" },
    ],
    cpl: 4500,
  },
  Google: {
    utm_source: "google",
    utm_medium: "cpc",
    referrer: "https://www.google.com/",
    campaigns: [
      { name: "implant_search", page: "/implant" },
      { name: "brand", page: "/" },
    ],
    cpl: 9000,
  },
};

/** Monthly fixed spend of the sources without campaigns */
const MONTHLY: Record<string, { amount: number; comment: string }> = {
  "2GIS": { amount: 45000, comment: "Приоритетное размещение 2GIS" },
  Сайт: { amount: 80000, comment: "SEO и поддержка сайта" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const monthBounds = (year: number, month: number) => {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(last)}`,
  };
};

export const generateMarketing = (db: Db) => {
  const byName = (name: string) =>
    db.lead_sources.find((source) => source.name === name);
  const google: LeadSource = {
    id: Math.max(...db.lead_sources.map((s) => Number(s.id))) + 1,
    name: "Google",
    code: null,
    is_system: false,
    position: db.lead_sources.length,
    is_archived: false,
    utm_sources: ["google", "adwords"],
  };
  db.lead_sources.push(google);
  for (const source of db.lead_sources) {
    source.utm_sources ??=
      source.code === "instagram"
        ? ["instagram", "ig"]
        : source.code === "2gis"
          ? ["2gis"]
          : [];
  }

  // Deals of the website: about half came from Google adverts
  const website = byName("Сайт");
  const instagram = byName("Instagram");
  const patients = new Map(db.patients.map((p) => [p.id, p]));
  const tag = (deal: Deal, plan: Plan) => {
    const campaign = random.arrayElement(plan.campaigns);
    deal.utm_source = plan.utm_source;
    deal.utm_medium = plan.utm_medium;
    deal.utm_campaign = campaign.name;
    deal.utm_content = random.arrayElement(["video", "carousel", "text", null]);
    deal.utm_term = null;
    deal.referrer = plan.referrer;
    deal.landing_page = `${SITE}${campaign.page}`;
  };
  for (const deal of db.deals) {
    if (website && deal.source_id === website.id && random.boolean()) {
      deal.source_id = google.id;
      tag(deal, PLANS.Google);
      const patient = patients.get(deal.patient_id);
      if (patient && patient.source_id === website.id) {
        patient.source_id = google.id;
      }
    } else if (
      instagram &&
      deal.source_id === instagram.id &&
      random.number(9) < 6
    ) {
      tag(deal, PLANS.Instagram);
    } else if (website && deal.source_id === website.id) {
      deal.referrer = random.arrayElement([
        "https://yandex.kz/",
        "https://www.google.com/",
        null,
      ]);
      deal.landing_page = `${SITE}/`;
    }
  }

  // Spend of the last months (the current one included), per campaign
  const dayOf = new Map(
    db.deals.map((deal) => [deal.id, localDate(deal.created_at)]),
  );
  const spend: AdSpend[] = [];
  const now = new Date();
  const add = (row: Omit<AdSpend, "id">) =>
    spend.push({ id: spend.length + 1, ...row });
  for (let back = 4; back >= 0; back--) {
    const first = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1),
    );
    const { from, to } = monthBounds(
      first.getUTCFullYear(),
      first.getUTCMonth(),
    );
    const inMonth = (deal: Deal) => {
      const day = dayOf.get(deal.id)!;
      return day >= from && day <= to;
    };
    for (const [sourceName, plan] of Object.entries(PLANS)) {
      const source = sourceName === "Google" ? google : byName(sourceName);
      if (!source) continue;
      for (const campaign of plan.campaigns) {
        const leads = db.deals.filter(
          (deal) =>
            deal.source_id === source.id &&
            deal.utm_campaign === campaign.name &&
            inMonth(deal),
        ).length;
        // Adverts run even in a month without leads
        const factor = 0.7 + random.number(60) / 100;
        const amount =
          Math.round((Math.max(leads, 1) * plan.cpl * factor) / 1000) * 1000;
        add({
          source_id: source.id,
          campaign: campaign.name,
          spent_from: from,
          spent_to: to,
          amount,
          comment: null,
          sales_id: db.sales[0]?.id ?? null,
          created_at: `${from}T09:00:00.000Z`,
        });
      }
    }
    for (const [sourceName, monthly] of Object.entries(MONTHLY)) {
      const source = byName(sourceName);
      if (!source) continue;
      add({
        source_id: source.id,
        campaign: null,
        spent_from: from,
        spent_to: to,
        amount: monthly.amount,
        comment: monthly.comment,
        sales_id: db.sales[0]?.id ?? null,
        created_at: `${from}T09:00:00.000Z`,
      });
    }
  }
  db.ad_spend = spend;
};
