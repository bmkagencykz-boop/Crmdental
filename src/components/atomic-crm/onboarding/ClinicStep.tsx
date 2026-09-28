import { useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useGetOne, useNotify, useTranslate } from "ra-core";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import { DEFAULT_TIME_ZONE } from "../providers/commons/automessages";
import type { CrmDataProvider } from "../providers/types";
import {
  useConfigurationContext,
  useConfigurationUpdater,
} from "../root/ConfigurationContext";
import type { ClinicProfile, Organization } from "../types";
import type { StepProps } from "./stepTypes";
import { TIME_ZONES } from "./timeZones";

/**
 * Step «Клиника»: name, city, time zone, phone and address, saved by
 * «Далее» through public.save_clinic_profile (the address fills the
 * «Адрес и парковка» quick reply).
 */
export const ClinicStep = ({ registerNext }: StepProps) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const config = useConfigurationContext();
  const updateConfiguration = useConfigurationUpdater();
  const { data: settings } = useOrganizationSettings();
  const { data: organization, isPending } = useGetOne<Organization>(
    "organizations",
    { id: settings?.organization_id as never },
    { enabled: settings?.organization_id != null },
  );
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  const [error, setError] = useState(false);

  // Filled once from the clinic, then edited locally until «Далее»
  useEffect(() => {
    if (profile || !settings || (isPending && !organization)) return;
    setProfile({
      name: organization?.name ?? config.title ?? "",
      city: settings.clinic_city ?? "",
      timezone: organization?.timezone || DEFAULT_TIME_ZONE,
      phone: settings.clinic_phone ?? "",
      address: settings.clinic_address ?? "",
    });
  }, [profile, settings, organization, isPending, config.title]);

  const latest = useRef(profile);
  latest.current = profile;

  useEffect(() => {
    registerNext(async () => {
      const current = latest.current;
      if (!current) return false;
      if (!current.name.trim()) {
        setError(true);
        return false;
      }
      try {
        await dataProvider.saveClinicProfile(current);
        updateConfiguration({ ...config, title: current.name.trim() });
        for (const key of [
          "organization_settings",
          "organizations",
          "quick_replies",
          "configuration",
        ]) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
        notify("onboarding.clinic.saved", { type: "info" });
        return true;
      } catch {
        notify("onboarding.save_error", { type: "error" });
        return false;
      }
    });
    return () => registerNext(null);
  }, [
    registerNext,
    dataProvider,
    updateConfiguration,
    config,
    queryClient,
    notify,
  ]);

  if (!profile) return null;
  const set = (field: keyof ClinicProfile) => (value: string) => {
    setProfile({ ...profile, [field]: value });
    if (field === "name") setError(false);
  };
  const knownZone = TIME_ZONES.some(([, zone]) => zone === profile.timezone);

  return (
    <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        id="onboarding-clinic-name"
        label={translate("onboarding.clinic.name")}
        wide
      >
        <Input
          id="onboarding-clinic-name"
          value={profile.name}
          onChange={(event) => set("name")(event.target.value)}
          aria-invalid={error || undefined}
          autoFocus
        />
        {error ? (
          <p className="text-xs text-destructive">
            {translate("onboarding.clinic.name_required")}
          </p>
        ) : null}
      </Field>
      <Field
        id="onboarding-clinic-city"
        label={translate("onboarding.clinic.city")}
      >
        <Input
          id="onboarding-clinic-city"
          value={profile.city}
          placeholder={translate("onboarding.clinic.city_placeholder")}
          onChange={(event) => set("city")(event.target.value)}
        />
      </Field>
      <Field
        id="onboarding-clinic-timezone"
        label={translate("onboarding.clinic.timezone")}
      >
        <Select value={profile.timezone} onValueChange={set("timezone")}>
          <SelectTrigger id="onboarding-clinic-timezone" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {knownZone ? null : (
              <SelectItem value={profile.timezone}>
                {profile.timezone}
              </SelectItem>
            )}
            {TIME_ZONES.map(([key, zone]) => (
              <SelectItem key={zone} value={zone}>
                {translate(`onboarding.timezones.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        id="onboarding-clinic-phone"
        label={translate("onboarding.clinic.phone")}
      >
        <Input
          id="onboarding-clinic-phone"
          type="tel"
          value={profile.phone}
          placeholder="+7 7__ ___ __ __"
          onChange={(event) => set("phone")(event.target.value)}
        />
      </Field>
      <Field
        id="onboarding-clinic-address"
        label={translate("onboarding.clinic.address")}
        wide
      >
        <Input
          id="onboarding-clinic-address"
          value={profile.address}
          placeholder={translate("onboarding.clinic.address_placeholder")}
          onChange={(event) => set("address")(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {translate("onboarding.clinic.address_help")}
        </p>
      </Field>
    </div>
  );
};

const Field = ({
  id,
  label,
  wide,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) => (
  <div
    className={
      wide ? "flex flex-col gap-1.5 sm:col-span-2" : "flex flex-col gap-1.5"
    }
  >
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
);
