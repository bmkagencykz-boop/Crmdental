import {
  ShowBase,
  useCanAccess,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { cn } from "@/lib/utils";

import { useMarkDealRead } from "../../messages/useMessages";
import { TagsListEdit } from "../../patients/TagsListEdit";
import type { Deal } from "../../types";
import { DealAutomessages } from "../DealAutomessages";
import { DealPayments } from "../DealPayments";
import { DealFiles } from "../../files/DealFiles";
import { StageChecklist } from "../StageChecklist";
import { StageScript } from "../StageScript";
import { DealComposer, type ComposerMode } from "./DealComposer";
import { DealFeed } from "./DealFeed";
import { DealFields } from "./DealFields";
import { DealHeader } from "./DealHeader";
import { PatientBlock } from "./PatientBlock";
import { UnsortedBanner } from "../../unsorted/UnsortedBanner";
import { MisDealBadge, MisVisits } from "../../mis/MisVisits";
import { DealVisits } from "../../schedule/DealVisits";
import { DealTreatmentPlans } from "../../treatment/DealTreatmentPlans";
import { DealAttribution } from "../../marketing/DealAttribution";

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

type Tab = "main" | "payments" | "treatment" | "files";

const DealPageContent = () => {
  const translate = useTranslate();
  const deal = useRecordContext<Deal>();
  const [tab, setTab] = useState<Tab>("main");
  const [mode, setMode] = useState<ComposerMode>("chat");
  // Treatment plans (stage 29): not for the integrator (no money)
  const { canAccess: canSeePlans = false } = useCanAccess({
    resource: "treatment_plans",
    action: "list",
  });
  useMarkDealRead(deal);
  if (!deal) return null;

  return (
    <div className="grid h-[calc(100vh-6.5rem)] min-h-[36rem] grid-cols-[27rem_1fr] gap-5">
      <aside className="glass flex min-h-0 flex-col overflow-hidden rounded-md">
        <UnsortedBanner deal={deal} />
        <DealHeader deal={deal} />
        <div className="flex items-start gap-2 px-5 pb-3">
          <MisDealBadge deal={deal} />
          <div className="min-w-0 flex-1">
            <TagsListEdit resource="deals" />
          </div>
        </div>
        <nav
          className="flex gap-5 border-b border-border px-5 text-sm font-medium"
          role="tablist"
        >
          {(
            [
              "main",
              "payments",
              ...(canSeePlans ? (["treatment"] as const) : []),
              "files",
            ] as const
          ).map((value) => (
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
              {translate(
                value === "files"
                  ? "files.tab"
                  : value === "treatment"
                    ? "treatment.tab"
                    : `crm.deals.page.tabs.${value}`,
              )}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "main" ? (
            <>
              <div className="flex flex-col gap-4 px-4 py-4">
                <StageScript deal={deal} />
                <StageChecklist deal={deal} />
                <DealAutomessages deal={deal} />
                <DealFields deal={deal} />
              </div>
              <DealAttribution deal={deal} />
              <DealVisits deal={deal} />
              <PatientBlock deal={deal} />
              <MisVisits patientId={deal.patient_id} compact />
            </>
          ) : tab === "payments" ? (
            <div className="px-5 py-4">
              <DealPayments deal={deal} />
            </div>
          ) : tab === "treatment" ? (
            <div className="px-5 py-4">
              <DealTreatmentPlans deal={deal} />
            </div>
          ) : (
            <div className="px-5 py-4">
              <DealFiles deal={deal} />
            </div>
          )}
        </div>
      </aside>
      <section className="glass flex min-h-0 flex-col overflow-hidden rounded-md">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DealFeed deal={deal} />
        </div>
        <DealComposer deal={deal} mode={mode} setMode={setMode} />
      </section>
    </div>
  );
};
