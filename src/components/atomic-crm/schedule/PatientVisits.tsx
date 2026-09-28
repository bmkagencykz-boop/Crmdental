import { useTranslate, type Identifier } from "ra-core";

import { VisitList } from "./DealVisits";
import { useVisitsOf } from "./useSchedule";

/**
 * «Визиты» of the patient card: every visit of the patient, from all the
 * deals, the ones of the MIS included (they are mirrored into the visits,
 * marked «МИС»). Nothing is shown for a patient without visits.
 */
export const PatientVisits = ({ patientId }: { patientId: Identifier }) => {
  const translate = useTranslate();
  const { data: visits } = useVisitsOf("patient_id", patientId);
  if (!visits.length) return null;
  return (
    <section
      className="glass flex flex-col gap-2 rounded-lg p-6"
      data-testid="patient-visits"
    >
      <h3 className="mb-2 text-[15px] font-semibold">
        {translate("schedule.patient.title")}
      </h3>
      <VisitList visits={visits} showDeal />
    </section>
  );
};
