import { useRecordContext, useTranslate } from "ra-core";
import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { Badge } from "@/components/ui/badge";

import { TopToolbar } from "../layout/TopToolbar";
import { roleLabelKey } from "./roleLabel";

const SalesListActions = () => (
  <TopToolbar>
    <ExportButton iconOnly />
    <CreateButton label="resources.sales.action.new" />
  </TopToolbar>
);

const filters = [<SearchInput source="q" alwaysOn />];

const OptionsField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext();
  const translate = useTranslate();
  if (!record) return null;
  return (
    <div className="flex flex-row gap-1">
      {record.role && (
        <Badge
          variant="outline"
          className={
            record.role === "manager"
              ? undefined
              : "border-blue-300 dark:border-blue-700"
          }
        >
          {translate(roleLabelKey(record.role))}
        </Badge>
      )}
      {record.role === "integrator" && record.access_expires_at ? (
        <Badge variant="outline">
          {translate("market.integrator.until", {
            date: new Date(record.access_expires_at).toLocaleDateString(
              "ru-RU",
            ),
          })}
        </Badge>
      ) : null}
      {record.disabled && (
        <Badge
          variant="outline"
          className="border-orange-300 dark:border-orange-700"
        >
          {translate("resources.sales.fields.disabled")}
        </Badge>
      )}
    </div>
  );
};

export function SalesList() {
  return (
    <List
      title={false}
      filters={filters}
      actions={<SalesListActions />}
      sort={{ field: "first_name", order: "ASC" }}
    >
      <DataTable>
        <DataTable.Col source="first_name" />
        <DataTable.Col source="last_name" />
        <DataTable.Col source="email" />
        <DataTable.Col
          source="phone_extension"
          label="telephony.extension"
          render={(sale) => (
            <span className="tabular-nums">{sale.phone_extension ?? ""}</span>
          )}
        />
        <DataTable.Col label={false}>
          <OptionsField />
        </DataTable.Col>
      </DataTable>
    </List>
  );
}
