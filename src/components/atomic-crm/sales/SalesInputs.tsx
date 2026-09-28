import {
  email,
  required,
  useGetIdentity,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { useWatch } from "react-hook-form";
import { BooleanInput } from "@/components/admin/boolean-input";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";

import type { Sale } from "../types";
import { roleLabelKey } from "./roleLabel";

const ASSIGNABLE_ROLES = ["head", "manager", "integrator"] as const;

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
            name: translate(roleLabelKey(role)),
          }))}
          defaultValue="manager"
          validate={required()}
          helperText={false}
        />
      )}
      <IntegratorInputs />
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

/**
 * Integrator (stage 25): end of the access and «доступ к переписке», saved
 * by the owner through public.set_integrator_access
 */
const IntegratorInputs = () => {
  const role = useWatch({ name: "role" });
  if (role !== "integrator") return null;
  return (
    <div className="space-y-4 rounded-md border px-4 py-3">
      <p className="text-sm text-muted-foreground">
        <IntegratorHint />
      </p>
      <DateInput
        source="access_expires_at"
        label="market.integrator.expires_at"
        helperText="market.integrator.expires_hint"
      />
      <BooleanInput
        source="can_read_messages"
        label="market.integrator.can_read_messages"
        helperText="market.integrator.can_read_messages_hint"
      />
    </div>
  );
};

const IntegratorHint = () => {
  const translate = useTranslate();
  return <>{translate("market.integrator.role_hint")}</>;
};
