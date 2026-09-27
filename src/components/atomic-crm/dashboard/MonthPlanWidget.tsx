import { Target } from "lucide-react";
import { useCanAccess, useStore, useTranslate } from "ra-core";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  PlanBar,
  useFormatMetric,
  useSalesPlan,
} from "../reports/SalesPlanTab";
import { clinicTargets, metricProgress } from "../reports/salesPlan";

/**
 * Dashboard widget «План месяца» (owner and head): the clinic's paid amount
 * of the month against its target, with the forecast to the end of the month.
 */
export const MonthPlanWidget = () => {
  const { canAccess, isPending } = useCanAccess({
    resource: "reports",
    action: "list",
  });
  if (isPending || !canAccess) return null;
  return <MonthPlanCard />;
};

const MonthPlanCard = () => {
  const translate = useTranslate();
  const format = useFormatMetric();
  const { data } = useSalesPlan(null);
  const [, setTab] = useStore<string>("reports.tab");
  if (!data) return null;
  const row = metricProgress(
    data,
    data.clinic.fact,
    clinicTargets(data),
    "paid_amount",
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <Target className="mr-3 size-4 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold text-foreground">
          {translate("sales_plan.widget.title")}
        </h2>
      </div>
      <Card
        className="gap-2 px-4 py-3"
        aria-label={translate("sales_plan.widget.title")}
      >
        <span className="text-xs text-muted-foreground">
          {translate("sales_plan.metrics.paid_amount")}
        </span>
        <span className="text-xl font-bold tabular-nums">
          {format("paid_amount", row.fact)}
        </span>
        {row.target == null ? (
          <p className="text-xs text-muted-foreground">
            {translate("sales_plan.widget.no_target")}
          </p>
        ) : (
          <>
            <PlanBar row={row} />
            <span className="text-xs tabular-nums text-muted-foreground">
              {translate("sales_plan.of_target", {
                target: format("paid_amount", row.target),
                percent:
                  row.progress == null
                    ? "—"
                    : `${Math.round(row.progress * 100)} %`,
              })}
            </span>
            {row.forecast != null ? (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  row.forecastProgress != null &&
                    row.forecastProgress < 1 &&
                    "text-brand-red",
                )}
              >
                {translate("sales_plan.forecast", {
                  value: format("paid_amount", row.forecast),
                })}
              </span>
            ) : null}
          </>
        )}
        <Link
          to="/reports"
          onClick={() => setTab("sales_plan")}
          className="text-xs font-medium text-brand-link"
        >
          {translate("sales_plan.widget.open")}
        </Link>
      </Card>
    </div>
  );
};
