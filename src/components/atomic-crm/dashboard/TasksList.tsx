import { useStore, useTranslate } from "ra-core";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";

import { AddTask } from "../tasks/AddTask";
import { TasksListContent } from "../tasks/TasksListContent";
import { TASKS_VIEW_STORE_KEY, type TasksView } from "../tasks/TasksPage";

export const TasksList = () => {
  const translate = useTranslate();
  const [, setTasksView] = useStore<TasksView>(TASKS_VIEW_STORE_KEY, "list");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <h2 className="text-[22px] font-normal tracking-[-0.02em] text-foreground flex-1">
          {translate("crm.dashboard.upcoming_tasks", {
            _: "Upcoming Tasks",
          })}
        </h2>
        <Link
          to="/tasks"
          onClick={() => setTasksView("week")}
          className="mr-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-link hover:bg-accent"
        >
          {translate("task_calendar.open_calendar")}
        </Link>
        <AddTask display="icon" selectDeal />
      </div>
      <Card className="p-4 mb-2">
        <TasksListContent />
      </Card>
    </div>
  );
};
