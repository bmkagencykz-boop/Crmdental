import { useLocaleState, useTranslate } from "ra-core";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { Implant3D, Molar3D, Sphere3D } from "../misc/Dental3D";
import { BulkBar } from "./BulkBar";
import { CategoryTree } from "./CategoryTree";
import { Chip } from "./PriceCells";
import {
  categoryPath,
  filterPriceRows,
  marginPercent,
  nextPosition,
  rowsByStatus,
  sortPriceRows,
  type CategoryFilter,
  type PriceSort,
  type StatusFilter,
} from "./priceListMath";
import { AddServiceRow, PriceTable } from "./PriceTable";
import { ServiceDialog } from "./ServiceDialog";
import { isPriceListEmpty, STARTER_PRICE_LIST } from "./starterPriceList";
import { usePriceList, usePriceListWrites } from "./usePriceList";
import { usePriceListFiles } from "./usePriceListFiles";

/**
 * «Прайс» (stage 35): the price list of the clinic as a section of its own,
 * like a dental MIS — the tree of sections and subsections on the left, the
 * dense table of the services on the right, bulk actions, the price history
 * of each service, import and export. The owner and the head edit (the
 * integrator too); managers read the prices, not the cost price.
 */
export const PriceListPage = () => {
  const translate = useTranslate();
  const { rows, categories, isPending, canEdit, canSeeCost } = usePriceList();
  const writes = usePriceListWrites();
  const files = usePriceListFiles({ rows, categories, canSeeCost });
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");
  const [noPrice, setNoPrice] = useState(false);
  const [sort, setSort] = useState<PriceSort>({
    field: "position",
    order: "ASC",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const byStatus = useMemo(() => rowsByStatus(rows, status), [rows, status]);
  const visible = useMemo(
    () =>
      sortPriceRows(
        filterPriceRows(rows, categories, { category, query, status, noPrice }),
        categories,
        sort,
      ),
    [rows, categories, category, query, status, noPrice, sort],
  );
  const selectedRows = visible.filter((row) => selected.has(String(row.id)));
  const specialties = useMemo(
    () =>
      [...new Set(rows.map((row) => row.specialty).filter(Boolean))].sort(
        (a, b) => a!.localeCompare(b!, "ru"),
      ) as string[],
    [rows],
  );
  const openRow = rows.find((row) => String(row.id) === openId) ?? null;

  if (isPending) {
    return <Skeleton className="h-96 w-full rounded-[28px]" />;
  }

  const addService = (name: string, price: number | null) => {
    const categoryId =
      category === "all" || category === "none" ? null : category;
    return writes.run(() =>
      writes.dataProvider.create("services", {
        data: {
          name,
          price,
          category_id: categoryId,
          is_archived: false,
          position: nextPosition(rows),
        },
      }),
    );
  };

  const fileTools = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.csv,.txt"
        className="hidden"
        aria-label={translate("price_list.files.import")}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) void files.importFile(picked);
        }}
      />
      {canEdit ? (
        <Button
          variant="outline"
          disabled={files.busy}
          onClick={() => fileInput.current?.click()}
          title={translate("price_list.files.import_hint")}
        >
          {translate("price_list.files.import")}
        </Button>
      ) : null}
      <Button variant="outline" onClick={files.exportCsv}>
        {translate("price_list.files.export")}
      </Button>
      {canEdit ? (
        <Button variant="ghost" onClick={files.downloadTemplate}>
          {translate("price_list.files.template")}
        </Button>
      ) : null}
    </>
  );

  if (isPriceListEmpty(categories, rows)) {
    return (
      <div className="flex flex-col gap-5">
        <StarterCard
          canEdit={canEdit}
          busy={files.busy}
          onLoad={() => void files.loadStarter()}
          tools={fileTools}
        />
        {rows.length ? (
          <section className="rounded-[28px] bg-card p-6">
            <PriceTable
              rows={visible}
              specialties={specialties}
              canEdit={canEdit}
              canSeeCost={canSeeCost}
              sort={sort}
              onSort={setSort}
              selected={selected}
              onSelect={setSelected}
              onOpen={(row) => setOpenId(String(row.id))}
            />
            {canEdit ? <AddServiceRow onAdd={addService} /> : null}
          </section>
        ) : null}
        <ServiceDialog
          row={openRow}
          categories={categories}
          canEdit={canEdit}
          canSeeCost={canSeeCost}
          onClose={() => setOpenId(null)}
        />
      </div>
    );
  }

  const title =
    category === "all"
      ? translate("price_list.tree.all")
      : category === "none"
        ? translate("price_list.tree.none")
        : (categoryPath(categories, category) ??
          translate("price_list.tree.all"));

  return (
    <div className="flex flex-col gap-5">
      <Summary
        rows={rows}
        canSeeCost={canSeeCost}
        categories={categories.length}
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="rounded-[28px] bg-card p-4 lg:sticky lg:top-28">
          <h2 className="px-3 pt-1 pb-3 text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("price_list.tree.title")}
          </h2>
          <CategoryTree
            categories={categories}
            rows={byStatus}
            selected={category}
            onSelect={(value) => {
              setCategory(value);
              setSelected(new Set());
            }}
            canEdit={canEdit}
          />
        </aside>
        <section
          className="min-w-0 rounded-[28px] bg-card p-6"
          aria-label={translate("price_list.table.label")}
        >
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[26px] leading-tight font-normal tracking-[-0.02em]">
                {title}
              </h2>
              <p className="text-sm text-muted-foreground">
                {translate("price_list.table.count", {
                  smart_count: visible.length,
                })}
                {!canEdit ? ` · ${translate("price_list.read_only")}` : ""}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {fileTools}
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate("price_list.search")}
              aria-label={translate("price_list.search")}
              className="h-9 w-64 rounded-full bg-pill px-4 text-[13px] outline-none focus:ring-2 focus:ring-ring"
            />
            {(["active", "archived", "all"] as const).map((value) => (
              <Chip
                key={value}
                active={status === value}
                onClick={() => {
                  setStatus(value);
                  setSelected(new Set());
                }}
              >
                {translate(`price_list.status.${value}`)}
              </Chip>
            ))}
            <Chip
              active={noPrice}
              onClick={() => setNoPrice(!noPrice)}
              count={byStatus.filter((row) => row.price == null).length}
            >
              {translate("price_list.no_price")}
            </Chip>
          </div>
          {canEdit && selectedRows.length ? (
            <BulkBar
              selected={selectedRows}
              categories={categories}
              onDone={() => setSelected(new Set())}
            />
          ) : null}
          {visible.length ? (
            <PriceTable
              rows={visible}
              specialties={specialties}
              canEdit={canEdit}
              canSeeCost={canSeeCost}
              sort={sort}
              onSort={setSort}
              selected={selected}
              onSelect={setSelected}
              onOpen={(row) => setOpenId(String(row.id))}
            />
          ) : (
            <EmptyCategory
              filtered={!!query || noPrice || status !== "active"}
            />
          )}
          {canEdit ? <AddServiceRow onAdd={addService} /> : null}
        </section>
      </div>
      <ServiceDialog
        row={openRow}
        categories={categories}
        canEdit={canEdit}
        canSeeCost={canSeeCost}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
};

PriceListPage.path = "/price-list";

/** The figures of the price list, with the pink hero tile */
const Summary = ({
  rows,
  categories,
  canSeeCost,
}: {
  rows: ReturnType<typeof usePriceList>["rows"];
  categories: number;
  canSeeCost: boolean;
}) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const active = rows.filter((row) => !row.is_archived);
  const priced = active.filter((row) => row.price != null);
  const margins = active
    .map((row) => marginPercent(row.price, row.cost_price))
    .filter((value): value is number => value != null);
  const lastChange = rows
    .map((row) => row.price_changed_at)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
  const tiles: [string, string][] = [
    [translate("price_list.stats.sections"), String(categories)],
    [
      translate("price_list.stats.no_price"),
      String(active.length - priced.length),
    ],
    canSeeCost && margins.length
      ? [
          translate("price_list.stats.margin"),
          `${Math.round(margins.reduce((a, b) => a + b, 0) / margins.length)}%`,
        ]
      : [
          translate("price_list.stats.last_change"),
          lastChange
            ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
                day: "numeric",
                month: "short",
              }).format(new Date(lastChange))
            : "—",
        ],
  ];
  return (
    <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
      <div className="relative flex min-h-36 flex-col justify-end overflow-hidden rounded-[28px] bg-neon p-6 text-neon-ink">
        <Molar3D
          tone="soft"
          className="absolute -top-3 right-2 h-32 opacity-95"
        />
        <span className="relative text-[44px] leading-none font-light tracking-[-0.04em] tabular-nums">
          {active.length}
        </span>
        <span className="relative mt-1 text-sm">
          {translate("price_list.stats.services")}
        </span>
      </div>
      {tiles.map(([label, value]) => (
        <div
          key={label}
          className="flex min-h-36 flex-col justify-end rounded-[28px] bg-card p-6"
        >
          <span className="text-[44px] leading-none font-light tracking-[-0.04em] tabular-nums">
            {value}
          </span>
          <span className="mt-1 text-sm text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
};

/** A clinic without a price list: the starter price list in one click */
const StarterCard = ({
  canEdit,
  busy,
  onLoad,
  tools,
}: {
  canEdit: boolean;
  busy: boolean;
  onLoad: () => void;
  tools: React.ReactNode;
}) => {
  const translate = useTranslate();
  return (
    <section className="relative flex min-h-[26rem] overflow-hidden rounded-[28px] bg-card">
      <div className="relative z-10 flex max-w-xl flex-col justify-center gap-5 p-10">
        <h2 className="text-[30px] leading-tight font-normal tracking-[-0.03em]">
          {translate("price_list.starter.title")}
        </h2>
        <p className="text-[15px] text-muted-foreground">
          {translate(
            canEdit
              ? "price_list.starter.text"
              : "price_list.starter.read_only",
            { count: STARTER_PRICE_LIST.length },
          )}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" disabled={busy} onClick={onLoad}>
              {translate("price_list.starter.load", {
                count: STARTER_PRICE_LIST.length,
              })}
            </Button>
            {tools}
          </div>
        ) : null}
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[45%] md:block"
        aria-hidden
      >
        <Sphere3D size={120} tone="neon" style={{ left: "18%", top: "12%" }} />
        <Sphere3D size={56} tone="soft" style={{ right: "12%", top: "58%" }} />
        <Sphere3D size={34} tone="ink" style={{ left: "30%", bottom: "12%" }} />
        <Implant3D className="absolute top-1/2 right-[16%] h-64 -translate-y-1/2" />
      </div>
    </section>
  );
};

const EmptyCategory = ({ filtered }: { filtered: boolean }) => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Molar3D tone="soft" className="h-20" />
      <p className="text-sm text-muted-foreground">
        {translate(
          filtered
            ? "price_list.table.empty_filtered"
            : "price_list.table.empty",
        )}
      </p>
    </div>
  );
};
