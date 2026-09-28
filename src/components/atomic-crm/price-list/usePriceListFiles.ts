import { useNotify } from "ra-core";
import { useState } from "react";

import { downloadFile } from "../import/downloadFile";
import { isSupportedFile, readImportFile } from "../import/readImportFile";
import { parsePriceRows, planPriceImport } from "../treatment/priceList";
import { priceListExportCsv, priceListTemplateCsv } from "./priceListFile";
import { starterServices } from "./starterPriceList";
import type { PriceListRow, ServiceCategory } from "./types";
import { usePriceListWrites } from "./usePriceList";

/**
 * Import (CSV or XLSX of stage 29, with the columns of stage 35), export
 * and template of the price list, and the starter price list.
 */
export const usePriceListFiles = ({
  rows,
  categories,
  canSeeCost,
}: {
  rows: PriceListRow[];
  categories: ServiceCategory[];
  canSeeCost: boolean;
}) => {
  const notify = useNotify();
  const writes = usePriceListWrites();
  const { dataProvider } = writes;
  const [busy, setBusy] = useState(false);

  const importFile = async (file: File) => {
    if (!isSupportedFile(file.name)) {
      notify("price_list.files.unsupported", { type: "warning" });
      return;
    }
    setBusy(true);
    try {
      const { items, errors } = parsePriceRows(await readImportFile(file));
      if (!items.length) {
        notify("price_list.files.empty", { type: "warning" });
        return;
      }
      const plan = planPriceImport(rows, items);
      const done = await writes.run(async () => {
        const created = await dataProvider.createServices(
          plan.create.map((row) => ({ ...row, is_archived: false })),
        );
        for (const change of plan.update) {
          await dataProvider.update("services", {
            id: change.id,
            data: change.data,
            previousData: change.previous,
          });
        }
        if (canSeeCost) {
          for (const cost of plan.costs) {
            const id = cost.id ?? created[cost.create!];
            if (id != null) await dataProvider.setServiceCost(id, cost.cost);
          }
        }
        return true;
      });
      if (!done) return;
      notify("price_list.files.imported", {
        type: "info",
        messageArgs: {
          created: plan.create.length,
          updated: plan.update.length,
          unchanged: plan.unchanged,
        },
      });
      if (errors.length) {
        notify("price_list.files.errors", {
          type: "warning",
          messageArgs: { lines: errors.map((error) => error.line).join(", ") },
        });
      }
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const loadStarter = async () => {
    setBusy(true);
    const services = starterServices(rows);
    const ids = await writes.run(() => dataProvider.createServices(services));
    setBusy(false);
    if (ids) {
      notify("price_list.starter.loaded", {
        type: "info",
        messageArgs: { count: ids.length },
      });
    }
  };

  return {
    busy,
    importFile,
    loadStarter,
    exportCsv: () =>
      downloadFile(
        "Прайс.csv",
        priceListExportCsv(rows, categories, { withCost: canSeeCost }),
      ),
    downloadTemplate: () =>
      downloadFile("Прайс — шаблон.csv", priceListTemplateCsv()),
  };
};
