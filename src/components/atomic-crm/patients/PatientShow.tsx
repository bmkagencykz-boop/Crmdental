import { ShowBase, useRecordContext } from "ra-core";

import { PatientCard } from "../patient-card/PatientCard";
import type { Patient } from "../types";

/**
 * The patient page: the full patient card of stage 37 (header and tabs:
 * overview with the requests, notes and calls; dental chart; visits and
 * their records; treatment plans; account; files and X-rays;
 * questionnaire and consents; history).
 */
export const PatientShow = () => (
  <ShowBase>
    <PatientShowContent />
  </ShowBase>
);

const PatientShowContent = () => {
  const record = useRecordContext<Patient>();
  if (!record) return null;
  return <PatientCard patient={record} />;
};
