import type { Patient } from "../types";
import { PatientCreate } from "./PatientCreate";
import { PatientEdit } from "./PatientEdit";
import { PatientList } from "./PatientList";
import { PatientShow } from "./PatientShow";
import { patientDisplayName } from "./parsePatientText";

export default {
  list: PatientList,
  show: PatientShow,
  edit: PatientEdit,
  create: PatientCreate,
  recordRepresentation: (record: Patient) => patientDisplayName(record),
};
