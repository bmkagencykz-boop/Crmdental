import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  useOrganizationSettings,
  useServices,
} from "../dictionaries/useDictionaries";
import { downloadFile } from "../import/downloadFile";
import { isSupportedFile, readImportFile } from "../import/readImportFile";
import { formatTenge, parsePrice } from "../onboarding/servicePresets";
import type { CrmDataProvider } from "../providers/types";
import {
  moveItem,
  useDictionaryMutations,
} from "../settings/useDictionaryMutations";
import type { OrganizationSettings, Service } from "../types";
import { CellInput } from "./PlanBits";
import { parseNumber } from "./planMath";
import {
  normalizeCategory,
  parsePriceRows,
  planPriceImport,
  PRICE_CATEGORIES,
  priceListCsv,
} from "./priceList";

const ALL = "";
const NONE = "__none__";

/**
 * Settings → «Справочники и поля» → «Прайс»: the services of the clinic as
 * a price list — code, name, category (suggested ones or the clinic's own),
 * price, active — edited in place, filtered, imported from Excel or CSV and
 * downloaded as CSV. The limit of the discount a manager may give lives
 * here too. The same table as the «Услуга» of the deals.
 */
export const PriceListEditor = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: services } = useServices();
  const { create, update, remove, refresh } =
    useDictionaryMutations("services");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [name, setName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () => [...services].sort((a, b) => a.position - b.position),
    [services],
  );
  const categories = useMemo(
    () =>
      [
        ...new Set([
          ...PRICE_CATEGORIES,
          ...services.map((s) => s.category).filter((c): c is string => !!c),
        ]),
      ].sort((a, b) => a.localeCompare(b, "ru")),
    [services],
  );
  const needle = query.trim().toLowerCase();
  const visible = sorted.filter(
    (service) =>
      (category === ALL ||
        (category === NONE
          ? !service.category
          : service.category === category)) &&
      (!needle ||
        service.name.toLowerCase().includes(needle) ||
        (service.code ?? "").toLowerCase().includes(needle)),
  );
  const filtering = !!needle || category !== ALL;

  const move = (service: Service, direction: -1 | 1) =>
    moveItem(sorted, service.id, direction).forEach(([record, position]) =>
      update(record, { position }),
    );

  const add = () => {
    if (!name.trim()) return;
    create({
      name: name.trim(),
      category: normalizeCategory(newCategory),
      price: parsePrice(newPrice),
      position: (sorted.at(-1)?.position ?? -1) + 1,
    });
    setName("");
    setNewPrice("");
  };

  const importFile = async (picked: File) => {
    if (!isSupportedFile(picked.name)) {
      notify("treatment.price_list.import_unsupported", { type: "warning" });
      return;
    }
    setImporting(true);
    try {
      const { items, errors } = parsePriceRows(await readImportFile(picked));
      if (!items.length) {
        notify("treatment.price_list.import_empty", { type: "warning" });
        return;
      }
      const plan = planPriceImport(services, items);
      for (const row of plan.create) {
        await dataProvider.create("services", {
          data: { ...row, is_archived: false },
        });
      }
      for (const change of plan.update) {
        await dataProvider.update("services", {
          id: change.id,
          data: change.data,
          previousData: change.previous,
        });
      }
      refresh();
      notify("treatment.price_list.import_done", {
        type: "info",
        messageArgs: {
          created: plan.create.length,
          updated: plan.update.length,
          unchanged: plan.unchanged,
        },
      });
      if (errors.length) {
        notify("treatment.price_list.import_errors", {
          type: "warning",
          messageArgs: {
            lines: errors.map((error) => error.line).join(", "),
          },
        });
      }
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
      refresh();
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <MaxDiscount />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate("treatment.price_list.search")}
          aria-label={translate("treatment.price_list.search")}
          className="field h-8 w-56 rounded-md border border-input px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label={translate("treatment.price_list.category")}
          className="soft h-8 rounded-md border-0 px-2 text-sm"
        >
          <option value={ALL}>
            {translate("treatment.price_list.all_categories")}
          </option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
          <option value={NONE}>
            {translate("treatment.price_list.no_category")}
          </option>
        </select>
        <span className="text-xs text-muted-foreground">
          {translate("treatment.price_list.count", {
            smart_count: visible.length,
          })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={importing}
            onClick={() => file.current?.click()}
            title={translate("treatment.price_list.import_hint")}
          >
            {translate("treatment.price_list.import")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => downloadFile("Прайс.csv", priceListCsv(services))}
          >
            {translate("treatment.price_list.export")}
          </Button>
          <input
            ref={file}
            type="file"
            accept=".xlsx,.csv,.txt"
            className="hidden"
            aria-label={translate("treatment.price_list.import")}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = "";
              if (picked) void importFile(picked);
            }}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {translate("treatment.price_list.import_hint")}
      </p>

      <datalist id="price-list-categories">
        {categories.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[40rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <th className="w-20 px-1.5 py-1.5">
                {translate("treatment.price_list.code")}
              </th>
              <th className="px-1.5 py-1.5">
                {translate("treatment.price_list.name")}
              </th>
              <th className="w-36 px-1.5 py-1.5">
                {translate("treatment.price_list.category")}
              </th>
              <th className="w-28 px-1.5 py-1.5 text-right">
                {translate("treatment.price_list.price")}
              </th>
              <th className="w-16 px-1.5 py-1.5">
                {translate("treatment.price_list.active")}
              </th>
              <th className="w-20 px-1 py-1.5" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-4 text-center text-muted-foreground"
                >
                  {translate("treatment.price_list.empty")}
                </td>
              </tr>
            ) : null}
            {visible.map((service, index) => (
              <tr
                key={service.id}
                className={cn(
                  "border-b border-border/60 last:border-0",
                  service.is_archived && "text-muted-foreground",
                )}
              >
                <td className="px-0.5 py-0.5">
                  <CellInput
                    value={service.code ?? ""}
                    label={translate("treatment.price_list.code_for", {
                      name: service.name,
                    })}
                    onCommit={(code) => update(service, { code: code || null })}
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <CellInput
                    value={service.name}
                    label={translate("treatment.price_list.name_for", {
                      name: service.name,
                    })}
                    onCommit={(value) =>
                      value && update(service, { name: value })
                    }
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <CategoryInput
                    service={service}
                    onCommit={(value) =>
                      update(service, { category: normalizeCategory(value) })
                    }
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <CellInput
                    value={
                      service.price != null ? formatTenge(service.price) : ""
                    }
                    label={translate("onboarding.services.price_for", {
                      name: service.name,
                    })}
                    placeholder="—"
                    align="right"
                    inputMode="numeric"
                    onCommit={(raw) => {
                      const price = parsePrice(raw);
                      if (price !== (service.price ?? null)) {
                        update(service, { price });
                      }
                    }}
                  />
                </td>
                <td className="px-1.5 py-0.5">
                  <Switch
                    checked={!service.is_archived}
                    onCheckedChange={(checked) =>
                      update(service, { is_archived: !checked })
                    }
                    aria-label={`${translate("treatment.price_list.active")}: ${service.name}`}
                  />
                </td>
                <td className="px-1 py-0.5">
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      disabled={filtering || index === 0}
                      onClick={() => move(service, -1)}
                      aria-label={`${translate("crm.settings.move_up")}: ${service.name}`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      disabled={filtering || index === visible.length - 1}
                      onClick={() => move(service, 1)}
                      aria-label={`${translate("crm.settings.move_down")}: ${service.name}`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                      onClick={() => remove(service)}
                      aria-label={`${translate("ra.action.delete")}: ${service.name}`}
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          placeholder={translate("treatment.price_list.new_name")}
          aria-label={translate("treatment.price_list.new_name")}
          className="field h-8 min-w-0 flex-1 rounded-md border border-input px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value)}
          list="price-list-categories"
          placeholder={translate("treatment.price_list.category")}
          aria-label={translate("treatment.price_list.category")}
          className="field h-8 w-40 rounded-md border border-input px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          value={newPrice}
          onChange={(event) => setNewPrice(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          inputMode="numeric"
          placeholder={translate("treatment.price_list.price")}
          aria-label={translate("treatment.price_list.price")}
          className="field h-8 w-28 rounded-md border border-input px-2.5 text-right text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={add}
          disabled={!name.trim()}
        >
          {translate("treatment.price_list.add")}
        </Button>
      </div>
    </div>
  );
};

const CategoryInput = ({
  service,
  onCommit,
}: {
  service: Service;
  onCommit: (value: string) => void;
}) => {
  const translate = useTranslate();
  return (
    <input
      key={service.category ?? ""}
      defaultValue={service.category ?? ""}
      list="price-list-categories"
      aria-label={translate("treatment.price_list.category_for", {
        name: service.name,
      })}
      onBlur={(event) => {
        if (event.target.value.trim() !== (service.category ?? "")) {
          onCommit(event.target.value);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="h-7 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 text-[13px] outline-none hover:border-border focus:border-ring focus:bg-background"
    />
  );
};

/** «Скидка без руководителя — до N %» (organization_settings) */
const MaxDiscount = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: settings } = useOrganizationSettings();
  const { mutate } = useMutation({
    mutationFn: (data: Partial<OrganizationSettings>) =>
      dataProvider.updateOrganizationSettings(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["organization_settings"], data);
      notify("crm.settings.saved", { type: "info" });
    },
    onError: () => notify("crm.settings.save_error", { type: "error" }),
  });
  if (!settings) return null;
  const value = Number(settings.max_discount_percent ?? 10);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>{translate("treatment.price_list.max_discount")}</span>
      <CellInput
        value={String(value).replace(".", ",")}
        label={translate("treatment.price_list.max_discount")}
        align="right"
        inputMode="decimal"
        className="w-14 border-border"
        onCommit={(raw) => {
          const next = Math.min(100, Math.max(0, parseNumber(raw, value)));
          if (next !== value) mutate({ max_discount_percent: next });
        }}
      />
      <span>%</span>
      <span className="text-xs text-muted-foreground">
        {translate("treatment.price_list.max_discount_hint")}
      </span>
    </div>
  );
};
