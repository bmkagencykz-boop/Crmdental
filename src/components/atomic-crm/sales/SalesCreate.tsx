import { useMutation } from "@tanstack/react-query";
import { useDataProvider, useNotify, useRedirect, useTranslate } from "ra-core";
import type { SubmitHandler } from "react-hook-form";
import { SimpleForm } from "@/components/admin/simple-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { CrmDataProvider } from "../providers/types";
import type { SalesFormData } from "../types";
import { getSalesErrorNotification } from "./salesErrorNotification";
import { SalesInputs } from "./SalesInputs";
import { toAccessExpiry } from "./roleLabel";

export function SalesCreate() {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const redirect = useRedirect();

  const { mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      const { access_expires_at, can_read_messages, ...fields } = data;
      const sale = await dataProvider.salesCreate(fields);
      // The access of an integrator (stage 25) has its own function (owner)
      if (data.role === "integrator" && sale?.id != null) {
        await dataProvider.setIntegratorAccess(
          sale.id,
          toAccessExpiry(access_expires_at),
          !!can_read_messages,
        );
      }
      return sale;
    },
    onSuccess: () => {
      notify("resources.sales.create.success", {
        messageArgs: {
          _: "User created. They will soon receive an email to set their password.",
        },
      });
      redirect("/sales");
    },
    onError: (error) => {
      const { message, args } = getSalesErrorNotification(
        error,
        error.message ||
          translate("resources.sales.create.error", {
            _: "An error occurred while creating the user.",
          }),
      );
      notify(message, { type: "error", messageArgs: args });
    },
  });
  const onSubmit: SubmitHandler<SalesFormData> = async (data) => {
    mutate(data);
  };

  return (
    <div className="max-w-lg w-full mx-auto mt-8">
      <Card>
        <CardHeader>
          <CardTitle>
            {translate("resources.sales.create.title", {
              _: "Create a new user",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleForm onSubmit={onSubmit as SubmitHandler<any>}>
            <SalesInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </div>
  );
}
