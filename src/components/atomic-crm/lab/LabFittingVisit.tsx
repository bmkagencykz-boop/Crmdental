import {
  useDataProvider,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import { VisitDialog } from "../schedule/VisitDialog";
import { localDay } from "./labMath";
import type { LabOrder } from "./types";
import { useRefreshLab } from "./useLab";

/**
 * «Записать на примерку» (stage 43): the visit dialog of the schedule,
 * with the patient, the deal, the doctor and the day of the next fitting of
 * the order; the saved visit becomes the order's fitting visit.
 */
export const LabFittingVisitDialog = ({
  order,
  onClose,
}: {
  order: Pick<
    LabOrder,
    | "id"
    | "number"
    | "patient_id"
    | "deal_id"
    | "doctor_id"
    | "fitting1_at"
    | "fitting2_at"
  >;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshLab();
  const today = localDay();
  const day =
    [order.fitting1_at, order.fitting2_at].find((d) => !!d && d >= today) ??
    today;
  const link = async (visitId: Identifier) => {
    try {
      await dataProvider.update("lab_orders", {
        id: order.id,
        data: { fitting_visit_id: visitId },
        previousData: { id: order.id },
      });
      notify("lab_plus.fitting.linked", {
        type: "info",
        messageArgs: { number: order.number },
      });
      await refresh();
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    }
  };
  return (
    <VisitDialog
      open
      onClose={onClose}
      draft={{
        patient_id: order.patient_id,
        deal_id: order.deal_id ?? null,
        doctor_id: order.doctor_id ?? null,
        day,
        time: "10:00",
        note: translate("lab_plus.fitting.note", { number: order.number }),
      }}
      onSaved={(visit) => link(visit.id)}
    />
  );
};
