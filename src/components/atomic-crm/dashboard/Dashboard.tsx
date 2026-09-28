import { useCanAccess } from "ra-core";
import { Navigate } from "react-router";
import { DashboardActivityLog } from "./DashboardActivityLog";
import { DashboardSummary } from "./DashboardSummary";
import { HotPatients } from "./HotPatients";
import { MonthPlanWidget } from "./MonthPlanWidget";
import { TasksList } from "./TasksList";
import { WaitingDeals } from "../notifications/WaitingDeals";
import { OnboardingDashboardCard } from "../onboarding/OnboardingCard";

export const Dashboard = () => {
  // The integrator (stage 25) has no desk: its work starts from the deals
  const { canAccess, isPending } = useCanAccess({
    resource: "dashboard",
    action: "list",
  });
  if (isPending) return null;
  if (!canAccess) return <Navigate to="/deals" replace />;
  return <DashboardContent />;
};

const DashboardContent = () => (
  <>
    <OnboardingDashboardCard />
    <DashboardSummary />
    <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
      <div className="md:col-span-4">
        <TasksList />
      </div>
      <div className="md:col-span-5">
        <DashboardActivityLog />
      </div>
      <div className="flex flex-col gap-8 md:col-span-3">
        <MonthPlanWidget />
        <WaitingDeals />
        <HotPatients />
      </div>
    </div>
  </>
);
