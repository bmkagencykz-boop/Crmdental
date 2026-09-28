import { useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { formatTenge } from "../onboarding/servicePresets";
import {
  bulkPrice,
  flattenTree,
  buildCategoryTree,
  parseChange,
  validBulkChange,
} from "./priceListMath";
import type { BulkServiceAction, PriceListRow, ServiceCategory } from "./types";
import { usePriceListWrites } from "./usePriceList";

const NONE = "__none__";

/**
 * The bulk actions of the selected services: move to a category, change the
 * price by a percentage or an amount (rounded to 100 ₸, with an example),
 * archive, restore, delete (the used ones are archived instead).
 */
export const BulkBar = ({
  selected,
  categories,
  onDone,
}: {
  selected: PriceListRow[];
  categories: ServiceCategory[];
  onDone: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const writes = usePriceListWrites();
  const [mode, setMode] = useState<"price_percent" | "price_amount">(
    "price_percent",
  );
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const amount = parseChange(change);
  const valid = validBulkChange(mode, amount);
  const example = selected.find((row) => row.price != null);
  const ids = selected.map((row) => row.id);

  const apply = async (
    action: BulkServiceAction,
    options: Parameters<typeof writes.dataProvider.bulkServices>[2] = {},
  ) => {
    setBusy(true);
    const result = await writes.run(() =>
      writes.dataProvider.bulkServices(ids, action, options),
    );
    setBusy(false);
    if (!result) return;
    notify("price_list.bulk.done", {
      type: "info",
      messageArgs: { ...result },
    });
    if (action === "delete" || action === "move") onDone();
    if (action === "price_percent" || action === "price_amount") setChange("");
  };

  const tree = flattenTree(buildCategoryTree(categories, []));

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 rounded-[22px] bg-primary p-2 pl-5 text-primary-foreground"
      role="toolbar"
      aria-label={translate("price_list.bulk.label")}
    >
      <span className="mr-2 text-sm font-medium">
        {translate("price_list.bulk.selected", { count: selected.length })}
      </span>
      <select
        value=""
        disabled={busy}
        onChange={(event) => {
          const value = event.target.value;
          if (!value) return;
          void apply("move", {
            categoryId:
              value === NONE
                ? null
                : (tree.find((node) => String(node.id) === value)?.id ?? null),
          });
        }}
        aria-label={translate("price_list.bulk.move")}
        className="h-9 rounded-full bg-white/10 px-3 text-[13px] text-primary-foreground outline-none [&>option]:text-foreground"
      >
        <option value="">{translate("price_list.bulk.move")}</option>
        {tree.map((node) => (
          <option key={node.id} value={String(node.id)}>
            {node.parent_id != null ? `   ${node.name}` : node.name}
          </option>
        ))}
        <option value={NONE}>{translate("price_list.tree.none")}</option>
      </select>
      <div className="flex items-center gap-1 rounded-full bg-white/10 p-1">
        <input
          value={change}
          onChange={(event) => setChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid) {
              void apply(mode, { amount });
            }
          }}
          placeholder={translate("price_list.bulk.change_placeholder")}
          aria-label={translate("price_list.bulk.change")}
          className="h-7 w-24 rounded-full bg-transparent px-2 text-right text-[13px] text-primary-foreground outline-none placeholder:text-primary-foreground/50"
        />
        {(["price_percent", "price_amount"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "h-7 min-w-7 rounded-full px-2 text-[13px] font-semibold",
              mode === value
                ? "bg-neon text-neon-ink"
                : "text-primary-foreground/70 hover:text-primary-foreground",
            )}
          >
            {value === "price_percent" ? "%" : "₸"}
          </button>
        ))}
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void apply(mode, { amount })}
          className="h-7 rounded-full bg-white px-3 text-[13px] font-semibold text-foreground disabled:opacity-40"
        >
          {translate("price_list.bulk.apply_price")}
        </button>
      </div>
      {valid && example ? (
        <span className="text-xs text-primary-foreground/70">
          {translate("price_list.bulk.preview", {
            name: example.name,
            from: formatTenge(example.price!),
            to: formatTenge(bulkPrice(example.price!, mode, amount!)),
          })}
        </span>
      ) : (
        <span className="text-xs text-primary-foreground/60">
          {translate("price_list.bulk.rounding")}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          onClick={() => void apply("archive")}
        >
          {translate("price_list.bulk.archive")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          onClick={() => void apply("restore")}
        >
          {translate("price_list.bulk.restore")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          className="text-neon hover:bg-white/10 hover:text-neon"
          onClick={() => setConfirmDelete(true)}
        >
          {translate("price_list.bulk.delete")}
        </Button>
        <button
          type="button"
          onClick={onDone}
          aria-label={translate("price_list.bulk.clear")}
          title={translate("price_list.bulk.clear")}
          className="flex size-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <Confirm
        isOpen={confirmDelete}
        title={translate("price_list.bulk.delete_title", {
          count: selected.length,
        })}
        content={translate("price_list.bulk.delete_content")}
        confirm="ra.action.delete"
        confirmColor="warning"
        onConfirm={() => {
          setConfirmDelete(false);
          void apply("delete");
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
};
