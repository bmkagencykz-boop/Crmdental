import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { Switch } from "@/components/ui/switch";

import type { CrmDataProvider } from "../providers/types";

/**
 * «Не получать рассылки» on the patient card: no mailings and no recall
 * messages (service messages of open deals still go). Also switched on by
 * an incoming «стоп» or a refusal «Не беспокоить».
 */
export const PatientOptOutToggle = ({
  patientId,
}: {
  patientId: Identifier;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const queryKey = ["patientOptOut", String(patientId)];
  const { data } = useQuery({
    queryKey,
    queryFn: () => dataProvider.getPatientOptOut(patientId),
  });
  const { mutate, isPending } = useMutation({
    mutationFn: (value: boolean) =>
      dataProvider.setPatientOptOut(patientId, value),
    onSuccess: (result) => queryClient.setQueryData(queryKey, result),
    onError: () => notify("ra.notification.http_error", { type: "error" }),
  });
  const checked = !!data?.messaging_opt_out;

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-3">
        <span>{translate("mailings.opt_out.label")}</span>
        <Switch
          checked={checked}
          disabled={!data || isPending}
          onCheckedChange={(value) => mutate(value)}
          aria-label={translate("mailings.opt_out.label")}
          data-testid="patient-opt-out"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {checked && data?.messaging_opt_out_at
          ? translate("mailings.opt_out.since", {
              date: new Date(data.messaging_opt_out_at).toLocaleDateString(
                "ru-RU",
              ),
            })
          : translate("mailings.opt_out.hint")}
      </p>
    </div>
  );
};
