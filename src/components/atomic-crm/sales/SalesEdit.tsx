import { useMutation } from "@tanstack/react-query";
import {
  useDataProvider,
  useEditController,
  useNotify,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import type { SubmitHandler } from "react-hook-form";
import { SimpleForm } from "@/components/admin/simple-form";
import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { Card, CardContent } from "@/components/ui/card";

import type { CrmDataProvider } from "../providers/types";
import type { Sale, SalesFormData } from "../types";
import { getSalesErrorNotification } from "./salesErrorNotification";
import { SalesInputs } from "./SalesInputs";
import { toAccessExpiry } from "./roleLabel";

function EditToolbar() {
  return (
    <div className="flex justify-end gap-4">
      <CancelButton />
      <SaveButton />
    </div>
  );
}

export function SalesEdit() {
  const { record } = useEditController();

  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();
  const translate = useTranslate();

  const { mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      if (!record) {
        throw new Error(
          translate("resources.sales.edit.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      const {
        phone_extension,
        access_expires_at,
        can_read_messages,
        ...fields
      } = data;
      const sale = await dataProvider.salesUpdate(record.id, fields);
      // The access of an integrator (stage 25) has its own function (owner)
      const expiry = toAccessExpiry(access_expires_at);
      if (
        (data.role ?? record.role) === "integrator" &&
        (expiry?.slice(0, 10) !==
          (record.access_expires_at ?? null)?.slice(0, 10) ||
          !!can_read_messages !== !!record.can_read_messages)
      ) {
        await dataProvider.setIntegratorAccess(
          record.id,
          expiry,
          !!can_read_messages,
        );
      }
      // The internal number of the PBX has its own function (owner and head)
      if (
        phone_extension !== undefined &&
        (phone_extension || null) !== (record.phone_extension || null)
      ) {
        await dataProvider.setSalesPhoneExtension(
          record.id,
          phone_extension || null,
        );
      }
      return sale;
    },
    onSuccess: () => {
      redirect("/sales");
      notify("resources.sales.edit.success", {
        messageArgs: {
          _: "User updated successfully",
        },
      });
    },
    onError: (error) => {
      const { message, args } = getSalesErrorNotification(
        error,
        "resources.sales.edit.error",
      );
      notify(message, {
        type: "error",
        messageArgs: { ...args, _: "An error occurred. Please try again." },
      });
    },
  });

  const onSubmit: SubmitHandler<SalesFormData> = async (data) => {
    mutate(data);
  };

  return (
    <div className="max-w-lg w-full mx-auto mt-8">
      <Card>
        <CardContent>
          <SimpleForm
            toolbar={<EditToolbar />}
            onSubmit={onSubmit as SubmitHandler<any>}
            record={record}
          >
            <SaleEditTitle />
            <SalesInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </div>
  );
}

const SaleEditTitle = () => {
  const record = useRecordContext<Sale>();
  const translate = useTranslate();
  if (!record) return null;
  return (
    <h2 className="text-lg font-semibold mb-4">
      {translate("resources.sales.edit.title", {
        name: `${record.first_name} ${record.last_name}`,
      })}
    </h2>
  );
};
