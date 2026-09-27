import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { ReportFilters, ReportName } from "./reportMath";

/** Loads a report for the filters of the reports screen */
export const useReport = <Name extends ReportName>(
  name: Name,
  filters: ReportFilters,
) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: ["reports", name, filters],
    queryFn: () => dataProvider.getReport(name, filters),
  });
};
