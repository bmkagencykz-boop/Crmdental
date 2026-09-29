import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { cn } from "@/lib/utils";

import { NativeSelect } from "../payments/PaymentDialog";
import type { CrmDataProvider } from "../providers/types";
import type { Sale } from "../types";
import { shortDay } from "./labMath";
import {
  LAB_FAULTS,
  type LabFault,
  type LabOrderEvent,
  type LabOrderRemake,
} from "./types";
import { useLabRights, useRefreshLab } from "./useLab";

const same = (a: unknown, b: unknown) =>
  a != null && b != null && String(a) === String(b);

const time = (at: string) => {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * The remakes of an order — reason, who is at fault, under the warranty,
 * paid or free (the owner and the head decide) — and its history: who
 * changed what and when (lab_order_events, stage 43)
 */
export const LabOrderHistory = ({ orderId }: { orderId: Identifier }) => {
  const translate = useTranslate();
  const { data: events = [] } = useGetList<LabOrderEvent>("lab_order_events", {
    filter: { order_id: orderId },
    pagination: { page: 1, perPage: 500 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: remakes = [] } = useGetList<LabOrderRemake>(
    "lab_order_remakes",
    {
      filter: { order_id: orderId },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    },
  );
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "first_name", order: "ASC" },
  });
  const who = (id: Identifier | null | undefined) => {
    const sale = sales.find((s) => same(s.id, id));
    return sale
      ? [sale.first_name, sale.last_name].filter(Boolean).join(" ")
      : null;
  };
  const status = (value?: string | null) =>
    value ? translate(`lab.statuses.${value}`) : "—";
  const text = (event: LabOrderEvent) => {
    switch (event.kind) {
      case "created":
        return translate("lab_plus.history.created");
      case "status":
        return `${status(event.from_status)} → ${status(event.to_status)}`;
      case "remake":
        return translate("lab_plus.history.remake", {
          from: status(event.from_status),
        });
      case "fitting_visit":
        return translate("lab_plus.history.fitting_visit", {
          at: event.note ?? "",
        });
      case "invite":
        return translate("lab_plus.history.invite");
      default:
        return event.kind;
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="lab-order-history">
      {remakes.length ? (
        <ul className="flex flex-col gap-2" data-testid="lab-order-remakes">
          {remakes.map((remake) => (
            <RemakeRow key={remake.id} remake={remake} />
          ))}
        </ul>
      ) : null}
      {events.length ? (
        <ol className="relative flex flex-col gap-2.5 border-l border-border pl-4">
          {events.map((event) => (
            <li key={event.id} className="relative text-sm">
              <span
                className={cn(
                  "absolute top-1.5 -left-[21px] size-2.5 rounded-full",
                  event.kind === "remake"
                    ? "bg-tone-red"
                    : event.kind === "invite"
                      ? "bg-neon"
                      : "bg-foreground/40",
                )}
                aria-hidden
              />
              <span>{text(event)}</span>
              <span className="block text-xs text-muted-foreground">
                {[time(event.created_at), who(event.sales_id)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("lab_plus.history.empty")}
        </p>
      )}
    </div>
  );
};

const RemakeRow = ({ remake }: { remake: LabOrderRemake }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshLab();
  const rights = useLabRights();
  const save = async (data: Partial<LabOrderRemake>) => {
    try {
      await dataProvider.update("lab_order_remakes", {
        id: remake.id,
        data,
        previousData: remake,
      });
      await refresh();
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    }
  };
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-2xl bg-tone-red/10 px-4 py-3 text-sm"
      data-testid="lab-remake-row"
    >
      <span className="font-medium">
        {translate("lab_plus.remake.row", {
          date: shortDay(remake.occurred_on, true),
        })}
      </span>
      <span>{remake.reason ?? translate("lab_plus.remake.no_reason")}</span>
      {remake.is_warranty ? (
        <span className="rounded-full bg-neon px-2.5 py-0.5 text-xs text-neon-ink">
          {translate("lab_plus.remake.by_warranty")}
        </span>
      ) : null}
      {rights.canWrite ? (
        <NativeSelect
          value={remake.fault ?? ""}
          onChange={(fault) =>
            save({ fault: (fault || null) as LabFault | null })
          }
          aria-label={translate("lab_plus.remake.fault")}
        >
          <option value="">{translate("lab_plus.faults.unknown")}</option>
          {LAB_FAULTS.map((fault) => (
            <option key={fault} value={fault}>
              {translate(`lab_plus.faults.${fault}`)}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <span className="text-muted-foreground">
          {translate(`lab_plus.faults.${remake.fault ?? "unknown"}`)}
        </span>
      )}
      {rights.seesMoney ? (
        <button
          type="button"
          onClick={() => save({ is_paid: !remake.is_paid })}
          className={cn(
            "ml-auto rounded-full px-3 py-1 text-xs transition-colors",
            remake.is_paid
              ? "bg-primary text-primary-foreground"
              : "bg-card hover:bg-pill",
          )}
          title={translate("lab_plus.remake.toggle_paid")}
          data-testid="lab-remake-paid"
        >
          {translate(
            remake.is_paid
              ? "lab_plus.remake.is_paid"
              : "lab_plus.remake.is_free",
          )}
        </button>
      ) : null}
      {remake.comment ? (
        <span className="basis-full text-xs text-muted-foreground">
          {remake.comment}
        </span>
      ) : null}
    </li>
  );
};
