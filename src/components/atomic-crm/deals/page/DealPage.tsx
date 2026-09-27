import { ShowBase, useRecordContext, useTranslate } from "ra-core";
import { useState } from "react";
import { cn } from "@/lib/utils";

import { useMarkDealRead } from "../../messages/useMessages";
import { TagsListEdit } from "../../patients/TagsListEdit";
import type { Deal } from "../../types";
import { DealPayments } from "../DealPayments";
import { StageChecklist } from "../StageChecklist";
import { DealComposer, type ComposerMode } from "./DealComposer";
import { DealFeed } from "./DealFeed";
import { DealFields } from "./DealFields";
import { DealHeader } from "./DealHeader";
import { PatientBlock } from "./PatientBlock";

/**
 * The deal card as a page, amoCRM layout in the CRM design: on the left the
 * stage and every field (edited in place) and the patient, on the right the
 * conversation and the history, the tasks and one input for everything.
 */
export const DealPage = () => (
  <ShowBase resource="deals">
    <DealPageContent />
  </ShowBase>
);

type Tab = "main" | "payments";

const DealPageContent = () => {
  const translate = useTranslate();
  const deal = useRecordContext<Deal>();
  const [tab, setTab] = useState<Tab>("main");
  const [mode, setMode] = useState<ComposerMode>("chat");
  useMarkDealRead(deal);
  if (!deal) return null;

  return (
    <div className="grid h-[calc(100vh-7.5rem)] min-h-[36rem] grid-cols-[27rem_1fr] gap-5">
      <aside className="glass flex min-h-0 flex-col overflow-hidden rounded-[1.75rem]">
        <DealHeader deal={deal} />
        <div className="px-6 pb-3">
          <TagsListEdit resource="deals" />
        </div>
        <nav
          className="flex gap-5 border-b border-border px-6 text-sm font-semibold"
          role="tablist"
        >
          {(["main", "payments"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "-mb-px border-b-2 pb-2.5 transition-colors",
                tab === value
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {translate(`crm.deals.page.tabs.${value}`)}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "main" ? (
            <>
              <div className="flex flex-col gap-4 px-4 py-4">
                <StageChecklist deal={deal} />
                <DealFields deal={deal} />
              </div>
              <PatientBlock deal={deal} />
            </>
          ) : (
            <div className="px-6 py-5">
              <DealPayments deal={deal} />
            </div>
          )}
        </div>
      </aside>
      <section className="glass flex min-h-0 flex-col overflow-hidden rounded-[1.75rem]">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DealFeed deal={deal} />
        </div>
        <DealComposer deal={deal} mode={mode} setMode={setMode} />
      </section>
    </div>
  );
};
