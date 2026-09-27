import { useGetList, useTranslate, type Identifier } from "ra-core";

import { findById, useServices } from "../dictionaries/useDictionaries";
import type { Deal, DealFile } from "../types";
import { FileList } from "./DealFiles";

/** Patient card: the files of all the patient's deals, newest first */
export const PatientFiles = ({ patientId }: { patientId: Identifier }) => {
  const translate = useTranslate();
  const { data: services } = useServices();
  const { data: files = [], isPending } = useGetList<DealFile>("deal_files", {
    filter: { patient_id: patientId },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 500 },
  });
  const { data: deals = [] } = useGetList<Deal>("deals", {
    filter: { patient_id: patientId },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 100 },
  });
  if (isPending) return null;
  if (!files.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("files.patient_empty")}
      </p>
    );
  }
  const dealName = (dealId: Identifier) => {
    const deal = deals.find((d) => String(d.id) === String(dealId));
    if (!deal) return undefined;
    return (
      deal.name ||
      findById(services, deal.service_id)?.name ||
      translate("crm.deals.untitled")
    );
  };
  return <FileList files={files} dealName={dealName} />;
};
