import { useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useGetOne,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useCallback } from "react";

import { useMyAccessRights } from "../access-rights/useAccessRights";
import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { formatTenge } from "../onboarding/servicePresets";
import { paymentRights } from "./paymentMath";
import type { PatientAccount } from "./types";

/** «12 500 ₸» (a negative amount with «−») */
export const money = (amount: number | null | undefined) => {
  const value = Math.round(Number(amount ?? 0));
  return `${value < 0 ? "−" : ""}${formatTenge(Math.abs(value))} ₸`;
};

/** The money rights of the signed-in employee (see paymentRights) */
export const usePaymentRights = () => {
  const { data, isPending } = useMyAccessRights();
  const { data: settings } = useOrganizationSettings();
  return {
    isPending,
    me: data?.sales_id ?? null,
    role: data?.role ?? null,
    ...paymentRights(
      data?.role,
      data?.rights.reports.view,
      settings?.manager_cash_expenses,
    ),
  };
};

/** «Счёт» of a patient (public.patient_accounts) */
export const usePatientAccount = (patientId: Identifier | null | undefined) =>
  useGetOne<PatientAccount>(
    "patient_accounts",
    { id: patientId as Identifier },
    { enabled: patientId != null },
  );

/** Everything an operation changes, refreshed after it */
const TOUCHED = [
  "account_operations",
  "account_operations_summary",
  "patient_accounts",
  "treatment_plan_payments",
  "deal_payments",
  "deals",
  "cash_shifts",
  "audit_log",
  // Expenses, payouts, lab payments (stage 42)
  "payroll_month",
  "payroll_adjustments",
  "lab_payments",
  "lab_payments_summary",
  "lab_settlement",
  "cash_expenses_report",
  "cash_expense_categories",
];

export const useRefreshMoney = () => {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        TOUCHED.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    [queryClient],
  );
};

const download = (bytes: Uint8Array, name: string) => {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** The clinic in the header of the documents */
const useClinic = () => {
  const { title } = useConfigurationContext();
  const { data: settings } = useOrganizationSettings();
  return {
    name: title || "",
    city: settings?.clinic_city,
    address: settings?.clinic_address,
    phone: settings?.clinic_phone,
  };
};

/**
 * «Квитанция PDF» of an operation and «Акт выполненных работ» of a
 * patient: jsPDF and the fonts load with the first document
 */
export const useMoneyDocuments = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const clinic = useClinic();

  const receipt = async (operationId: Identifier) => {
    try {
      const [{ buildReceiptPdf }, { loadEstimateFonts }, { documentFileName }] =
        await Promise.all([
          import("./receiptPdf"),
          import("../treatment/estimateFonts"),
          import("./documents"),
        ]);
      const [{ data: operation }, fonts] = await Promise.all([
        dataProvider.getOne("account_operations_summary", {
          id: operationId,
        }),
        loadEstimateFonts(),
      ]);
      const account = await dataProvider
        .getOne<PatientAccount>("patient_accounts", {
          id: operation.patient_id,
        })
        .then((result) => result.data)
        .catch(() => null);
      download(
        buildReceiptPdf({ clinic, operation, account }, fonts, translate),
        documentFileName(
          translate("payments.receipt.file"),
          operation.id,
          operation.patient_name ?? "",
        ),
      );
    } catch (error) {
      notify((error as Error)?.message || "payments.receipt.error", {
        type: "error",
      });
    }
  };

  const act = async (
    patientId: Identifier,
    dealId?: Identifier | null,
  ): Promise<void> => {
    try {
      const [
        { buildActPdf },
        { loadEstimateFonts },
        { actLines, documentFileName },
      ] = await Promise.all([
        import("./receiptPdf"),
        import("../treatment/estimateFonts"),
        import("./documents"),
      ]);
      const everything = {
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "id", order: "ASC" as const },
      };
      const [plans, visits, account, patient, fonts] = await Promise.all([
        dataProvider
          .getList("treatment_plans", {
            ...everything,
            filter: { patient_id: patientId },
          })
          .then((r) => r.data),
        dataProvider
          .getList("visits", {
            ...everything,
            filter: { patient_id: patientId, status: "completed" },
          })
          .then((r) => r.data),
        dataProvider
          .getOne<PatientAccount>("patient_accounts", { id: patientId })
          .then((r) => r.data),
        dataProvider.getOne("patients", { id: patientId }).then((r) => r.data),
        loadEstimateFonts(),
      ]);
      const items = plans.length
        ? await dataProvider
            .getList("treatment_plan_items", {
              ...everything,
              filter: { "plan_id@in": `(${plans.map((p) => p.id).join(",")})` },
            })
            .then((r) => r.data)
        : [];
      const serviceIds = [
        ...new Set(visits.map((v) => v.service_id).filter((id) => id != null)),
      ];
      const services = serviceIds.length
        ? await dataProvider
            .getMany("services", { ids: serviceIds })
            .then((r) => r.data)
        : [];
      const lines = actLines({
        patientId,
        dealId,
        plans,
        items,
        visits,
        services,
      });
      const name =
        [patient.last_name, patient.first_name, patient.middle_name]
          .filter((part: string | null | undefined) => part?.trim())
          .join(" ") || translate("crm.deals.untitled");
      const paid = dealId
        ? await dataProvider
            .getOne("deals", { id: dealId })
            .then((r) => Number(r.data.paid_amount ?? 0))
        : account.paid;
      download(
        buildActPdf(
          {
            clinic,
            patient: { id: patientId, name, phone: patient.phones?.[0] },
            lines,
            paid,
            date: new Date(),
          },
          fonts,
          translate,
        ),
        documentFileName(translate("payments.act.file"), name),
      );
    } catch (error) {
      notify((error as Error)?.message || "payments.receipt.error", {
        type: "error",
      });
    }
  };

  return { receipt, act };
};
