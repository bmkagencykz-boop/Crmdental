import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type Identifier,
  useDataProvider,
  useGetIdentity,
  useGetMany,
  useStore,
  useTranslate,
} from "ra-core";
import { useLocation, useNavigate } from "react-router";

import { cn } from "@/lib/utils";
import type { CrmDataProvider } from "../providers/types";
import type { Deal, Patient } from "../types";
import {
  formatPhone,
  fullName,
  parseSearchQuery,
  type GlobalSearchResult,
} from "./globalSearch";
import {
  addRecent,
  recentFromPath,
  recentStoreKey,
  type RecentItem,
} from "./recent";
import { groupLabel, useSearchItems, type SearchItem } from "./SearchResults";

export const GLOBAL_SEARCH_INPUT_ID = "global-search";

/** Puts the cursor in the search field of the top bar */
export const focusGlobalSearch = () => {
  const input = document.getElementById(
    GLOBAL_SEARCH_INPUT_ID,
  ) as HTMLInputElement | null;
  input?.focus();
  input?.select();
};

/** The search of the top bar: results grouped by kind, keyboard driven */
export const GlobalSearch = () => {
  const translate = useTranslate();
  const navigate = useNavigate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(q.trim(), 200);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [recent, setRecent] = useRecent();

  const valid = parseSearchQuery(debounced) != null;
  const { data, isFetching } = useQuery<GlobalSearchResult>({
    queryKey: ["globalSearch", debounced, 5],
    queryFn: () => dataProvider.globalSearch(debounced, 5),
    enabled: open && valid,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
  const results = useSearchItems(valid ? data : undefined, debounced);
  const recentItems = useRecentItems(recent, open && q.trim() === "");
  const showAll: SearchItem | null = valid
    ? {
        key: "show-all",
        group: "actions",
        to: `/search?q=${encodeURIComponent(debounced)}`,
        node: (
          <span className="text-sm text-primary">
            {translate("search.show_all")}
          </span>
        ),
      }
    : null;
  const items =
    q.trim() === ""
      ? recentItems
      : [...results, ...(showAll && results.length > 0 ? [showAll] : [])];

  useEffect(() => setActive(-1), [debounced]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const openItem = (item: SearchItem) => {
    if (item.recent) setRecent(addRecent(recent, item.recent));
    close();
    setQ("");
    (document.activeElement as HTMLElement | null)?.blur();
    navigate(item.to);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) =>
        items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active] ?? items[0];
      if (item) openItem(item);
      else if (showAll) openItem(showAll);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (q) setQ("");
      else {
        close();
        event.currentTarget.blur();
      }
    }
  };

  // Keep the selected line in view
  useEffect(() => {
    if (active < 0) return;
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const hasQuery = q.trim() !== "";
  let status: string | null = null;
  if (hasQuery && !parseSearchQuery(q)) status = translate("search.min_chars");
  else if (hasQuery && items.length === 0)
    status =
      isFetching || debounced !== q.trim() || !data
        ? translate("search.searching")
        : translate("search.nothing");
  else if (!hasQuery && items.length === 0)
    status = translate("search.recent_empty");

  return (
    <div
      ref={rootRef}
      className="relative w-full max-w-2xl"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node)) close();
      }}
    >
      <input
        id={GLOBAL_SEARCH_INPUT_ID}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={translate("search.aria")}
        autoComplete="off"
        spellCheck={false}
        value={q}
        placeholder={translate("search.placeholder")}
        onChange={(event) => {
          setQ(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-12 w-full rounded-full border-0 bg-card pr-20 pl-12 text-sm shadow-card outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
      />
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-1/2 left-4.5 size-[18px] -translate-y-1/2 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </svg>
      {q ? null : (
        <kbd className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          Ctrl K
        </kbd>
      )}
      {open ? (
        <div
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="absolute top-full right-0 left-0 z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border-0 bg-popover py-1 text-popover-foreground shadow-[var(--shadow-soft)]"
        >
          {!hasQuery && items.length > 0 ? (
            <GroupHeader label={translate("search.groups.recent")} />
          ) : null}
          {items.map((item, index) => {
            const previous = items[index - 1];
            const header =
              hasQuery && item.group !== previous?.group
                ? groupLabel(translate, item.group)
                : null;
            return (
              <div key={item.key}>
                {header ? <GroupHeader label={header} /> : null}
                {item.group === "actions" && hasQuery && index > 0 ? (
                  previous?.group !== "actions" ? (
                    <div className="my-1 border-t border-border" />
                  ) : null
                ) : null}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(index)}
                  onClick={() => openItem(item)}
                  className={cn(
                    "cursor-pointer px-3 py-1.5",
                    index === active && "bg-accent",
                  )}
                >
                  {item.node}
                </div>
              </div>
            );
          })}
          {status ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {status}
            </div>
          ) : null}
          <div className="mt-1 border-t border-border px-3 pt-1.5 pb-1 text-[11px] text-muted-foreground">
            {translate("search.hint")}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const GroupHeader = ({ label }: { label: string }) => (
  <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
    {label}
  </div>
);

const useDebounced = (value: string, delay: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

/** The recent items of the user (ra store: localStorage) */
export const useRecent = () => {
  const { identity } = useGetIdentity();
  return useStore<RecentItem[]>(recentStoreKey(identity?.id), []);
};

/** Remembers every patient and deal page the user opens */
export const useRecentTracker = () => {
  const { pathname } = useLocation();
  const { identity } = useGetIdentity();
  const [recent, setRecent] = useRecent();
  const recentRef = useRef(recent);
  recentRef.current = recent;
  useEffect(() => {
    if (!identity) return;
    const item = recentFromPath(pathname);
    if (item) setRecent(addRecent(recentRef.current, item));
  }, [pathname, identity, setRecent]);
};

const useRecentItems = (recent: RecentItem[], enabled: boolean) => {
  const translate = useTranslate();
  const patientIds = recent
    .filter((item) => item.kind === "patient")
    .map((item) => item.id);
  const dealIds = recent
    .filter((item) => item.kind === "deal")
    .map((item) => item.id);
  const { data: patients } = useGetMany<Patient & { id: Identifier }>(
    "patients",
    { ids: patientIds },
    { enabled: enabled && patientIds.length > 0 },
  );
  const { data: deals } = useGetMany<Deal>(
    "deals",
    { ids: dealIds },
    { enabled: enabled && dealIds.length > 0 },
  );
  return useMemo(() => {
    const items: SearchItem[] = [];
    for (const item of recent) {
      if (item.kind === "patient") {
        const patient = patients?.find((p) => String(p.id) === String(item.id));
        if (!patient) continue;
        items.push({
          key: `recent-patient-${item.id}`,
          group: "recent",
          to: `/patients/${item.id}/show`,
          recent: item,
          node: (
            <div className="flex items-baseline gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {fullName(patient) || translate("search.no_name")}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatPhone(patient.phones?.[0] ?? null)}
              </span>
            </div>
          ),
        });
      } else {
        const deal = deals?.find((d) => String(d.id) === String(item.id));
        if (!deal) continue;
        items.push({
          key: `recent-deal-${item.id}`,
          group: "recent",
          to: `/deals/${item.id}/show`,
          recent: item,
          node: (
            <div className="flex items-baseline gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {deal.name || translate("search.no_deal_name")}
                <span className="ml-2 text-xs text-muted-foreground">
                  № {deal.id}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {fullName({
                  last_name: deal.patient_last_name,
                  first_name: deal.patient_first_name,
                })}
              </span>
            </div>
          ),
        });
      }
    }
    return items;
  }, [recent, patients, deals, translate]);
};
