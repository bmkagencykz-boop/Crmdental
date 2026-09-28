import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import { DEFAULT_RESPONSE_SETTINGS } from "../providers/commons/responseTime";
import type { CrmDataProvider } from "../providers/types";
import type { OrganizationSettings, Sale } from "../types";

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * Settings → «Контроль ответа» (owner and head): the limit to answer a
 * patient, the working hours that count, whom to alert.
 */
export const ResponseControlSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: stored } = useOrganizationSettings();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    filter: { "disabled@neq": true },
    sort: { field: "last_name", order: "ASC" },
    pagination: { page: 1, perPage: 100 },
  });
  const { mutate } = useMutation({
    mutationFn: (data: Partial<OrganizationSettings>) =>
      dataProvider.updateOrganizationSettings(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["organization_settings"], data);
      queryClient.invalidateQueries({ queryKey: ["deals_waiting"] });
      notify("crm.settings.saved", { type: "info" });
    },
    onError: () => notify("crm.settings.save_error", { type: "error" }),
  });
  const settings = stored ? { ...DEFAULT_RESPONSE_SETTINGS, ...stored } : null;
  const [limit, setLimit] = useState("");
  useEffect(() => {
    if (settings) setLimit(String(settings.response_limit_minutes));
  }, [settings?.response_limit_minutes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!settings) return null;

  const saveLimit = () => {
    const value = Number(limit);
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > 1440 ||
      value === settings.response_limit_minutes
    ) {
      setLimit(String(settings.response_limit_minutes));
      return;
    }
    mutate({ response_limit_minutes: value });
  };
  const chosen = settings.response_alert_sales_ids ?? [];
  const toggleEmployee = (id: Identifier) =>
    mutate({
      response_alert_sales_ids: chosen.some((c) => String(c) === String(id))
        ? chosen.filter((c) => String(c) !== String(id))
        : [...chosen, id],
    });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <Switch
          id="response-control"
          checked={settings.response_control_enabled}
          onCheckedChange={(response_control_enabled) =>
            mutate({ response_control_enabled })
          }
        />
        <Label htmlFor="response-control">
          {translate("notifications.settings.enabled")}
        </Label>
      </div>

      <div
        className={cn(
          "flex flex-col gap-8",
          settings.response_control_enabled
            ? ""
            : "pointer-events-none opacity-50",
        )}
      >
        <div className="flex max-w-xs flex-col gap-2">
          <Label htmlFor="response-limit">
            {translate("notifications.settings.limit")}
          </Label>
          <Input
            id="response-limit"
            type="number"
            min={1}
            max={1440}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            onBlur={saveLimit}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveLimit();
            }}
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">
            {translate("notifications.settings.hours")}
          </legend>
          <div className="flex items-center gap-2 text-sm">
            <span>{translate("notifications.settings.from")}</span>
            <HourSelect
              label={translate("notifications.settings.from")}
              value={settings.response_hours_start}
              hours={HOURS.filter((h) => h < settings.response_hours_end)}
              onChange={(response_hours_start) =>
                mutate({ response_hours_start })
              }
            />
            <span>{translate("notifications.settings.to")}</span>
            <HourSelect
              label={translate("notifications.settings.to")}
              value={settings.response_hours_end}
              hours={HOURS.filter((h) => h > settings.response_hours_start)}
              onChange={(response_hours_end) => mutate({ response_hours_end })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {translate("notifications.settings.hours_hint")}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">
            {translate("notifications.settings.alert")}
          </legend>
          <ToggleRow
            id="alert-responsible"
            label={translate("notifications.settings.alert_responsible")}
            checked={settings.response_alert_responsible}
            onChange={(response_alert_responsible) =>
              mutate({ response_alert_responsible })
            }
          />
          <ToggleRow
            id="alert-managers"
            label={translate("notifications.settings.alert_managers")}
            checked={settings.response_alert_managers}
            onChange={(response_alert_managers) =>
              mutate({ response_alert_managers })
            }
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {translate("notifications.settings.alert_employees")}
          </p>
          <div className="flex flex-wrap gap-2">
            {sales.map((sale) => {
              const active = chosen.some((c) => String(c) === String(sale.id));
              return (
                <button
                  key={sale.id}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() => toggleEmployee(sale.id)}
                  className={cn(
                    "rounded-md px-4 py-2 text-sm font-medium transition-all",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "soft hover:bg-card",
                  )}
                >
                  {sale.first_name} {sale.last_name}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {translate("notifications.settings.escalation")}
          </p>
        </fieldset>
      </div>
    </div>
  );
};

const HourSelect = ({
  label,
  value,
  hours,
  onChange,
}: {
  label: string;
  value: number;
  hours: number[];
  onChange: (hour: number) => void;
}) => (
  <Select
    value={String(value)}
    onValueChange={(hour) => onChange(Number(hour))}
  >
    <SelectTrigger className="w-24" aria-label={label}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {hours.map((hour) => (
        <SelectItem key={hour} value={String(hour)}>
          {pad(hour)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const ToggleRow = ({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <div className="flex items-center gap-3">
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
    <Label htmlFor={id} className="font-normal">
      {label}
    </Label>
  </div>
);
