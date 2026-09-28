import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { formatTenge, parsePrice } from "../onboarding/servicePresets";
import type { DictionaryItem, LeadSource, Service } from "../types";
import { moveItem, useDictionaryMutations } from "./useDictionaryMutations";

type Item = DictionaryItem &
  Partial<Pick<LeadSource, "is_system">> &
  Pick<Service, "price">;

/**
 * Editable list of a clinic dictionary (services, lead sources, lost
 * reasons): rename, reorder, archive, add, delete. System sources can be
 * renamed or archived, never deleted.
 */
export const DictionaryEditor = ({
  resource,
  items,
}: {
  resource:
    | "services"
    | "lead_sources"
    | "lost_reasons"
    | "treatment_plan_types"
    | "treatment_directions";
  items: Item[];
}) => {
  const translate = useTranslate();
  const { create, update, remove } = useDictionaryMutations(resource);
  const [name, setName] = useState("");
  const sorted = [...items].sort((a, b) => a.position - b.position);

  const move = (item: Item, direction: -1 | 1) =>
    moveItem(sorted, item.id, direction).forEach(([record, position]) =>
      update(record, { position }),
    );

  const add = () => {
    if (!name.trim()) return;
    create({
      name: name.trim(),
      position: (sorted.at(-1)?.position ?? -1) + 1,
    });
    setName("");
  };

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((item, index) => (
        <div key={item.id} className="flex items-center gap-2">
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === 0}
              onClick={() => move(item, -1)}
              aria-label={translate("crm.settings.move_up")}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === sorted.length - 1}
              onClick={() => move(item, 1)}
              aria-label={translate("crm.settings.move_down")}
            >
              <ArrowDown className="size-4" />
            </Button>
          </div>
          <Input
            defaultValue={item.name}
            key={`${item.id}-${item.name}`}
            aria-label={translate("crm.settings.name")}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== item.name) update(item, { name: value });
            }}
            className={item.is_archived ? "text-muted-foreground" : undefined}
          />
          {resource === "services" ? (
            // Optional price in tenge (setup wizard, stage 24)
            <Input
              defaultValue={item.price != null ? formatTenge(item.price) : ""}
              key={`${item.id}-price-${item.price ?? ""}`}
              inputMode="numeric"
              placeholder={translate("onboarding.services.price_placeholder")}
              aria-label={translate("onboarding.services.price_for", {
                name: item.name,
              })}
              className="w-32 shrink-0 text-right tabular-nums"
              onBlur={(event) => {
                const price = parsePrice(event.target.value);
                if (price !== (item.price ?? null)) update(item, { price });
              }}
            />
          ) : null}
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={!item.is_archived}
              onCheckedChange={(checked) =>
                update(item, { is_archived: !checked })
              }
              aria-label={translate("crm.settings.active")}
            />
            {translate("crm.settings.active")}
          </label>
          {item.is_system ? (
            <span
              className="flex size-10 shrink-0 items-center justify-center text-muted-foreground"
              title={translate("crm.settings.system_item")}
            ></span>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => remove(item)}
              aria-label={translate("ra.action.delete")}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          placeholder={translate("crm.settings.new_item")}
          aria-label={translate("crm.settings.new_item")}
        />
        <Button onClick={add} disabled={!name.trim()} variant="outline">
          {translate("crm.settings.add")}
        </Button>
      </div>
    </div>
  );
};
