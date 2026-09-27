import { useGetList, useTranslate } from "ra-core";
import { useMemo } from "react";

import type { CustomField, CustomFieldEntity, CustomValue } from "../types";
import { formatMoney } from "../deals/kanbanFormat";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { displayCustomValue, entityFields } from "./customFields";

export { entityFields };

// Definitions change rarely: cached like the dictionaries
const options = { staleTime: 5 * 60 * 1000 };
const EMPTY: CustomField[] = [];

/** Every custom field of the clinic (archived ones too), in their order */
export const useCustomFields = () => {
  const { data, isPending } = useGetList<CustomField>(
    "custom_fields",
    {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "position", order: "ASC" },
    },
    options,
  );
  return { data: data ?? EMPTY, isPending };
};

/** Fields of an entity, active ones unless `archived` */
export const useEntityFields = (
  entity: CustomFieldEntity,
  { archived = false }: { archived?: boolean } = {},
) => {
  const { data, isPending } = useCustomFields();
  const fields = useMemo(
    () => entityFields(data, entity, { archived }),
    [data, entity, archived],
  );
  return { data: fields, all: data, isPending };
};

/** A value as the screens show it; links and phones are clickable */
export const useCustomValueText = () => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  return (field: CustomField, value: CustomValue | null | undefined) =>
    displayCustomValue(field, value, {
      formatMoney: (amount) => formatMoney(amount, currency),
      yes: translate("custom_fields.values.yes"),
      no: translate("custom_fields.values.no"),
    });
};
