import { useStore, useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/ui/button";

import { PillTabs, PlusGlyph } from "./LabBits";
import { LabCouriers } from "./LabCouriers";
import { LabDictionaries } from "./LabDictionaries";
import { LabOrderDialog } from "./LabOrderDialog";
import { LabOrdersTab } from "./LabOrdersTab";
import { LabSettlement } from "./LabSettlement";
import { useLabRights } from "./useLab";

type Tab = "orders" | "couriers" | "settlement" | "dictionaries";

export type OpenOrder = (orderId?: Identifier | null) => void;

/**
 * «Лаборатория» (stage 40): the work orders to the dental labs — the board
 * «В работе» with the KPIs and the filter chips, the list, the couriers
 * «Привоз / Отвоз», the monthly lab settlement (owner, head) and the
 * dictionaries (labs, technicians, work types and prices, the doctors'
 * administrators). The integrator only sees the dictionaries.
 */
export const LabPage = () => {
  const translate = useTranslate();
  const rights = useLabRights();
  const [stored, setTab] = useStore<Tab>("lab.tab", "orders");
  const [dialog, setDialog] = useState<{
    open: boolean;
    orderId: Identifier | null;
  }>({ open: false, orderId: null });
  if (rights.isPending) return null;
  const tabs: Tab[] = [
    ...(rights.canWrite ? (["orders", "couriers"] as Tab[]) : []),
    ...(rights.seesMoney ? (["settlement"] as Tab[]) : []),
    ...(rights.canConfigure ? (["dictionaries"] as Tab[]) : []),
  ];
  if (!tabs.length) return <Navigate to="/" replace />;
  const tab = tabs.includes(stored) ? stored : tabs[0];
  const openOrder: OpenOrder = (orderId = null) =>
    setDialog({ open: true, orderId });

  return (
    <div className="flex flex-col gap-5" data-testid="lab-page">
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs
          label={translate("lab.title")}
          value={tab}
          onChange={setTab}
          options={tabs.map((value) => ({
            value,
            label: translate(`lab.tabs.${value}`),
          }))}
        />
        {rights.canWrite ? (
          <Button
            size="lg"
            className="ml-auto"
            onClick={() => openOrder(null)}
            data-testid="lab-new-order"
          >
            <PlusGlyph />
            {translate("lab.new_order")}
          </Button>
        ) : null}
      </div>
      {tab === "orders" ? (
        <LabOrdersTab onOpen={openOrder} />
      ) : tab === "couriers" ? (
        <LabCouriers onOpen={openOrder} />
      ) : tab === "settlement" ? (
        <LabSettlement />
      ) : (
        <LabDictionaries />
      )}
      <LabOrderDialog
        open={dialog.open}
        orderId={dialog.orderId}
        onClose={() => setDialog({ open: false, orderId: null })}
      />
    </div>
  );
};

LabPage.path = "/lab";
