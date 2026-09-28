import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

import { formatTenge } from "../onboarding/servicePresets";
import type { Deal } from "../types";
import { formatDate } from "./format";
import { MainPlanMark, PlanStatusBadge } from "./PlanBits";
import { planPath } from "./planUi";
import { progressPlan, remainingToPay } from "./planMath";
import { usePlanRights, usePlans } from "./useTreatmentPlans";

const tenge = (amount: number) => `${formatTenge(amount)} ₸`;

/**
 * Tab «План лечения» of the deal page: the plans of the deal (variants)
 * with their status and total, the progress of the main plan («Выполнено N
 * из M») and what is left to pay. A plan opens as a full page (stage 34):
 * /patients/:patientId/plans/:planId.
 */
export const DealTreatmentPlans = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: plans = [], isPending } = usePlans({ deal_id: deal.id });
  const { canEdit } = usePlanRights();
  const main = progressPlan(plans);

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
        {canEdit && deal.patient_id != null ? (
          <Button size="sm" asChild>
            <Link to={planPath(deal.patient_id, "new", deal.id)}>
              {translate("treatment.actions.new_plan")}
            </Link>
          </Button>
        ) : null}
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("treatment.plans.empty")}
        </p>
      ) : (
        <ul
          className="flex flex-col gap-1.5"
          aria-label={translate("treatment.plans.title")}
        >
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                to={planPath(plan.patient_id, plan.id)}
                aria-label={translate("plan_editor.open_plan", {
                  name: plan.name,
                })}
                className="flex w-full flex-col gap-1 rounded-2xl bg-pill px-4 py-3 text-left text-foreground no-underline transition-colors hover:bg-pill-hover"
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * On the main tab of the deal page: the main plan (or the latest one) as a
 * pill that opens the plan page, with its total.
 */
export const DealPlanLink = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: plans = [] } = usePlans({ deal_id: deal.id });
  const plan =
    plans.find((p) => p.is_main) ??
    [...plans].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!plan) return null;
  return (
    <Link
      to={planPath(plan.patient_id, plan.id)}
      aria-label={translate("plan_editor.open_plan", { name: plan.name })}
      className="flex items-center gap-3 rounded-2xl bg-pill px-4 py-2.5 text-sm text-foreground no-underline transition-colors hover:bg-pill-hover"
      data-testid="deal-plan-link"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">
          {translate("plan_editor.title")}
        </span>
        <span className="block truncate">{plan.name}</span>
      </span>
      <span className="font-light tabular-nums">
        {tenge(plan.total_amount)}
      </span>
      <span
        className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
        aria-hidden
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 17L17 7M9 7h8v8" />
        </svg>
      </span>
    </Link>
  );
};

const Figure = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl bg-pill px-3 py-2">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-lg font-light tabular-nums">{value}</div>
  </div>
);
