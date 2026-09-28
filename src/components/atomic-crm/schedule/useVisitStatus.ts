import { useDataProvider, useNotify, useRefresh, useTranslate } from "ra-core";
import { useState } from "react";

import type { CrmDataProvider } from "../providers/types";
import type { Visit, VisitStatus } from "./types";

/** Changes the status of a visit; the deal follows (database triggers) */
export const useVisitStatus = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const [pending, setPending] = useState(false);
  const setStatus = async (visit: Visit, status: VisitStatus) => {
    if (visit.status === status) return;
    setPending(true);
    try {
      await dataProvider.update<Visit>("visits", {
        id: visit.id,
        data: { status },
        previousData: visit,
      });
      notify("schedule.popover.status_saved", {
        type: "info",
        messageArgs: { status: translate(`schedule.statuses.${status}`) },
      });
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    } finally {
      setPending(false);
    }
  };
  return { setStatus, pending };
};
