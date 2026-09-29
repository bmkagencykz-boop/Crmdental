import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useTranslate } from "ra-core";
import { useSearchParams } from "react-router";

import { money } from "../payments/usePayments";
import type { CrmDataProvider } from "../providers/types";
import { todayKey } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import { monthStart } from "./payrollMath";
import type { PayrollEmployee, PayrollScheme } from "./types";

/** The month of the address (?month=YYYY-MM), this month by default */
export const useMonthParam = () => {
  const timeZone = useClinicTimeZone();
  const [params, setParams] = useSearchParams();
  const raw = params.get("month");
  const month = /^\d{4}-\d{2}/.test(raw ?? "")
    ? monthStart(raw!)
    : monthStart(todayKey(timeZone));
  const setMonth = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("month", value.slice(0, 7));
        return next;
      },
      { replace: true },
    );
  return [month, setMonth] as const;
};

export const PAYROLL_KEY = "payroll_month";

/** «Зарплаты» of a month (public.payroll_month) */
export const usePayrollMonth = (month: string) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: [PAYROLL_KEY, month],
    queryFn: () => dataProvider.getPayrollMonth(month),
  });
};

/** Refresh the month after a scheme, an adjustment or a closing */
export const useRefreshPayroll = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: [PAYROLL_KEY] });
    for (const resource of ["payroll_schemes", "payroll_adjustments"]) {
      queryClient.invalidateQueries({ queryKey: [resource] });
    }
  };
};

/** The specialty of a doctor, the role of an employee */
export const useEmployeeRole = () => {
  const translate = useTranslate();
  return (employee: Pick<PayrollEmployee, "kind" | "specialty">) =>
    employee.kind === "sales"
      ? translate(`payroll.roles.${employee.specialty ?? "manager"}`, {
          _: employee.specialty ?? "",
        })
      : (employee.specialty ?? translate("payroll.card.doctor"));
};

/** «25 % от цены работ · Терапия 30 % · оклад 150 000 ₸ …» */
export const useSchemeSummary = () => {
  const translate = useTranslate();
  return (
    scheme: PayrollScheme | null | undefined,
    categoryName: (
      id: PayrollScheme["category_rates"][number]["category_id"],
    ) => string,
  ) => {
    if (!scheme) return translate("payroll.card.no_scheme");
    const parts: string[] = [];
    if (Number(scheme.percent) > 0 || scheme.category_rates.length) {
      parts.push(
        translate("payroll.summary_text.percent", {
          percent: Number(scheme.percent),
          base: translate(`payroll.scheme.bases.${scheme.percent_base}`),
        }),
      );
    }
    for (const rate of scheme.category_rates) {
      parts.push(
        translate("payroll.summary_text.rate", {
          name: categoryName(rate.category_id),
          percent: Number(rate.percent),
        }),
      );
    }
    if (scheme.deduct_materials)
      parts.push(translate("payroll.summary_text.materials"));
    if (Number(scheme.fixed_salary) > 0)
      parts.push(
        translate("payroll.summary_text.fixed", {
          amount: money(scheme.fixed_salary),
        }),
      );
    if (Number(scheme.visit_rate) > 0)
      parts.push(
        translate("payroll.summary_text.visit", {
          amount: money(scheme.visit_rate),
        }),
      );
    if (Number(scheme.min_guaranteed) > 0)
      parts.push(
        translate("payroll.summary_text.minimum", {
          amount: money(scheme.min_guaranteed),
        }),
      );
    return parts.join(" · ") || translate("payroll.summary_text.empty");
  };
};

/** «14 сент.» */
export const shortDay = (day: string | null) =>
  day
    ? new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "—";
