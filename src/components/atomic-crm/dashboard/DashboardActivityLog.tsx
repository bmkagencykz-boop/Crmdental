import { useTranslate } from "ra-core";
import { Card } from "@/components/ui/card";

import { ActivityLog } from "../activity/ActivityLog";

export function DashboardActivityLog() {
  const translate = useTranslate();
  return (
    <div className="flex flex-col">
      <div className="flex items-center mb-4 md:mb-2">
        <h2 className="text-[15px] font-semibold text-foreground">
          {translate("crm.dashboard.latest_activity", {
            _: "Latest Activity",
          })}
        </h2>
      </div>
      <Card className="mb-2 p-6">
        <ActivityLog pageSize={10} />
      </Card>
    </div>
  );
}
