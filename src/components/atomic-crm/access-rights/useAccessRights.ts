import { useQuery } from "@tanstack/react-query";
import { useDataProvider, type Exporter, type Identifier } from "ra-core";
import { useCallback, useMemo } from "react";

import type { CrmDataProvider } from "../providers/types";
import {
  exportableRows,
  type AccessEntity,
  type AccessScope,
} from "./accessRights";

export const MY_ACCESS_RIGHTS_KEY = ["my_access_rights"];
/** The owner's matrix of every employee (public.access_rights) */
export const ACCESS_RIGHTS_KEY = ["access_rights"];

/** The rights of the signed-in employee (public.my_access_rights) */
export const useMyAccessRights = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: MY_ACCESS_RIGHTS_KEY,
    queryFn: () => dataProvider.getMyAccessRights(),
    staleTime: 30_000,
  });
};

/**
 * The export right on an entity: whether to show the export buttons, and
 * the rows the employee may export (the scope «own» keeps their own). The
 * export is a CSV built in the browser from what the employee can see.
 */
export const useExportScope = (entity: AccessEntity) => {
  const { data } = useMyAccessRights();
  const scope: AccessScope = data?.rights[entity].export ?? "all";
  const me = data?.sales_id;
  const restrict = useCallback(
    <T extends { sales_id?: Identifier | null }>(rows: T[]): T[] =>
      exportableRows(rows, scope, me),
    [scope, me],
  );
  return { canExport: scope !== "none", scope, restrict };
};

/** An exporter that only exports the rows of the employee's export scope */
export const useScopedExporter = (entity: AccessEntity, exporter: Exporter) => {
  const { restrict } = useExportScope(entity);
  return useMemo<Exporter>(
    () =>
      (records, ...rest) =>
        exporter(
          restrict(records as { sales_id?: Identifier | null }[]),
          ...rest,
        ),
    [exporter, restrict],
  );
};
