import { CreateBase, Form, useGetIdentity, useTranslate } from "ra-core";
import { useSearchParams } from "react-router";
import { Card, CardContent } from "@/components/ui/card";

import { FormToolbar } from "../layout/FormToolbar";
import { PatientInputs } from "./PatientInputs";
import { cleanupPatientForCreate, defaultPhoneJsonb } from "./patientModel";

export const PatientCreate = () => {
  const { identity } = useGetIdentity();
  const translate = useTranslate();
  // «+ Новый пациент с номером …» of the global search (stage 31)
  const [searchParams] = useSearchParams();
  const phone = searchParams.get("phone");

  return (
    <CreateBase redirect="show" transform={cleanupPatientForCreate}>
      <div className="max-w-4xl">
        <Form
          defaultValues={{
            sales_id: identity?.id,
            phone_jsonb: phone
              ? [{ number: phone, type: "Mobile" }]
              : defaultPhoneJsonb,
            tags: [],
            custom_values: {},
          }}
        >
          <Card>
            <CardContent className="flex flex-col gap-6">
              <h2 className="text-xl font-bold">
                {translate("resources.patients.action.new")}
              </h2>
              <PatientInputs />
              <FormToolbar />
            </CardContent>
          </Card>
        </Form>
      </div>
    </CreateBase>
  );
};
