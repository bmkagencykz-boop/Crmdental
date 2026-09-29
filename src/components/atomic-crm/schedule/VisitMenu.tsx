import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  ClipboardPen,
  IdCard,
  Pencil,
  UserCheck,
  UserX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  useCanAccess,
  useDataProvider,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import type { Visit } from "./types";
import { VisitStatusBadge } from "./VisitDetails";
import { useVisitStatus } from "./useVisitStatus";

/** What a click on a visit can open outside the menu */
export type VisitMenuAction = "payment" | "record" | "edit" | "rebook";

const Item = ({
  icon: Icon,
  children,
  onSelect,
  to,
  danger,
  disabled,
}: {
  icon: LucideIcon;
  children: ReactNode;
  onSelect?: () => void;
  to?: string;
  danger?: boolean;
  disabled?: boolean;
}) => {
  const className = cn(
    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px] leading-tight outline-none transition-colors",
    "hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-40",
    danger ? "text-destructive" : "text-foreground",
  );
  const icon = (
    <Icon
      className={cn(
        "size-4 shrink-0",
        danger ? "text-destructive" : "text-muted-foreground",
      )}
      strokeWidth={1.75}
      aria-hidden
    />
  );
  if (to && !disabled) {
    return (
      <Link to={to} role="menuitem" className={className} onClick={onSelect}>
        {icon}
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon}
      {children}
    </button>
  );
};

/**
 * The menu of a visit in the schedule, like the appointment book of Dentist
 * Plus: «Принять оплату», «Пациент пришёл», «Редактировать визит»,
 * «Заполнить лечение», «Карточка пациента», «Перенести запись», «Записать
 * повторно»; below the line, in red, «Не пришёл» and «Отменить запись»
 * (asks once more). A visit of the MIS only opens the patient and takes
 * payments.
 */
export const VisitMenu = ({
  visit,
  name,
  time,
  onAction,
  onDone,
}: {
  visit: Visit;
  name: string;
  time: string;
  onAction: (action: VisitMenuAction) => void;
  onDone: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { setStatus, pending } = useVisitStatus();
  const { canAccess: canDelete } = useCanAccess({
    resource: "visits",
    action: "delete",
  });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = visit.source === "mis";
  const closed = visit.status === "cancelled" || visit.status === "completed";
  const patientUrl = `/patients/${visit.patient_id}/show`;

  const status = async (next: Visit["status"]) => {
    await setStatus(visit, next);
    onDone();
  };

  const remove = async () => {
    try {
      await dataProvider.delete("visits", {
        id: visit.id,
        previousData: visit,
      });
      notify("schedule.popover.deleted", { type: "info" });
      refresh();
      onDone();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    }
  };

  return (
    <div
      className="flex flex-col text-sm"
      data-testid="visit-details"
      role="menu"
      aria-label={name}
    >
      <div className="flex items-start justify-between gap-2 px-2.5 pt-1 pb-2.5">
        <div className="min-w-0">
          <div className="truncate font-semibold">{name}</div>
          <div className="text-xs tabular-nums text-muted-foreground">
            {time}
          </div>
        </div>
        <VisitStatusBadge status={visit.status} className="shrink-0" />
      </div>
      <div className="flex flex-col gap-px border-t border-border pt-1.5">
        <Item icon={Wallet} onSelect={() => onAction("payment")}>
          {translate("schedule.menu.payment")}
        </Item>
        <Item
          icon={UserCheck}
          disabled={readOnly || pending || visit.status === "arrived" || closed}
          onSelect={() => status("arrived")}
        >
          {translate("schedule.menu.arrived")}
        </Item>
        {visit.status === "scheduled" && !readOnly ? (
          <Item
            icon={CalendarCheck}
            disabled={pending}
            onSelect={() => status("confirmed")}
          >
            {translate("schedule.menu.confirm")}
          </Item>
        ) : null}
        <Item
          icon={Pencil}
          disabled={readOnly}
          onSelect={() => onAction("edit")}
        >
          {translate("schedule.menu.edit")}
        </Item>
        <Item icon={ClipboardPen} onSelect={() => onAction("record")}>
          {translate("schedule.menu.record")}
        </Item>
        <Item icon={IdCard} to={patientUrl} onSelect={onDone}>
          {translate("schedule.menu.patient")}
        </Item>
        <Item
          icon={CalendarClock}
          disabled={readOnly || closed}
          onSelect={() => onAction("edit")}
        >
          {translate("schedule.menu.move")}
        </Item>
        <Item icon={CalendarPlus} onSelect={() => onAction("rebook")}>
          {translate("schedule.menu.rebook")}
        </Item>
      </div>
      {readOnly ? (
        <p className="mx-2.5 mt-1.5 rounded-lg bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {translate("schedule.mis.readonly")}
        </p>
      ) : (
        <div className="mt-1.5 flex flex-col gap-px border-t border-border pt-1.5">
          <Item
            icon={UserX}
            danger
            disabled={pending || visit.status === "no_show" || closed}
            onSelect={() => status("no_show")}
          >
            {translate("schedule.menu.no_show")}
          </Item>
          <Item
            icon={CalendarX}
            danger
            disabled={pending || visit.status === "cancelled"}
            onSelect={() =>
              confirmCancel ? status("cancelled") : setConfirmCancel(true)
            }
          >
            {translate(
              confirmCancel
                ? "schedule.menu.cancel_confirm"
                : "schedule.menu.cancel",
            )}
          </Item>
        </div>
      )}
      {visit.deal_id != null || (canDelete && !readOnly) ? (
        <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-border px-2.5 pt-2 pb-0.5 text-xs">
          {visit.deal_id != null ? (
            <Link
              to={`/deals/${visit.deal_id}/show`}
              className="text-brand-link hover:underline"
              onClick={onDone}
            >
              {translate("schedule.popover.open_deal")}
            </Link>
          ) : (
            <span />
          )}
          {canDelete && !readOnly ? (
            <button
              type="button"
              onClick={() =>
                confirmDelete ? remove() : setConfirmDelete(true)
              }
              className={cn(
                "hover:underline",
                confirmDelete
                  ? "font-semibold text-destructive"
                  : "text-muted-foreground hover:text-destructive",
              )}
            >
              {translate(
                confirmDelete
                  ? "schedule.popover.confirm_delete"
                  : "schedule.popover.delete",
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
