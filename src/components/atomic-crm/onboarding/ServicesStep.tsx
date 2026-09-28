import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useServices } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import {
  buildServiceRows,
  formatTenge,
  parsePrice,
  serviceToggle,
  type ServiceRow,
} from "./servicePresets";

/**
 * Step «Услуги и цены»: tick the common services, with an optional price;
 * add the clinic's own. Each change is saved at once in the services
 * dictionary (ticking creates or restores, unticking archives).
 */
export const ServicesStep = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: services, isPending } = useServices();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = buildServiceRows(services);
  const nextPosition =
    services.reduce((max, service) => Math.max(max, service.position), -1) + 1;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      notify("onboarding.save_error", { type: "error" });
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["services"] });
      queryClient.invalidateQueries({ queryKey: ["quick_replies"] });
      setBusy(false);
    }
  };

  const toggle = (row: ServiceRow, checked: boolean) =>
    run(async () => {
      const change = serviceToggle(row, checked, nextPosition);
      if (change.type === "create") {
        await dataProvider.create("services", { data: change.data });
      } else if (change.type === "update") {
        const previous = services.find(
          (service) => String(service.id) === String(change.id),
        );
        await dataProvider.update("services", {
          id: change.id,
          data: change.data,
          previousData: previous,
        });
      }
    });

  const savePrice = (row: ServiceRow, raw: string) => {
    const price = parsePrice(raw);
    if (row.serviceId == null || price === row.price) return;
    const previous = services.find(
      (service) => String(service.id) === String(row.serviceId),
    );
    return run(() =>
      dataProvider.update("services", {
        id: row.serviceId!,
        data: { price },
        previousData: previous,
      }),
    );
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    return run(() =>
      dataProvider.create("services", {
        data: { name, position: nextPosition },
      }),
    );
  };

  if (isPending) return null;
  const presets = rows.filter((row) => row.preset);
  const own = rows.filter((row) => !row.preset);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {translate("onboarding.services.presets")}
        </h3>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 lg:grid-cols-2">
          {presets.map((row) => (
            <ServiceLine
              key={row.key}
              row={row}
              disabled={busy}
              onToggle={toggle}
              onPrice={savePrice}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate("onboarding.services.consultation_hint")}
        </p>
      </section>
      {own.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {translate("onboarding.services.own")}
          </h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 lg:grid-cols-2">
            {own.map((row) => (
              <ServiceLine
                key={row.key}
                row={row}
                disabled={busy}
                onToggle={toggle}
                onPrice={savePrice}
              />
            ))}
          </div>
        </section>
      ) : null}
      <div className="flex max-w-md items-center gap-2">
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          placeholder={translate("onboarding.services.new_service")}
          aria-label={translate("onboarding.services.new_service")}
        />
        <Button
          variant="outline"
          onClick={add}
          disabled={!newName.trim() || busy}
        >
          <Plus className="size-4" />
          {translate("onboarding.services.add")}
        </Button>
      </div>
    </div>
  );
};

const ServiceLine = ({
  row,
  disabled,
  onToggle,
  onPrice,
}: {
  row: ServiceRow;
  disabled: boolean;
  onToggle: (row: ServiceRow, checked: boolean) => void;
  onPrice: (row: ServiceRow, raw: string) => void;
}) => {
  const translate = useTranslate();
  const id = `onboarding-service-${row.key}`;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-1.5 transition-colors",
        row.checked ? "border-primary/40 bg-primary/5" : "bg-card",
      )}
    >
      <Checkbox
        id={id}
        checked={row.checked}
        disabled={disabled}
        onCheckedChange={(checked) => onToggle(row, checked === true)}
      />
      <label
        htmlFor={id}
        className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
      >
        {row.name}
      </label>
      <Input
        key={`${row.key}-${row.price ?? ""}`}
        defaultValue={row.price != null ? formatTenge(row.price) : ""}
        inputMode="numeric"
        disabled={!row.checked || disabled}
        placeholder={translate("onboarding.services.price_placeholder")}
        aria-label={translate("onboarding.services.price_for", {
          name: row.name,
        })}
        className="h-8 w-28 text-right tabular-nums"
        onBlur={(event) => onPrice(row, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
};
