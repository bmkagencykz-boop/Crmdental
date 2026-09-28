import { useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import { formatTenge } from "../onboarding/servicePresets";
import type { Deal } from "../types";
import { formatDate } from "./format";
import { MainPlanMark, PlanStatusBadge } from "./PlanBits";
import { PlanEditor } from "./PlanEditor";
import { progressPlan, remainingToPay } from "./planMath";
import { usePlanMutations, usePlanRights, usePlans } from "./useTreatmentPlans";

const tenge = (amount: number) => `${formatTenge(amount)} ₸`;

/**
 * Tab «План лечения» of the deal page: the plans of the deal (variants)
 * with their status and total, the progress of the main plan («Выполнено N
 * из M») and what is left to pay. A plan opens in a wide editor.
 */
export const DealTreatmentPlans = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: plans = [], isPending } = usePlans({ deal_id: deal.id });
  const { canEdit } = usePlanRights();
  const { createPlan } = usePlanMutations();
  const [openId, setOpenId] = useState<Identifier | null>(null);
  const open = plans.find((plan) => String(plan.id) === String(openId));
  const main = progressPlan(plans);

  const newPlan = () =>
    createPlan.mutate(
      {
        deal_id: deal.id,
        name: plans.length
          ? translate("treatment.plans.variant_name", { n: plans.length + 1 })
          : translate("treatment.plans.default_name"),
      },
      { onSuccess: (plan) => setOpenId(plan.id) },
    );

  if (isPending) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="deal-treatment-plans">
      {main ? (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Figure
            label={translate("treatment.totals.plan_amount")}
            value={tenge(deal.plan_amount ?? 0)}
          />
          <Figure
            label={translate("treatment.totals.progress", {
              done: main.done_count,
              total: main.items_count,
            })}
            value={`${main.items_count ? Math.round((main.done_count / main.items_count) * 100) : 0}%`}
          />
          <Figure
            label={translate("treatment.totals.paid")}
            value={tenge(deal.paid_amount ?? 0)}
          />
          <Figure
            label={translate("treatment.totals.rest")}
            value={tenge(
              remainingToPay(deal.plan_amount ?? 0, deal.paid_amount ?? 0),
            )}
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {translate("treatment.plans.title")}
        </h3>
        {canEdit ? (
          <Button size="sm" onClick={newPlan} disabled={createPlan.isPending}>
            {translate("treatment.actions.new_plan")}
          </Button>
        ) : null}
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("treatment.plans.empty")}
        </p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-border rounded-md border border-border"
          aria-label={translate("treatment.plans.title")}
        >
          {plans.map((plan) => (
            <li key={plan.id}>
              <button
                type="button"
                onClick={() => setOpenId(plan.id)}
                className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {plan.name}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {tenge(plan.total_amount)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <PlanStatusBadge status={plan.status} />
                  {plan.is_main ? <MainPlanMark /> : null}
                  <span>
                    {translate("treatment.plans.items_count", {
                      smart_count: plan.items_count,
                    })}
                  </span>
                  {plan.done_count ? (
                    <span>
                      ·{" "}
                      {translate("treatment.totals.progress", {
                        done: plan.done_count,
                        total: plan.items_count,
                      })}
                    </span>
                  ) : null}
                  <span className="ml-auto">
                    {plan.agreed_at
                      ? translate("treatment.plans.agreed_at", {
                          date: formatDate(new Date(plan.agreed_at)),
                        })
                      : translate("treatment.plans.created", {
                          date: formatDate(new Date(plan.created_at)),
                        })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open != null}
        onOpenChange={(value) => {
          if (!value) setOpenId(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogTitle className="sr-only">
            {open?.name ?? translate("treatment.tab")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {translate("treatment.tab")}
          </DialogDescription>
          {open ? (
            <PlanEditor
              deal={deal}
              plan={open}
              onDuplicated={() => setOpenId(null)}
              onDeleted={() => setOpenId(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Figure = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-card/70 px-3 py-2">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="font-semibold tabular-nums">{value}</div>
  </div>
);
