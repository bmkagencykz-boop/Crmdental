import { useListContext, useStore, useTranslate } from "ra-core";
import { useEffect, useState } from "react";
import { List } from "@/components/admin/list";
import { ListPagination } from "@/components/admin/list-pagination";

import type { Deal } from "../../types";
import { BulkActions } from "./BulkActions";
import { ColumnsMenu } from "./ColumnsMenu";
import { normalizeColumns, type ColumnSettings } from "./columns";
import { DealTable } from "./DealTable";
import { SavedFiltersBar } from "./SavedFiltersBar";
import { useDealFilters } from "./useDealFilters";

export const DEAL_LIST_STORE_KEY = "deals.list";
export const DEAL_COLUMNS_STORE_KEY = "deals.list.columns";
const PERMANENT_FILTER = { "archived_at@is": null };

/**
 * «Список» of the deals (amoCRM list view): every pipeline, the same
 * filters as the board plus the pipeline, sorted and paginated by the
 * server, chosen columns, bulk actions.
 */
export const DealListView = ({
  actions,
  dialogs,
}: {
  actions: React.ReactElement;
  /** Create / edit dialogs (they read the list context) */
  dialogs?: React.ReactNode;
}) => {
  const filters = useDealFilters({});
  return (
    <List<Deal>
      resource="deals"
      title={false}
      storeKey={DEAL_LIST_STORE_KEY}
      perPage={50}
      sort={{ field: "created_at", order: "DESC" }}
      filter={PERMANENT_FILTER}
      filters={filters}
      actions={actions}
      pagination={<ListPagination rowsPerPageOptions={[25, 50, 100]} />}
    >
      <DealListBody />
      {dialogs}
    </List>
  );
};

const DealListBody = () => {
  const translate = useTranslate();
  const { filterValues, total } = useListContext<Deal>();
  const [stored, setStored] = useStore<ColumnSettings | undefined>(
    DEAL_COLUMNS_STORE_KEY,
  );
  const settings = normalizeColumns(stored);
  const [allMatching, setAllMatching] = useState(false);
  // «All matching the filter» follows the filter
  const filterKey = JSON.stringify(filterValues);
  useEffect(() => setAllMatching(false), [filterKey]);

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SavedFiltersBar />
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {translate("crm.deals.count", { smart_count: total ?? 0 })}
          </span>
          <ColumnsMenu settings={settings} onChange={setStored} />
        </div>
      </div>
      <DealTable settings={settings} />
      <BulkActions
        allMatching={allMatching}
        setAllMatching={setAllMatching}
        permanentFilter={PERMANENT_FILTER}
      />
    </div>
  );
};
