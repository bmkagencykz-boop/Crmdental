import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { filterTasksByTab } from "./TasksPage";

const at = (days: number, hours = 12) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hours, 0, 0, 0);
  return date.toISOString();
};
const task = (id: number, due_date: string, done_date: string | null = null) =>
  ({ id, due_date, done_date }) as Task;

const tasks = [
  task(1, at(-2)),
  task(2, at(0)),
  task(3, at(3)),
  task(4, at(-1), at(0)),
];

describe("filterTasksByTab", () => {
  it("splits open tasks into today and overdue", () => {
    expect(filterTasksByTab(tasks, "today").map((t) => t.id)).toEqual([2]);
    expect(filterTasksByTab(tasks, "overdue").map((t) => t.id)).toEqual([1]);
    expect(filterTasksByTab(tasks, "open").map((t) => t.id)).toEqual([1, 2, 3]);
    expect(filterTasksByTab(tasks, "done").map((t) => t.id)).toEqual([4]);
  });
});
