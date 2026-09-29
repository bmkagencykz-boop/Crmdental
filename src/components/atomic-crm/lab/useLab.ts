import { useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useCallback, useMemo } from "react";

import { useMyAccessRights } from "../access-rights/useAccessRights";
import { inBranch } from "../branches/branches";
import { useCurrentBranch } from "../branches/useBranches";
import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { localDay } from "./labMath";
import type {
  Lab,
  LabOrderItem,
  LabOrderItemPrice,
  LabOrderSummary,
  LabRemakeReason,
  LabTechnician,
  LabWorkType,
  LabWorkTypePrice,
  LabWorkTypeTerm,
} from "./types";

const same = (a: unknown, b: unknown) =>
  a != null && b != null && String(a) === String(b);

// A stable empty list while loading: callers memoize on it
const EMPTY: never[] = [];
const all = { page: 1, perPage: 1000 };
const byPosition = { field: "position", order: "ASC" as const };

/**
 * The lab rights of the signed-in employee, like the database: the owner,
 * the head and the managers write orders; the prices and the settlement are
 * for the owner and the head; the dictionaries for whoever configures the
 * clinic (the integrator too, who sees no order).
 */
export const labRights = (role: string | null | undefined) => ({
  canWrite: role === "owner" || role === "head" || role === "manager",
  seesMoney: role === "owner" || role === "head",
  canConfigure: role === "owner" || role === "head" || role === "integrator",
});

export const useLabRights = () => {
  const { data, isPending } = useMyAccessRights();
  const role = data?.role ?? null;
  const me = data?.sales_id ?? null;
  const rights = labRights(role);
  return {
    isPending,
    role,
    me,
    ...rights,
    /** The owner, the head, or the author of an order still in the clinic */
    canDelete: (order: Pick<LabOrderSummary, "created_by" | "status">) =>
      rights.seesMoney ||
      (role === "manager" &&
        same(order.created_by, me) &&
        order.status === "clinic"),
  };
};

/** Labs, technicians, work types and (owner, head) their prices */
export const useLabDictionaries = () => {
  const { seesMoney } = useLabRights();
  const labs = useGetList<Lab>("labs", {
    pagination: all,
    sort: byPosition,
  });
  const technicians = useGetList<LabTechnician>("lab_technicians", {
    pagination: all,
    sort: byPosition,
  });
  const workTypes = useGetList<LabWorkType>("lab_work_types", {
    pagination: all,
    sort: byPosition,
  });
  const prices = useGetList<LabWorkTypePrice>(
    "lab_work_type_prices",
    { pagination: all, sort: { field: "id", order: "ASC" } },
    { enabled: seesMoney },
  );
  // Stage 43: the labs' own terms and the reasons of a remake
  const terms = useGetList<LabWorkTypeTerm>("lab_work_type_terms", {
    pagination: all,
    sort: { field: "id", order: "ASC" },
  });
  const reasons = useGetList<LabRemakeReason>("lab_remake_reasons", {
    pagination: all,
    sort: byPosition,
  });
  return {
    labs: labs.data ?? (EMPTY as Lab[]),
    technicians: technicians.data ?? (EMPTY as LabTechnician[]),
    workTypes: workTypes.data ?? (EMPTY as LabWorkType[]),
    prices: seesMoney
      ? (prices.data ?? (EMPTY as LabWorkTypePrice[]))
      : (EMPTY as LabWorkTypePrice[]),
    terms: terms.data ?? (EMPTY as LabWorkTypeTerm[]),
    reasons: reasons.data ?? (EMPTY as LabRemakeReason[]),
    isPending: labs.isPending || technicians.isPending || workTypes.isPending,
  };
};

/**
 * The orders of the board (lab_orders_summary), of the branch chosen in the
 * top bar (with the orders without a branch)
 */
export const useLabOrders = () => {
  const { currentId } = useCurrentBranch();
  const { data, isPending } = useGetList<LabOrderSummary>(
    "lab_orders_summary",
    {
      pagination: all,
      sort: { field: "number", order: "DESC" },
    },
  );
  const orders = useMemo(
    () => inBranch(data ?? (EMPTY as LabOrderSummary[]), currentId),
    [data, currentId],
  );
  return { orders, isPending };
};

/** Everything an order touches, refreshed after a change */
const TOUCHED = [
  "lab_orders",
  "lab_orders_summary",
  "lab_order_items",
  "lab_order_item_prices",
  "lab_order_costs",
  "patient_files",
  "audit_log",
  // Stage 43
  "lab_order_remakes",
  "lab_order_events",
  "lab_order_balances",
  "lab_payment_allocations",
  "tasks",
  "notifications",
  "visits",
];

export const useRefreshLab = () => {
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

export const download = (bytes: Uint8Array, name: string) => {
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

/**
 * «PDF для лаборатории»: jsPDF and the fonts load with the first document.
 * The prices are printed for the owner and the head.
 */
export const useLabOrderPdf = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { title } = useConfigurationContext();
  const { data: settings } = useOrganizationSettings();
  const { seesMoney } = useLabRights();
  return async (orderId: Identifier) => {
    try {
      const [
        { buildLabOrderPdf },
        { loadEstimateFonts },
        { documentFileName },
      ] = await Promise.all([
        import("./labOrderPdf"),
        import("../treatment/estimateFonts"),
        import("../payments/documents"),
      ]);
      const [{ data: order }, { data: items }, fonts] = await Promise.all([
        dataProvider.getOne<LabOrderSummary>("lab_orders_summary", {
          id: orderId,
        }),
        dataProvider.getList<LabOrderItem>("lab_order_items", {
          filter: { order_id: orderId },
          pagination: { page: 1, perPage: 200 },
          sort: { field: "position", order: "ASC" },
        }),
        loadEstimateFonts(),
      ]);
      const prices = seesMoney
        ? (
            await dataProvider.getList<LabOrderItemPrice>(
              "lab_order_item_prices",
              {
                filter: {
                  "item_id@in": `(${items.map((i) => i.id).join(",") || 0})`,
                },
                pagination: { page: 1, perPage: 200 },
                sort: { field: "id", order: "ASC" },
              },
            )
          ).data
        : [];
      const bytes = buildLabOrderPdf(
        {
          clinic: {
            name: title || "",
            city: settings?.clinic_city,
            address: settings?.clinic_address,
            phone: settings?.clinic_phone,
          },
          number: order.number,
          createdAt: localDay(new Date(order.created_at)),
          patientName: order.patient_name ?? "",
          patientPhone: order.patient_phone,
          doctorName: order.doctor_name,
          labName: order.lab_name,
          technicianName: order.technician_name,
          shade: order.shade,
          material: order.material,
          teeth: order.teeth ?? [],
          sentAt: order.sent_at,
          fitting1At: order.fitting1_at,
          fitting2At: order.fitting2_at,
          dueAt: order.due_at,
          comment: order.comment,
          lines: items.map((item) => ({
            name: item.name,
            qty: item.qty,
            price: seesMoney
              ? (prices.find((p) => same(p.item_id, item.id))?.price ?? 0)
              : null,
          })),
          withPrices: seesMoney,
        },
        fonts,
        translate,
      );
      download(
        bytes,
        documentFileName(
          translate("lab.pdf.file"),
          order.number,
          order.patient_name ?? "",
        ),
      );
    } catch (error) {
      notify((error as Error)?.message || "lab.pdf.error", { type: "error" });
    }
  };
};
