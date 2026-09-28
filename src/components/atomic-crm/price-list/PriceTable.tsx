import { useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { formatTenge, parsePrice } from "../onboarding/servicePresets";
import { parseDuration, SERVICE_UNITS } from "../treatment/priceList";
import { GLYPHS } from "./glyphs";
import { EditCell, RoundIcon, TextCell } from "./PriceCells";
import {
  marginPercent,
  type PriceSort,
  type PriceSortField,
} from "./priceListMath";
import type { PriceListRow } from "./types";
import { usePriceListWrites } from "./usePriceList";

const SPECIALTIES_LIST = "price-list-specialties";

/**
 * The dense table of the price list: code, name, unit, minutes, direction,
 * price, cost price (owner and head), active; edited in place by the
 * editors, read by everybody else. Rows are selected for the bulk actions.
 */
export const PriceTable = ({
  rows,
  specialties,
  canEdit,
  canSeeCost,
  sort,
  onSort,
  selected,
  onSelect,
  onOpen,
}: {
  rows: PriceListRow[];
  specialties: string[];
  canEdit: boolean;
  canSeeCost: boolean;
  sort: PriceSort;
  onSort: (sort: PriceSort) => void;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onOpen: (row: PriceListRow) => void;
}) => {
  const translate = useTranslate();
  const writes = usePriceListWrites();
  const allSelected =
    rows.length > 0 && rows.every((r) => selected.has(String(r.id)));

  const toggle = (id: Identifier) => {
    const next = new Set(selected);
    if (next.has(String(id))) next.delete(String(id));
    else next.add(String(id));
    onSelect(next);
  };

  const header = (
    field: PriceSortField | null,
    label: string,
    className?: string,
  ) => (
    <th
      className={cn(
        "px-1 pb-2 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase",
        className,
      )}
      aria-sort={
        field && sort.field === field
          ? sort.order === "ASC"
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      {field ? (
        <button
          type="button"
          onClick={() =>
            onSort(
              sort.field === field
                ? sort.order === "ASC"
                  ? { field, order: "DESC" }
                  : { field: "position", order: "ASC" }
                : { field, order: "ASC" },
            )
          }
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 uppercase hover:text-foreground",
            sort.field === field && "text-foreground",
            className?.includes("text-right") && "flex-row-reverse",
          )}
          title={translate("price_list.table.sort_by", { column: label })}
        >
          {label}
          {sort.field === field ? (
            <span aria-hidden>{sort.order === "ASC" ? "↑" : "↓"}</span>
          ) : null}
        </button>
      ) : (
        <span className="px-1.5">{label}</span>
      )}
    </th>
  );

  return (
    <div className="-mx-2 overflow-x-auto">
      <datalist id={SPECIALTIES_LIST}>
        {specialties.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {canEdit ? (
              <th className="w-9 px-1 pb-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={allSelected}
                  onChange={() =>
                    onSelect(
                      allSelected
                        ? new Set()
                        : new Set(rows.map((row) => String(row.id))),
                    )
                  }
                  aria-label={translate("price_list.table.select_all")}
                />
              </th>
            ) : null}
            {header("code", translate("price_list.table.code"), "w-24")}
            {header("name", translate("price_list.table.name"))}
            {header(null, translate("price_list.table.unit"), "w-28")}
            {header(
              "duration_minutes",
              translate("price_list.table.duration"),
              "w-20 text-right",
            )}
            {header(null, translate("price_list.table.specialty"), "w-36")}
            {header(
              "price",
              translate("price_list.table.price"),
              "w-32 text-right",
            )}
            {canSeeCost
              ? header(
                  "cost_price",
                  translate("price_list.table.cost"),
                  "w-32 text-right",
                )
              : null}
            {header(null, translate("price_list.table.active"), "w-16")}
            <th className="w-9 pb-2" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PriceRow
              key={row.id}
              row={row}
              canEdit={canEdit}
              canSeeCost={canSeeCost}
              checked={selected.has(String(row.id))}
              onCheck={() => toggle(row.id)}
              onOpen={() => onOpen(row)}
              writes={writes}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

const PriceRow = ({
  row,
  canEdit,
  canSeeCost,
  checked,
  onCheck,
  onOpen,
  writes,
}: {
  row: PriceListRow;
  canEdit: boolean;
  canSeeCost: boolean;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
  writes: ReturnType<typeof usePriceListWrites>;
}) => {
  const translate = useTranslate();
  const name = row.name;
  const margin = marginPercent(row.price, row.cost_price);
  const cell = "border-t border-foreground/[0.06] px-1 py-0.5 align-middle";
  const unit = row.unit ?? "service";
  return (
    <tr
      className={cn(
        "group transition-colors hover:bg-pill/60",
        checked && "bg-neon-soft/40 hover:bg-neon-soft/50",
        row.is_archived && "text-muted-foreground",
      )}
      data-testid="price-row"
    >
      {canEdit ? (
        <td className={cn(cell, "rounded-l-2xl")}>
          <input
            type="checkbox"
            className="ml-1 size-4 accent-[var(--primary)]"
            checked={checked}
            onChange={onCheck}
            aria-label={translate("price_list.table.select_for", { name })}
          />
        </td>
      ) : null}
      <td className={cell}>
        {canEdit ? (
          <EditCell
            value={row.code ?? ""}
            label={translate("price_list.table.code_for", { name })}
            placeholder="—"
            onCommit={(code) =>
              void writes.updateService(row, { code: code || null })
            }
          />
        ) : (
          <TextCell className="text-muted-foreground">
            {row.code || "—"}
          </TextCell>
        )}
      </td>
      <td className={cell}>
        {canEdit ? (
          <EditCell
            value={row.name}
            label={translate("price_list.table.name_for", { name })}
            onCommit={(value) =>
              value && void writes.updateService(row, { name: value })
            }
          />
        ) : (
          <TextCell>{row.name}</TextCell>
        )}
      </td>
      <td className={cell}>
        {canEdit ? (
          <select
            value={unit}
            onChange={(event) =>
              void writes.updateService(row, { unit: event.target.value })
            }
            aria-label={translate("price_list.table.unit_for", { name })}
            className="h-8 w-full rounded-full border border-transparent bg-transparent px-2 text-[13px] outline-none hover:bg-pill focus:border-ring"
          >
            {SERVICE_UNITS.map((value) => (
              <option key={value} value={value}>
                {translate(`price_list.units.${value}`)}
              </option>
            ))}
          </select>
        ) : (
          <TextCell>{translate(`price_list.units.${unit}`)}</TextCell>
        )}
      </td>
      <td className={cell}>
        {canEdit ? (
          <EditCell
            value={
              row.duration_minutes != null ? String(row.duration_minutes) : ""
            }
            label={translate("price_list.table.duration_for", { name })}
            placeholder="—"
            align="right"
            inputMode="numeric"
            onCommit={(raw) => {
              const minutes = raw ? parseDuration(raw) : null;
              if (raw && minutes == null) return;
              void writes.updateService(row, { duration_minutes: minutes });
            }}
          />
        ) : (
          <TextCell align="right">{row.duration_minutes ?? "—"}</TextCell>
        )}
      </td>
      <td className={cell}>
        {canEdit ? (
          <EditCell
            value={row.specialty ?? ""}
            label={translate("price_list.table.specialty_for", { name })}
            placeholder="—"
            list={SPECIALTIES_LIST}
            onCommit={(value) =>
              void writes.updateService(row, { specialty: value || null })
            }
          />
        ) : (
          <TextCell>{row.specialty || "—"}</TextCell>
        )}
      </td>
      <td className={cell}>
        {canEdit ? (
          <EditCell
            value={row.price != null ? formatTenge(row.price) : ""}
            label={translate("price_list.table.price_for", { name })}
            placeholder="—"
            align="right"
            inputMode="numeric"
            className="font-medium"
            onCommit={(raw) => {
              const price = parsePrice(raw);
              if (price !== (row.price ?? null)) {
                void writes.updateService(row, { price });
              }
            }}
          />
        ) : (
          <TextCell align="right" className="font-medium">
            {row.price != null ? formatTenge(row.price) : "—"}
          </TextCell>
        )}
      </td>
      {canSeeCost ? (
        <td className={cell}>
          <div className="flex items-center justify-end gap-1">
            {margin != null ? (
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                  margin < 30
                    ? "bg-tone-red/10 text-tone-red"
                    : "bg-muted text-muted-foreground",
                )}
                title={translate("price_list.table.margin")}
              >
                {margin}%
              </span>
            ) : null}
            <EditCell
              value={row.cost_price != null ? formatTenge(row.cost_price) : ""}
              label={translate("price_list.table.cost_for", { name })}
              placeholder="—"
              align="right"
              inputMode="numeric"
              className="w-24 text-muted-foreground"
              onCommit={(raw) => {
                const cost = parsePrice(raw);
                if (cost !== (row.cost_price ?? null)) {
                  void writes.setCost(row.id, cost);
                }
              }}
            />
          </div>
        </td>
      ) : null}
      <td className={cell}>
        <div className="px-1.5">
          <Switch
            checked={!row.is_archived}
            disabled={!canEdit}
            onCheckedChange={(on) =>
              void writes.updateService(row, { is_archived: !on })
            }
            aria-label={translate("price_list.table.active_for", { name })}
          />
        </div>
      </td>
      <td className={cn(cell, "rounded-r-2xl")}>
        <RoundIcon
          label={translate("price_list.table.details_for", { name })}
          onClick={onOpen}
        >
          {GLYPHS.more}
        </RoundIcon>
      </td>
    </tr>
  );
};

/** «Новая услуга»: name and price, added at the end of the category shown */
export const AddServiceRow = ({
  onAdd,
}: {
  onAdd: (name: string, price: number | null) => Promise<unknown>;
}) => {
  const translate = useTranslate();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const submit = async () => {
    if (!name.trim()) return;
    await onAdd(name.trim(), parsePrice(price));
    setName("");
    setPrice("");
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && void submit()}
        placeholder={translate("price_list.add.name")}
        aria-label={translate("price_list.add.name")}
        className="h-10 min-w-0 flex-1 rounded-full bg-pill px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <input
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && void submit()}
        inputMode="numeric"
        placeholder={translate("price_list.add.price")}
        aria-label={translate("price_list.add.price")}
        className="h-10 w-36 rounded-full bg-pill px-4 text-right text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!name.trim()}
        className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
      >
        {translate("price_list.add.button")}
      </button>
    </div>
  );
};
