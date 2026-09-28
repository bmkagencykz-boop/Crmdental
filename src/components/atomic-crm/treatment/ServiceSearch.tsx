import { useTranslate } from "ra-core";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

import { useServices } from "../dictionaries/useDictionaries";
import { formatTenge } from "../onboarding/servicePresets";
import type { Service } from "../types";
import { searchServices } from "./priceList";

/**
 * «Добавить из прайса»: type a name or a code, pick with the mouse or the
 * arrows and Enter. The last line adds a custom item with the typed name.
 */
export const ServiceSearch = ({
  onPick,
  disabled,
}: {
  onPick: (pick: { service?: Service; name: string }) => void;
  disabled?: boolean;
}) => {
  const translate = useTranslate();
  const { data: services } = useServices();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(
    () => (query.trim() ? searchServices(services, query).slice(0, 12) : []),
    [services, query],
  );
  const options = [
    ...results.map((service) => ({ service, name: service.name })),
    ...(query.trim() ? [{ service: undefined, name: query.trim() }] : []),
  ];

  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    onPick(option);
    setQuery("");
    setActive(0);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="search"
        value={query}
        disabled={disabled}
        placeholder={translate("treatment.items.search")}
        aria-label={translate("treatment.items.add")}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls="treatment-service-results"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(active);
          } else if (event.key === "Escape") {
            setQuery("");
          }
        }}
        className="field h-10 w-full rounded-full px-4 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
      />
      {open && options.length > 0 ? (
        <ul
          id="treatment-service-results"
          role="listbox"
          aria-label={translate("treatment.items.add")}
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-2xl bg-popover py-1 text-sm shadow-card"
        >
          {options.map((option, index) => (
            <li
              key={option.service?.id ?? "custom"}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(index);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              {option.service ? (
                <>
                  <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {option.service.code ?? ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {option.service.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {option.service.category ?? ""}
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums">
                    {option.service.price != null
                      ? `${formatTenge(option.service.price)} ₸`
                      : "—"}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {translate("treatment.items.custom", { name: option.name })}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
