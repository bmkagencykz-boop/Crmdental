import type { TaskType } from "../types";

/**
 * Task types of the spec: call, message, meeting, reminder, other. A fixed
 * list (tasks_type_check), not a dictionary of the clinic.
 */
export const TASK_TYPES: TaskType[] = [
  "call",
  "message",
  "meeting",
  "reminder",
  "other",
];

export const taskTypeChoices = (translate: (key: string) => string) =>
  TASK_TYPES.map((type) => ({
    id: type,
    name: translate(`crm.tasks.types.${type}`),
  }));
