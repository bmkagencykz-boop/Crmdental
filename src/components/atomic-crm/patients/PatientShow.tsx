import {
  InfiniteListBase,
  ShowBase,
  useCanAccess,
  useGetList,
  useRecordContext,
  useTranslate,
} from "ra-core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

import {
  findById,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { formatMoney } from "../deals/kanbanFormat";
import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { accent } from "../misc/accent";
import type { Deal, Patient } from "../types";
import { DuplicateWarning } from "../duplicates/DuplicateWarning";
import { PatientAside } from "./PatientAside";
import { PatientCalls } from "./PatientCalls";
import { PatientVisits } from "../schedule/PatientVisits";
import { PatientFiles } from "../files/PatientFiles";
import { patientDisplayName } from "./parsePatientText";
import { PatientMedical, PatientPlans } from "../treatment/PatientTreatment";

/**
 * Patient history (spec §3): every request (deal), notes and calls, with
 * the contact card aside.
 */
export const PatientShow = () => (
  <ShowBase>
    <PatientShowContent />
  </ShowBase>
);

const PatientShowContent = () => {
  const translate = useTranslate();
  const record = useRecordContext<Patient>();
  // Treatment plans (stage 29): not for the integrator (no money)
  const { canAccess: canSeePlans = false } = useCanAccess({
    resource: "treatment_plans",
    action: "list",
  });
  if (!record) return null;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-[1.6rem] font-bold tracking-[-0.02em]">
        {patientDisplayName(record)}
      </h2>
      <DuplicateWarning patientId={record.id} className="-mt-3" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          <Panel title={translate("treatment.patient.medical")}>
            <PatientMedical patient={record} />
          </Panel>
          <Panel
            title={translate("crm.patients.sections.requests")}
            action={
              <Button asChild size="sm">
                <Link to={`/deals/create?patient_id=${record.id}`}>
                  {translate("crm.patients.new_request")}
                </Link>
              </Button>
            }
          >
            <PatientDeals patientId={record.id} />
          </Panel>
          {canSeePlans ? (
            <Panel title={translate("treatment.patient.plans")}>
              <PatientPlans patient={record} />
            </Panel>
          ) : null}
          <Panel title={translate("files.patient_title")}>
            <PatientFiles patientId={record.id} />
          </Panel>
          <Panel title={translate("crm.calls.title")}>
            <PatientCalls patientId={record.id} />
          </Panel>
          <PatientVisits patientId={record.id} />
          <Panel title={translate("resources.notes.name", { smart_count: 2 })}>
            <InfiniteListBase
              resource="patient_notes"
              filter={{ patient_id: record.id }}
              sort={{ field: "date", order: "DESC" }}
              perPage={25}
              disableSyncWithLocation
              storeKey={false}
              empty={<NoteCreate reference="patients" />}
            >
              <NoteCreate reference="patients" />
              <NotesIterator reference="patients" />
            </InfiniteListBase>
          </Panel>
        </div>
        <PatientAside />
      </div>
    </div>
  );
};

const PatientDeals = ({ patientId }: { patientId: Patient["id"] }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: stages } = useStages();
  const { data: services } = useServices();
  const { data: deals = [], isPending } = useGetList<Deal>("deals", {
    filter: { patient_id: patientId },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 100 },
  });
  if (isPending) return null;
  if (!deals.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("crm.patients.no_requests")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {deals.map((deal) => {
        const stage = findById(stages, deal.stage_id);
        return (
          <li key={deal.id}>
            <Link
              to={`/deals/${deal.id}/show`}
              className="flex items-center gap-4 rounded-lg bg-card/80 px-4 py-3 no-underline transition-colors hover:bg-card"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: accent(stage?.color) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-foreground">
                  {deal.name ||
                    findById(services, deal.service_id)?.name ||
                    translate("crm.deals.untitled")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stage?.name} ·{" "}
                  {new Date(deal.created_at).toLocaleDateString("ru-RU")}
                </span>
              </span>
              <span className="text-right text-sm tabular-nums">
                <span className="block font-semibold text-foreground">
                  {formatMoney(deal.plan_amount, currency)}
                </span>
                {deal.paid_amount ? (
                  <span className="text-xs text-muted-foreground">
                    {translate("crm.patients.paid", {
                      amount: formatMoney(deal.paid_amount, currency),
                    })}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

const Panel = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <section className="glass rounded-lg p-6">
    <div className="mb-4 flex items-center justify-between gap-2">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);
