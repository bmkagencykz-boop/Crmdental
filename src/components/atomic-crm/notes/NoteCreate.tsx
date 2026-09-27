import {
  CreateBase,
  Form,
  useGetIdentity,
  useListContext,
  useNotify,
  useRecordContext,
  useResourceContext,
  useTranslate,
  useUpdate,
  type Identifier,
  type RaRecord,
} from "ra-core";
import { useFormContext } from "react-hook-form";
import { SaveButton } from "@/components/admin/form";
import { cn } from "@/lib/utils";

import { NoteInputs } from "./NoteInputs";
import { getCurrentDate } from "./utils";
import { foreignKeyMapping } from "./foreignKeyMapping";

export const NoteCreate = ({
  reference,
  showStatus,
  className,
}: {
  reference: "patients" | "deals";
  showStatus?: boolean;
  className?: string;
}) => {
  const resource = useResourceContext();
  const record = useRecordContext();
  const { identity } = useGetIdentity();

  if (!record || !identity) return null;

  const defaultStatus = reference === "patients" ? record.status : undefined;

  return (
    <CreateBase resource={resource} redirect={false}>
      <Form>
        <div className={cn("space-y-3", className)}>
          <NoteInputs defaultStatus={defaultStatus} showStatus={showStatus} />
          <NoteCreateButton
            defaultStatus={defaultStatus}
            record={record}
            reference={reference}
          />
        </div>
      </Form>
    </CreateBase>
  );
};

const NoteCreateButton = ({
  defaultStatus,
  reference,
  record,
}: {
  defaultStatus?: string;
  reference: "patients" | "deals";
  record: RaRecord<Identifier>;
}) => {
  const [update] = useUpdate();
  const notify = useNotify();
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const { reset } = useFormContext();
  const { refetch } = useListContext();

  if (!record || !identity) return null;

  const resetValues: {
    date: string;
    text: null;
    attachments: null;
    status?: string;
  } = {
    date: getCurrentDate(),
    text: null,
    attachments: null,
  };

  const handleSuccess = (data: any) => {
    if (reference === "patients") {
      resetValues.status = data.status ?? defaultStatus;
    }

    reset(resetValues, { keepValues: false });
    refetch();
    update(reference, {
      id: (record && record.id) as unknown as Identifier,
      data: {
        last_seen:
          reference === "patients" ? new Date().toISOString() : undefined,
        status: data.status,
      },
      previousData: record,
    });
    notify("resources.notes.added", {
      messageArgs: {
        _: "Note added",
      },
    });
  };

  return (
    <div className="flex justify-end">
      <SaveButton
        type="button"
        label={translate("resources.notes.action.add_this")}
        transform={(data) => ({
          ...data,
          [foreignKeyMapping[reference]]: record.id,
          sales_id: identity.id,
          date: new Date(data.date || getCurrentDate()).toISOString(),
        })}
        mutationOptions={{
          onSuccess: handleSuccess,
        }}
      />
    </div>
  );
};
