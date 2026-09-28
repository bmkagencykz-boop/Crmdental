import { useGetList, useLocaleState, useTranslate } from "ra-core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

import { formatTenge, parsePrice } from "../onboarding/servicePresets";
import { parseDuration, SERVICE_UNITS } from "../treatment/priceList";
import type { Sale } from "../types";
import { EditCell } from "./PriceCells";
import { buildCategoryTree, flattenTree, marginPercent } from "./priceListMath";
import type { PriceHistoryRow, PriceListRow, ServiceCategory } from "./types";
import { usePriceListWrites } from "./usePriceList";

/**
 * A service in full: every field of the price list (the materials note
 * lives here), whether it is used, and the history of its price — who
 * changed it, when, old → new.
 */
export const ServiceDialog = ({
  row,
  categories,
  canEdit,
  canSeeCost,
  onClose,
}: {
  row: PriceListRow | null;
  categories: ServiceCategory[];
  canEdit: boolean;
  canSeeCost: boolean;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[28px] border-0 bg-card sm:max-w-2xl">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8 text-[26px] leading-tight font-normal tracking-[-0.02em]">
                {row.name}
              </DialogTitle>
              <DialogDescription>
                {[row.code, row.category ?? translate("price_list.tree.none")]
                  .filter(Boolean)
                  .join(" · ")}
              </DialogDescription>
            </DialogHeader>
            <ServiceFields
              row={row}
              categories={categories}
              canEdit={canEdit}
              canSeeCost={canSeeCost}
            />
            <PriceHistory row={row} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1">
    <span className="px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {label}
    </span>
    <div className="rounded-full bg-pill">{children}</div>
  </label>
);

const ServiceFields = ({
  row,
  categories,
  canEdit,
  canSeeCost,
}: {
  row: PriceListRow;
  categories: ServiceCategory[];
  canEdit: boolean;
  canSeeCost: boolean;
}) => {
  const translate = useTranslate();
  const writes = usePriceListWrites();
  const update = (data: Record<string, unknown>) =>
    void writes.updateService(row, data);
  const name = row.name;
  const margin = marginPercent(row.price, row.cost_price);
  const text = (value: string | number | null | undefined) =>
    value == null || value === "" ? "—" : String(value);

  if (!canEdit) {
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl bg-muted/60 p-4 text-sm">
        <dt className="text-muted-foreground">
          {translate("price_list.table.price")}
        </dt>
        <dd className="font-medium">
          {row.price != null ? `${formatTenge(row.price)} ₸` : "—"}
        </dd>
        <dt className="text-muted-foreground">
          {translate("price_list.table.unit")}
        </dt>
        <dd>{translate(`price_list.units.${row.unit ?? "service"}`)}</dd>
        <dt className="text-muted-foreground">
          {translate("price_list.details.duration")}
        </dt>
        <dd>{text(row.duration_minutes)}</dd>
        <dt className="text-muted-foreground">
          {translate("price_list.table.specialty")}
        </dt>
        <dd>{text(row.specialty)}</dd>
        <dt className="text-muted-foreground">
          {translate("price_list.details.materials")}
        </dt>
        <dd className="whitespace-pre-line">{text(row.materials_note)}</dd>
      </dl>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label={translate("price_list.table.code")}>
          <EditCell
            value={row.code ?? ""}
            label={translate("price_list.table.code_for", { name })}
            onCommit={(code) => update({ code: code || null })}
          />
        </Field>
        <Field label={translate("price_list.table.name")}>
          <EditCell
            value={row.name}
            label={translate("price_list.table.name_for", { name })}
            onCommit={(value) => value && update({ name: value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={translate("price_list.details.category")}>
          <select
            value={row.category_id != null ? String(row.category_id) : ""}
            onChange={(event) =>
              update({
                category_id:
                  categories.find((c) => String(c.id) === event.target.value)
                    ?.id ?? null,
              })
            }
            aria-label={translate("price_list.details.category_for", { name })}
            className="h-8 w-full rounded-full bg-transparent px-2 text-[13px] outline-none"
          >
            <option value="">{translate("price_list.tree.none")}</option>
            {flattenTree(buildCategoryTree(categories, [])).map((node) => (
              <option key={node.id} value={String(node.id)}>
                {node.parent_id != null ? `— ${node.name}` : node.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={translate("price_list.table.unit")}>
          <select
            value={row.unit ?? "service"}
            onChange={(event) => update({ unit: event.target.value })}
            aria-label={translate("price_list.table.unit_for", { name })}
            className="h-8 w-full rounded-full bg-transparent px-2 text-[13px] outline-none"
          >
            {SERVICE_UNITS.map((value) => (
              <option key={value} value={value}>
                {translate(`price_list.units.${value}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={translate("price_list.details.duration")}>
          <EditCell
            value={
              row.duration_minutes != null ? String(row.duration_minutes) : ""
            }
            label={translate("price_list.table.duration_for", { name })}
            placeholder="—"
            inputMode="numeric"
            onCommit={(raw) => {
              const minutes = raw ? parseDuration(raw) : null;
              if (raw && minutes == null) return;
              update({ duration_minutes: minutes });
            }}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={translate("price_list.table.price")}>
          <EditCell
            value={row.price != null ? formatTenge(row.price) : ""}
            label={translate("price_list.table.price_for", { name })}
            placeholder="—"
            inputMode="numeric"
            onCommit={(raw) => {
              const price = parsePrice(raw);
              if (price !== (row.price ?? null)) update({ price });
            }}
          />
        </Field>
        {canSeeCost ? (
          <Field
            label={
              margin != null
                ? `${translate("price_list.table.cost")} · ${translate("price_list.table.margin")} ${margin}%`
                : translate("price_list.table.cost")
            }
          >
            <EditCell
              value={row.cost_price != null ? formatTenge(row.cost_price) : ""}
              label={translate("price_list.table.cost_for", { name })}
              placeholder="—"
              inputMode="numeric"
              onCommit={(raw) => {
                const cost = parsePrice(raw);
                if (cost !== (row.cost_price ?? null)) {
                  void writes.setCost(row.id, cost);
                }
              }}
            />
          </Field>
        ) : null}
        <Field label={translate("price_list.table.specialty")}>
          <EditCell
            value={row.specialty ?? ""}
            label={translate("price_list.table.specialty_for", { name })}
            placeholder="—"
            onCommit={(value) => update({ specialty: value || null })}
          />
        </Field>
      </div>
      <label className="flex flex-col gap-1">
        <span className="px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {translate("price_list.details.materials")}
        </span>
        <textarea
          key={row.materials_note ?? ""}
          defaultValue={row.materials_note ?? ""}
          rows={2}
          maxLength={1000}
          placeholder={translate("price_list.details.materials_hint")}
          aria-label={translate("price_list.details.materials_for", { name })}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value !== (row.materials_note ?? "")) {
              update({ materials_note: value || null });
            }
          }}
          className="min-h-16 rounded-2xl bg-pill px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Switch
          checked={!row.is_archived}
          onCheckedChange={(on) => update({ is_archived: !on })}
          aria-label={translate("price_list.table.active_for", { name })}
        />
        <span>{translate("price_list.table.active")}</span>
        {row.in_use ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            {translate("price_list.details.in_use")}
          </span>
        ) : null}
      </div>
    </div>
  );
};

const PriceHistory = ({ row }: { row: PriceListRow }) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const { data: history = [], isPending } = useGetList<PriceHistoryRow>(
    "service_price_history",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "changed_at", order: "DESC" },
      filter: { service_id: row.id },
    },
  );
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "first_name", order: "ASC" },
  });
  const author = (id: PriceHistoryRow["sales_id"]) => {
    const sale = sales.find((s) => String(s.id) === String(id));
    return sale
      ? `${sale.first_name} ${sale.last_name}`.trim()
      : translate("price_list.details.system");
  };
  const date = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const money = (value: number | null) =>
    value != null ? `${formatTenge(value)} ₸` : "—";
  return (
    <section
      className="rounded-2xl bg-muted/60 p-4"
      aria-label={translate("price_list.details.history")}
    >
      <h3 className="mb-2 text-base font-normal">
        {translate("price_list.details.history")}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {translate("price_list.details.plans_keep")}
      </p>
      {isPending ? null : history.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("price_list.details.no_history")}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5" data-testid="price-history">
          {history.map((change) => (
            <li
              key={change.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm"
            >
              <span className="w-40 shrink-0 text-xs text-muted-foreground tabular-nums">
                {date.format(new Date(change.changed_at))}
              </span>
              <span className="tabular-nums">
                {change.old_price == null ? (
                  <>
                    <span className="text-muted-foreground">
                      {translate("price_list.details.first_price")}
                    </span>{" "}
                    {money(change.new_price)}
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground line-through">
                      {money(change.old_price)}
                    </span>{" "}
                    →{" "}
                    <span className="font-medium">
                      {money(change.new_price)}
                    </span>
                  </>
                )}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {author(change.sales_id)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
