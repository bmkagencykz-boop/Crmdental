import { describe, expect, it } from "vitest";

import type { CrmNotification } from "../types";
import { pickBrowserNotifications } from "./browserNotifications";

const now = new Date("2026-03-12T10:00:00Z").getTime();
const notification = (
  id: number,
  extra: Partial<CrmNotification> = {},
): CrmNotification => ({
  id,
  sales_id: 1,
  kind: "patient_message",
  title: "Новое сообщение",
  body: "Асель: здравствуйте",
  message_count: 1,
  created_at: new Date(now - 60_000).toISOString(),
  updated_at: new Date(now - 60_000).toISOString(),
  read_at: null,
  ...extra,
});
const on = {
  browser_enabled: true,
  kinds: ["patient_message", "lead_assigned"] as CrmNotification["kind"][],
};

describe("pickBrowserNotifications", () => {
  it("shows the new unread notifications of the chosen kinds", () => {
    const picked = pickBrowserNotifications(
      [
        notification(1),
        notification(2),
        notification(3, { read_at: "2026-03-12T09:59:00Z" }),
        notification(4, { kind: "task_overdue" }),
        notification(5, {
          updated_at: new Date(now - 10 * 60_000).toISOString(),
        }),
      ],
      new Set([2]),
      on,
      now,
    );
    expect(picked.map((n) => n.id)).toEqual([1]);
  });

  it("shows nothing when the browser channel is off", () => {
    expect(
      pickBrowserNotifications(
        [notification(1)],
        new Set(),
        { ...on, browser_enabled: false },
        now,
      ),
    ).toEqual([]);
    expect(
      pickBrowserNotifications([notification(1)], new Set(), null, now),
    ).toEqual([]);
  });
});
