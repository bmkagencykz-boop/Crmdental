import { DashboardActivityLog } from "./DashboardActivityLog";
import { DashboardSummary } from "./DashboardSummary";
import { HotPatients } from "./HotPatients";
import { TasksList } from "./TasksList";

export const Dashboard = () => (
  <>
    <DashboardSummary />
    <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
      <div className="md:col-span-4">
        <TasksList />
      </div>
      <div className="md:col-span-5">
        <DashboardActivityLog />
      </div>
      <div className="md:col-span-3">
        <HotPatients />
      </div>
    </div>
  </>
);
