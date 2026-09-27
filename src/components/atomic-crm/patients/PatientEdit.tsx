import { EditBase, Form, useRecordContext, useTranslate } from "ra-core";
import { Card, CardContent } from "@/components/ui/card";

import { FormToolbar } from "../layout/FormToolbar";
import type { Patient } from "../types";
import { PatientInputs } from "./PatientInputs";
import { patientDisplayName } from "./parsePatientText";
import { cleanupPatientForEdit } from "./patientModel";

export const PatientEdit = () => (
  <EditBase
    redirect="show"
    mutationMode="pessimistic"
    transform={cleanupPatientForEdit}
  >
    <div className="max-w-4xl">
      <Form>
        <Card>
          <CardContent className="flex flex-col gap-6">
            <EditTitle />
            <PatientInputs />
            <FormToolbar />
          </CardContent>
        </Card>
      </Form>
    </div>
  </EditBase>
);

const EditTitle = () => {
  const translate = useTranslate();
  const record = useRecordContext<Patient>();
  return (
    <h2 className="text-xl font-bold">
      {translate("resources.patients.action.edit")}:{" "}
      {patientDisplayName(record)}
    </h2>
  );
};
