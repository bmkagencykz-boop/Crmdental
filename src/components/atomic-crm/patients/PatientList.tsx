import type { ReactNode } from "react";
import type { InputProps } from "ra-core";
import { useCanAccess, useGetIdentity, useTranslate } from "ra-core";

import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { BulkDeleteButton } from "@/components/admin/bulk-delete-button";
import { BulkExportButton } from "@/components/admin/bulk-export-button";
import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { FilterButton } from "@/components/admin/filter-form";
import { List } from "@/components/admin/list";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";

import {
  findById,
  toChoices,
  useLeadSources,
} from "../dictionaries/useDictionaries";
import { TopToolbar } from "../layout/TopToolbar";
import { formatRelativeDate } from "../misc/RelativeDate";
import { AccountManagerInput } from "../sales/AccountManagerInput";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Patient } from "../types";
import { BulkTagButton } from "./BulkTagButton";
import { patientDisplayName } from "./parsePatientText";
import { TagsList } from "./TagsList";
import { customFieldsExporter } from "../custom-fields/exporters";
import { formatPhone } from "../misc/formatPhone";

const patientExporter = customFieldsExporter("patient");

/** Patients: search by name or phone, filters, bulk tags */
export const PatientList = () => {
  const { identity } = useGetIdentity();
  const translate = useTranslate();
  const { data: sources } = useLeadSources();
  if (!identity) return null;

  const filters = [
    <SearchInput
      source="q"
      alwaysOn
      placeholder={translate("resources.patients.filters.search")}
    />,
    <AccountManagerInput source="sales_id" alwaysOn />,
    <WrapperField
      source="source_id"
      label="resources.patients.fields.source_id"
    >
      <SelectInput
        source="source_id"
        label={false}
        emptyText="resources.patients.fields.source_id"
        choices={toChoices(sources)}
      />
    </WrapperField>,
    <WrapperField source="tags@cs" label="resources.tags.name">
      <ReferenceInput source="tags@cs" reference="tags">
        <SelectInput
          label={false}
          emptyText="resources.tags.name"
          format={(value: string) => value?.replace(/[{}]/g, "")}
          parse={(value: string) => (value ? `{${value}}` : value)}
        />
      </ReferenceInput>
    </WrapperField>,
  ];

  return (
    <List
      title={false}
      actions={<PatientListActions />}
      filters={filters}
      perPage={50}
      sort={{ field: "last_seen", order: "DESC" }}
      exporter={patientExporter}
    >
      <PatientTable />
    </List>
  );
};

const PatientTable = () => {
  const translate = useTranslate();
  const { data: sources } = useLeadSources();
  return (
    <div className="glass overflow-hidden rounded-lg px-2 py-1">
      <DataTable<Patient>
        rowClick="show"
        bulkActionButtons={
          <>
            <BulkTagButton />
            <BulkExportButton />
            <BulkDeleteButton />
          </>
        }
      >
        <DataTable.Col
          source="last_name"
          label="resources.patients.fields.full_name"
          render={(patient) => (
            <div className="flex flex-col gap-1 py-1">
              <span className="font-semibold">
                {patientDisplayName(patient as Patient)}
              </span>
              {patient.tags?.length ? <TagsList /> : null}
            </div>
          )}
        />
        <DataTable.Col
          source="phone_fts"
          label="resources.patients.fields.phone_number"
          disableSort
          render={(patient) =>
            patient.phones?.[0] ? (
              <a
                href={`tel:${patient.phones[0]}`}
                onClick={(event) => event.stopPropagation()}
                className="tabular-nums hover:underline"
              >
                {formatPhone(patient.phones[0])}
              </a>
            ) : (
              "—"
            )
          }
        />
        <DataTable.Col source="city" />
        <DataTable.Col
          source="source_id"
          render={(patient) =>
            findById(sources, patient.source_id)?.name ?? "—"
          }
        />
        <DataTable.Col
          source="nb_open_deals"
          label="resources.patients.fields.deals"
          render={(patient) => (
            <span className="tabular-nums">
              {translate("crm.patients.deal_counts", {
                open: patient.nb_open_deals ?? 0,
                total: patient.nb_deals ?? 0,
              })}
            </span>
          )}
        />
        <DataTable.Col
          source="sales_id"
          render={(patient) => <SalesName id={patient.sales_id} />}
        />
        <DataTable.Col
          source="last_seen"
          render={(patient) => (
            <span className="text-muted-foreground">
              {formatRelativeDate(patient.last_seen)}
            </span>
          )}
        />
      </DataTable>
    </div>
  );
};

const SalesName = ({ id }: { id?: Patient["sales_id"] }) => {
  const name = useGetSalesName(id ?? undefined, { enabled: id != null });
  return <>{name || "—"}</>;
};

const PatientListActions = () => (
  <TopToolbar className="items-center">
    <FilterButton iconOnly />
    <ExportButton iconOnly />
    <ImportButton />
    <CreateButton label="resources.patients.action.new" />
  </TopToolbar>
);

/** Import wizard (owner and head: same rights as the settings) */
const ImportButton = () => {
  const translate = useTranslate();
  const { canAccess } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  if (!canAccess) return null;
  return (
    <Button variant="outline" asChild>
      <Link to="/import">{translate("import.open")}</Link>
    </Button>
  );
};

const WrapperField = ({ children }: InputProps & { children: ReactNode }) =>
  children;
