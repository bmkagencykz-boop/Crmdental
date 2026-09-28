import { useTranslate } from "ra-core";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

import type { PlanStatus } from "./types";

const STATUS_CLASSES: Record<PlanStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  presented: "bg-primary/10 text-primary",
  agreed: "bg-brand-green/25 text-foreground",
  in_progress: "bg-brand-yellow/30 text-foreground",
  completed: "bg-brand-green/45 text-foreground",
  declined: "bg-destructive/10 text-destructive",
};

/** «Черновик», «Согласован»… as a small text badge */
export const PlanStatusBadge = ({
  status,
  className,
}: {
  status: PlanStatus;
  className?: string;
}) => {
  const translate = useTranslate();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        STATUS_CLASSES[status],
        className,
      )}
    >
      {translate(`treatment.statuses.${status}`)}
    </span>
  );
};

/** «Основной»: the plan whose total is the deal amount */
export const MainPlanMark = () => {
  const translate = useTranslate();
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-semibold text-foreground"
      title={translate("treatment.main_hint")}
    >
      {translate("treatment.main")}
    </span>
  );
};

/**
 * A dense cell input of the plan table: saved on blur or Enter, reset by
 * Escape. `value` resets it after the data is refreshed.
 */
export const CellInput = ({
  value,
  onCommit,
  label,
  className,
  align = "left",
  placeholder,
  inputMode,
  disabled,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  className?: string;
  align?: "left" | "right";
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
  disabled?: boolean;
}) => {
  const commit = (raw: string) => {
    if (raw.trim() !== value.trim()) onCommit(raw.trim());
  };
  return (
    <input
      key={value}
      defaultValue={value}
      aria-label={label}
      placeholder={placeholder}
      inputMode={inputMode}
      disabled={disabled}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = value;
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "h-7 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 text-[13px] outline-none transition-colors hover:border-border focus:border-ring focus:bg-background disabled:hover:border-transparent",
        align === "right" && "text-right tabular-nums",
        className,
      )}
    />
  );
};
