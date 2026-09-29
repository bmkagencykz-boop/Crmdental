import { useStore, useTranslate } from "ra-core";
import { Navigate } from "react-router";

import { ArticlesTab } from "./ArticlesTab";
import { CashFlowTab } from "./CashFlowTab";
import { TabBar } from "./FinanceParts";
import { ModelTab } from "./ModelTab";
import { PnlTab } from "./PnlTab";
import { useFinanceRights } from "./useFinance";

const TABS = ["cash_flow", "pnl", "model", "articles"] as const;
type Tab = (typeof TABS)[number];

/**
 * «Финансы» (stage 44): ДДС, ПиУ, Финмодель, Статьи. The ДДС for whoever
 * has the reports right; the P&L, the model and the setup — the owner and
 * the head. The database checks the same (44_finance.sql).
 */
export const FinancePage = () => {
  const translate = useTranslate();
  const rights = useFinanceRights();
  const [stored, setTab] = useStore<Tab>("finance.tab", "cash_flow");
  if (rights.isPending) return null;
  if (!rights.canView && !rights.canEdit) return <Navigate to="/" replace />;
  const tabs = TABS.filter((tab) =>
    tab === "cash_flow" ? rights.canView : rights.canEdit,
  );
  const tab = tabs.includes(stored) ? stored : tabs[0];
  return (
    <div className="flex flex-col gap-5" data-testid="finance-page">
      <div>
        <h1 className="text-[30px] leading-tight font-normal tracking-[-0.03em]">
          {translate("finance.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {translate(`finance.subtitles.${tab}`)}
        </p>
      </div>
      <TabBar
        tabs={tabs.map((value) => ({ value, label: value }))}
        value={tab}
        onChange={setTab}
        label={(value) => translate(`finance.tabs.${value}`)}
      />
      {tab === "pnl" ? (
        <PnlTab />
      ) : tab === "model" ? (
        <ModelTab />
      ) : tab === "articles" ? (
        <ArticlesTab />
      ) : (
        <CashFlowTab canEdit={rights.canEdit} />
      )}
    </div>
  );
};

FinancePage.path = "/finance";
