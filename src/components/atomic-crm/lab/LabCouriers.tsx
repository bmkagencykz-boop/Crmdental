import { useStore, useTranslate } from "ra-core";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { Implant3D } from "../misc/Dental3D";
import { PillTabs } from "./LabBits";
import type { OpenOrder } from "./LabPage";
import {
  addDays,
  courierDays,
  courierEvents,
  localDay,
  shiftMonth,
  type CourierEvent,
  type CourierRange,
} from "./labMath";
import type { LabOrderSummary } from "./types";
import { useLabDictionaries, useLabOrders } from "./useLab";

/**
 * «Курьеры»: the trips of the day, the week or the month — «Привоз» (from
 * the lab: for a fitting, the finished work) and «Отвоз» (to the lab: a new
 * work, back after a fitting). The works of the own lab need no courier.
 */
export const LabCouriers = ({ onOpen }: { onOpen: OpenOrder }) => {
  const translate = useTranslate();
  const { orders } = useLabOrders();
  const { labs } = useLabDictionaries();
  const [range, setRange] = useStore<CourierRange>("lab.courier_range", "day");
  const today = localDay();
  const [anchor, setAnchor] = useState(today);
  const days = useMemo(() => courierDays(range, anchor), [range, anchor]);
  const events = useMemo(
    () => courierEvents(orders, labs, days, today),
    [orders, labs, days, today],
  );
  const byId = useMemo(
    () => new Map(orders.map((order) => [String(order.id), order])),
    [orders],
  );
  const move = (step: number) =>
    setAnchor((day) =>
      range === "month"
        ? shiftMonth(day, step)
        : addDays(day, step * (range === "week" ? 7 : 1)),
    );
  const title =
    range === "month"
      ? new Date(`${days[0]}T00:00:00`).toLocaleDateString("ru-RU", {
          month: "long",
          year: "numeric",
        })
      : range === "week"
        ? `${dayLabel(days[0])} — ${dayLabel(days[days.length - 1])}`
        : dayLabel(anchor, true);

  return (
    <div className="flex flex-col gap-5" data-testid="lab-couriers">
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs
          size="sm"
          label={translate("lab.tabs.couriers")}
          value={range}
          onChange={setRange}
          options={(["day", "week", "month"] as const).map((value) => ({
            value,
            label: translate(`lab.couriers.range.${value}`),
          }))}
        />
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => move(-1)}
            aria-label={translate("lab.couriers.prev")}
            title={translate("lab.couriers.prev")}
          >
            ‹
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>
            {translate("lab.couriers.today")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => move(1)}
            aria-label={translate("lab.couriers.next")}
            title={translate("lab.couriers.next")}
          >
            ›
          </Button>
        </div>
        <h2 className="text-[22px] font-normal tracking-[-0.02em] first-letter:uppercase">
          {title}
        </h2>
        <p className="ml-auto text-sm text-muted-foreground">
          {translate("lab.couriers.own_lab_hint")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {(["pickup", "dropoff"] as const).map((direction) => (
          <Trips
            key={direction}
            direction={direction}
            events={events.filter((event) => event.direction === direction)}
            byId={byId}
            grouped={range !== "day"}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
};

const dayLabel = (day: string, weekday = false) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(weekday ? { weekday: "long" as const } : {}),
  });

const Trips = ({
  direction,
  events,
  byId,
  grouped,
  onOpen,
}: {
  direction: "pickup" | "dropoff";
  events: CourierEvent[];
  byId: Map<string, LabOrderSummary>;
  grouped: boolean;
  onOpen: OpenOrder;
}) => {
  const translate = useTranslate();
  const days = [...new Set(events.map((event) => event.day))];
  return (
    <StudioCard
      title={translate(`lab.couriers.${direction}`)}
      subtitle={`${translate(`lab.couriers.${direction}_hint`)} · ${translate(
        "lab.couriers.trips",
        { smart_count: events.length },
      )}`}
    >
      <div data-testid={`lab-couriers-${direction}`} className="relative">
        {!events.length ? (
          <div className="flex min-h-40 items-center">
            <p className="text-sm text-muted-foreground">
              {translate("lab.couriers.empty")}
            </p>
            <Implant3D
              tone="soft"
              className="pointer-events-none absolute right-0 -bottom-4 w-24"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {days.map((day) => (
              <div key={day} className="flex flex-col gap-2">
                {grouped ? (
                  <p className="text-xs font-medium text-muted-foreground first-letter:uppercase">
                    {dayLabel(day, true)}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-2">
                  {events
                    .filter((event) => event.day === day)
                    .map((event) => {
                      const order = byId.get(String(event.orderId));
                      if (!order) return null;
                      return (
                        <li key={`${event.kind}-${event.orderId}`}>
                          <button
                            type="button"
                            onClick={() => onOpen(order.id)}
                            className="flex w-full items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-left transition-colors hover:bg-pill"
                            data-testid="lab-courier-trip"
                          >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-xs tabular-nums">
                              {order.number}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">
                                {order.patient_name ?? "—"}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {translate(
                                  `lab.couriers.kinds.${direction}.${event.kind}`,
                                )}
                                {" · "}
                                {[order.lab_name, order.technician_name]
                                  .filter(Boolean)
                                  .join(", ") || "—"}
                                {order.works ? ` · ${order.works}` : ""}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-3 py-1 text-xs",
                                event.pending
                                  ? "bg-neon text-neon-ink"
                                  : event.done
                                    ? "bg-card text-muted-foreground"
                                    : "bg-primary text-primary-foreground",
                              )}
                            >
                              {event.pending
                                ? translate("lab.couriers.pending")
                                : event.done
                                  ? translate("lab.couriers.done")
                                  : translate(`lab.couriers.${direction}`)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </StudioCard>
  );
};
