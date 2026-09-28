import { useCanAccess } from "ra-core";
import { Navigate } from "react-router";
import { DashboardActivityLog } from "./DashboardActivityLog";
import { DashboardHeader, DayTimeline, InWorkDeals } from "./DashboardHome";
import { HotPatients } from "./HotPatients";
import { MonthPlanWidget } from "./MonthPlanWidget";
import { TasksList } from "./TasksList";
import { TodayInClinic } from "../schedule/TodayInClinic";
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
    <DashboardHeader />
    <InWorkDeals />
    <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
      <div className="flex flex-col gap-6 md:col-span-7">
        <DayTimeline />
        <TasksList />
      </div>
      <div className="flex flex-col gap-6 md:col-span-5">
        <TodayInClinic />
        <MonthPlanWidget />
        <WaitingDeals />
        <HotPatients />
        <DashboardActivityLog />
      </div>
    </div>
  </>
);
