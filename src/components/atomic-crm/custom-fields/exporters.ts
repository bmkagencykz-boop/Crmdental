import jsonExport from "jsonexport/dist";
import { downloadCSV, type Exporter } from "ra-core";

import type { CustomField, CustomFieldEntity, CustomValues } from "../types";
import { customCsvColumns } from "./customFields";

/** Every record of the list with one column per custom field, by name */
export const withCustomColumns = <T extends { custom_values?: CustomValues }>(
  records: T[],
  fields: CustomField[],
  entity: CustomFieldEntity,
) =>
  records.map(({ custom_values, ...rest }) => ({
    ...rest,
    ...customCsvColumns(fields, entity, custom_values),
  }));

/**
 * CSV export of deals or patients (stage 19): the columns of the default
 * export, and the custom fields named after the fields instead of the raw
 * custom_values object.
 */
export const customFieldsExporter =
  (entity: CustomFieldEntity): Exporter =>
  async (records, _fetchRelatedRecords, dataProvider, resource) => {
    const { data: fields } = await dataProvider.getList<CustomField>(
      "custom_fields",
      {
        pagination: { page: 1, perPage: 500 },
        sort: { field: "position", order: "ASC" },
        filter: {},
      },
    );
    const csv = await jsonExport(withCustomColumns(records, fields, entity));
    downloadCSV(csv, resource ?? (entity === "deal" ? "deals" : "patients"));
  };
