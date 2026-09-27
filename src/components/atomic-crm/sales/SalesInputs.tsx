import {
  email,
  required,
  useGetIdentity,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { BooleanInput } from "@/components/admin/boolean-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";

import type { Sale } from "../types";

const ASSIGNABLE_ROLES = ["head", "manager"] as const;

export function SalesInputs() {
  const { identity } = useGetIdentity();
  const record = useRecordContext<Sale>();
  const translate = useTranslate();
  // The owner's role and status cannot be changed (the clinic would lose its owner)
  const isOwnerRecord = record?.role === "owner";
  return (
    <div className="space-y-4 w-full">
      <TextInput source="first_name" validate={required()} helperText={false} />
      <TextInput source="last_name" validate={required()} helperText={false} />
      <TextInput
        source="email"
        validate={[required(), email()]}
        helperText={false}
      />
      {isOwnerRecord ? null : (
        <SelectInput
          source="role"
          choices={ASSIGNABLE_ROLES.map((role) => ({
            id: role,
            name: translate(`crm.roles.${role}`),
          }))}
          defaultValue="manager"
          validate={required()}
          helperText={false}
        />
      )}
      {record ? (
        // Internal number in the PBX (telephony); also in Settings → Телефония
        <TextInput
          source="phone_extension"
          label="telephony.extension"
          helperText={false}
        />
      ) : null}
      <BooleanInput
        source="disabled"
        readOnly={isOwnerRecord || record?.id === identity?.id}
        helperText={false}
      />
    </div>
  );
}
