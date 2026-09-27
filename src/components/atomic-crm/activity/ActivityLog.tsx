import { InfiniteListBase } from "ra-core";

import { ActivityLogIterator } from "./ActivityLogIterator";

/** Latest events of the clinic: patients, deals and notes */
export function ActivityLog({ pageSize = 20 }: { pageSize?: number }) {
  return (
    <InfiniteListBase
      resource="activity_log"
      sort={{ field: "date", order: "DESC" }}
      perPage={pageSize}
      disableSyncWithLocation
    >
      <ActivityLogIterator />
    </InfiniteListBase>
  );
}
