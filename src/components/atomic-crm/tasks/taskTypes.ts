import type { TaskType } from "../types";

/** Task types of the spec: call, message, reminder, other */
export const TASK_TYPES: TaskType[] = ["call", "message", "reminder", "other"];

export const taskTypeChoices = (translate: (key: string) => string) =>
  TASK_TYPES.map((type) => ({
    id: type,
    name: translate(`crm.tasks.types.${type}`),
  }));
